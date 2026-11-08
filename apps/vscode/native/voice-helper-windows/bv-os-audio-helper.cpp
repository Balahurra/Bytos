// Bytos Voice — Windows x64 WASAPI capture helper (F1)
//
// A deliberately small, auditable child process. The extension host spawns it,
// reads control JSON from stdout, and (during capture) reads length-prefixed
// PCM frames from stdout.
//
// Hard rules (VOICE-F1-IMPLEMENTATION-PLAN.md §3 T3, §4):
//   * No file I/O, no network, no shell, no temp files. Audio exists only in
//     this process's buffers and on stdout. Nothing is ever written to disk.
//   * stdout is command-dependent: UTF-8 JSON for control replies, binary
//     frames only for capture.
//   * Every diagnostic goes to stderr, and carries codes/ids/counters only —
//     never audio samples.
//   * Permission/availability problems are REPORTED (JSON + exit 0), not
//     crashes.
//
// Frame contract (also consumed by host `capture/frameParser.ts`):
//   little-endian uint32 length   number of payload bytes that follow the header
//   uint16 formatTag              1 = WAVE_FORMAT_PCM
//   uint32 sampleRate             payload sample rate (Hz)
//   uint16 channels               payload channel count (1 = mono)
//   uint16 bitsPerSample          payload bits per sample (16)
//   uint8[payloadLength]          payload
//   Header is 14 bytes; payload is PCM16 little-endian.
//
// Build: see README.md in this directory (scripts/build-helper.ps1).
//
// Device names are UTF-8. Windows device names on the reference host contain
// Turkish characters (`Mikrofon`, `Kulaklık`, `Stereo Karışımı`), so control
// replies are converted from UTF-16 to UTF-8 explicitly, and the console output
// code page is set to UTF-8 for good measure.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <propsys.h>
#include <functiondiscoverykeys_devpkey.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr const char *kHelperVersion = "0.1.0";
constexpr const char *kBackend = "wasapi";

// Output sample-rate/channel contract with the host (16 kHz mono PCM16).
constexpr int kDefaultRate = 16000;
constexpr int kDefaultChannels = 1;

// Bounded buffers. WASAPI packets are ~10 ms; these caps only exist so a stalled
// consumer can never make the helper grow without bound.
constexpr size_t kMaxFramePayload = 1024u * 1024u;

// ── Diagnostics (stderr only, never audio) ──────────────────────────────────

void diag(const char *code, int value = 0, HRESULT hr = S_OK) {
	if (hr != S_OK) {
		std::fprintf(stderr, "[bv-os-audio-helper] %s value=%d hr=0x%08lx\n", code, value, static_cast<unsigned long>(hr));
	} else if (value != 0) {
		std::fprintf(stderr, "[bv-os-audio-helper] %s value=%d\n", code, value);
	} else {
		std::fprintf(stderr, "[bv-os-audio-helper] %s\n", code);
	}
	std::fflush(stderr);
}

// ── UTF-8 conversion ────────────────────────────────────────────────────────

std::string WideToUtf8(const wchar_t *wide) {
	if (wide == nullptr || wide[0] == L'\0') {
		return std::string();
	}
	const int needed = ::WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
	if (needed <= 1) {
		return std::string();
	}
	std::string out(static_cast<size_t>(needed - 1), '\0');
	::WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), needed - 1, nullptr, nullptr);
	return out;
}

std::string JsonEscape(const std::string &in) {
	std::string out;
	out.reserve(in.size() + 8);
	for (const char raw : in) {
		const unsigned char c = static_cast<unsigned char>(raw);
		switch (c) {
		case '"':
			out += "\\\"";
			break;
		case '\\':
			out += "\\\\";
			break;
		case '\b':
			out += "\\b";
			break;
		case '\f':
			out += "\\f";
			break;
		case '\n':
			out += "\\n";
			break;
		case '\r':
			out += "\\r";
			break;
		case '\t':
			out += "\\t";
			break;
		default:
			if (c < 0x20) {
				char buf[7];
				std::snprintf(buf, sizeof(buf), "\\u%04x", c);
				out += buf;
			} else {
				// UTF-8 continuation bytes pass through untouched.
				out.push_back(static_cast<char>(c));
			}
		}
	}
	return out;
}

const char *StateName(DWORD state) {
	switch (state) {
	case DEVICE_STATE_ACTIVE:
		return "active";
	case DEVICE_STATE_DISABLED:
		return "disabled";
	case DEVICE_STATE_NOTPRESENT:
		return "notpresent";
	case DEVICE_STATE_UNPLUGGED:
		return "unplugged";
	default:
		return "unknown";
	}
}

template <typename T>
void SafeRelease(T *&ptr) {
	if (ptr != nullptr) {
		ptr->Release();
		ptr = nullptr;
	}
}

struct ComScope {
	HRESULT hr = E_FAIL;
	ComScope() { hr = ::CoInitializeEx(nullptr, COINIT_MULTITHREADED); }
	~ComScope() {
		if (SUCCEEDED(hr)) {
			::CoUninitialize();
		}
	}
	bool ok() const { return SUCCEEDED(hr); }
};

struct DeviceEntry {
	std::string id;
	std::string name;
	std::string state;
	bool isDefault = false;
};

// ── Device enumeration ──────────────────────────────────────────────────────

// Enumerate every capture endpoint (active, disabled, unplugged, not present)
// so the host can explain *why* a device is unusable.
HRESULT EnumerateCaptureDevices(std::vector<DeviceEntry> &out) {
	IMMDeviceEnumerator *enumerator = nullptr;
	HRESULT hr = ::CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator),
									reinterpret_cast<void **>(&enumerator));
	if (FAILED(hr)) {
		return hr;
	}

	// Resolve the system default capture endpoint once, up front.
	std::wstring defaultId;
	{
		IMMDevice *defaultDevice = nullptr;
		const HRESULT defaultHr = enumerator->GetDefaultAudioEndpoint(eCapture, eConsole, &defaultDevice);
		if (SUCCEEDED(defaultHr) && defaultDevice != nullptr) {
			LPWSTR rawId = nullptr;
			if (SUCCEEDED(defaultDevice->GetId(&rawId)) && rawId != nullptr) {
				defaultId.assign(rawId);
				::CoTaskMemFree(rawId);
			}
			SafeRelease(defaultDevice);
		}
	}

	IMMDeviceCollection *collection = nullptr;
	hr = enumerator->EnumAudioEndpoints(
		eCapture,
		DEVICE_STATE_ACTIVE | DEVICE_STATE_DISABLED | DEVICE_STATE_NOTPRESENT | DEVICE_STATE_UNPLUGGED, &collection);
	if (SUCCEEDED(hr) && collection != nullptr) {
		UINT count = 0;
		if (SUCCEEDED(collection->GetCount(&count))) {
			for (UINT i = 0; i < count; ++i) {
				IMMDevice *device = nullptr;
				if (FAILED(collection->Item(i, &device)) || device == nullptr) {
					continue;
				}
				DeviceEntry entry;
				LPWSTR rawId = nullptr;
				if (SUCCEEDED(device->GetId(&rawId)) && rawId != nullptr) {
					entry.id = WideToUtf8(rawId);
					entry.isDefault = defaultId == rawId;
					::CoTaskMemFree(rawId);
				}
				DWORD state = 0;
				entry.state = SUCCEEDED(device->GetState(&state)) ? StateName(state) : "unknown";
				IPropertyStore *props = nullptr;
				if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &props)) && props != nullptr) {
					PROPVARIANT value;
					::PropVariantInit(&value);
					if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &value)) && value.vt == VT_LPWSTR) {
						entry.name = WideToUtf8(value.pwszVal);
					}
					::PropVariantClear(&value);
					SafeRelease(props);
				}
				if (entry.name.empty()) {
					entry.name = "Unnamed capture device";
				}
				out.push_back(entry);
				SafeRelease(device);
			}
		}
		SafeRelease(collection);
	}
	SafeRelease(enumerator);
	return hr;
}

int CountActive(const std::vector<DeviceEntry> &devices) {
	return static_cast<int>(std::count_if(devices.begin(), devices.end(),
										  [](const DeviceEntry &d) { return d.state == "active"; }));
}

// Map an HRESULT to a stable, audio-free error code for the host.
const char *ErrorCodeFromHresult(HRESULT hr) {
	switch (static_cast<unsigned long>(hr)) {
	case 0x80070005ul: // E_ACCESSDENIED — Windows microphone privacy / policy denial
		return "MICROPHONE_ACCESS_DENIED";
	case 0x80070490ul: // ERROR_NOT_FOUND — no such endpoint id
		return "CAPTURE_DEVICE_NOT_FOUND";
	case 0x88890004ul: // AUDCLNT_E_DEVICE_INVALIDATED
		return "CAPTURE_DEVICE_INVALIDATED";
	case 0x88890008ul: // AUDCLNT_E_UNSUPPORTED_FORMAT
		return "CAPTURE_UNSUPPORTED_FORMAT";
	case 0x88890001ul: // AUDCLNT_E_NOT_INITIALIZED
		return "CAPTURE_NOT_INITIALIZED";
	default:
		return "CAPTURE_HELPER_ERROR";
	}
}

// ── stdout writing (the only place audio bytes leave this process) ───────────

class StdoutSink {
public:
	bool writeAll(const void *data, size_t bytes) {
		const auto *p = static_cast<const unsigned char *>(data);
		size_t written = 0;
		while (written < bytes) {
			DWORD chunk = static_cast<DWORD>(std::min<size_t>(bytes - written, 1u << 20));
			DWORD done = 0;
			if (!::WriteFile(m_handle, p + written, chunk, &done, nullptr) || done == 0) {
				return false;
			}
			written += done;
		}
		return true;
	}

	void writeJsonLine(const std::string &json) {
		std::string line = json;
		line.push_back('\n');
		writeAll(line.data(), line.size());
		// Control replies are small and must be visible to the host immediately.
		::FlushFileBuffers(m_handle);
	}

private:
	HANDLE m_handle = ::GetStdHandle(STD_OUTPUT_HANDLE);
};

// Writes one length-prefixed frame from raw PCM16 payload bytes.
bool WriteFrame(StdoutSink &sink, const uint8_t *payload, uint32_t payloadBytes, uint32_t sampleRate,
				uint16_t channels, uint16_t bitsPerSample) {
	if (payloadBytes > kMaxFramePayload) {
		return false;
	}
	uint8_t header[14];
	const uint32_t length = payloadBytes;
	const uint16_t formatTag = 1; // WAVE_FORMAT_PCM
	header[0] = static_cast<uint8_t>(length & 0xFF);
	header[1] = static_cast<uint8_t>((length >> 8) & 0xFF);
	header[2] = static_cast<uint8_t>((length >> 16) & 0xFF);
	header[3] = static_cast<uint8_t>((length >> 24) & 0xFF);
	header[4] = static_cast<uint8_t>(formatTag & 0xFF);
	header[5] = static_cast<uint8_t>((formatTag >> 8) & 0xFF);
	header[6] = static_cast<uint8_t>(sampleRate & 0xFF);
	header[7] = static_cast<uint8_t>((sampleRate >> 8) & 0xFF);
	header[8] = static_cast<uint8_t>((sampleRate >> 16) & 0xFF);
	header[9] = static_cast<uint8_t>((sampleRate >> 24) & 0xFF);
	header[10] = static_cast<uint8_t>(channels & 0xFF);
	header[11] = static_cast<uint8_t>((channels >> 8) & 0xFF);
	header[12] = static_cast<uint8_t>(bitsPerSample & 0xFF);
	header[13] = static_cast<uint8_t>((bitsPerSample >> 8) & 0xFF);
	return sink.writeAll(header, sizeof(header)) && sink.writeAll(payload, payloadBytes);
}

// ── Sample-format conversion ────────────────────────────────────────────────
//
// WASAPI shared-mode capture is asked for the requested rate/channels/PCM16
// first. When the device refuses, the helper falls back to the device mix
// format and normalises it here: downmix to mono by AVERAGING (never summing —
// summing clips), then resample to the requested rate, then emit PCM16.
// The host repeats the same contract in `core/voice/audio/*`.

int16_t FloatToPcm16(float sample) {
	if (!std::isfinite(sample)) {
		return 0;
	}
	const float clamped = std::max(-1.0f, std::min(1.0f, sample));
	// Asymmetric scaling so -1.0 maps to -32768 and 1.0 maps to 32767.
	return static_cast<int16_t>(clamped < 0.0f ? clamped * 32768.0f : clamped * 32767.0f);
}

struct FormatConverter {
	WORD tag = WAVE_FORMAT_PCM;
	WORD channels = 1;
	WORD bits = 16;
	WORD validBits = 16;
	DWORD rate = 48000;

	bool configure(const WAVEFORMATEX *format) {
		if (format == nullptr) {
			return false;
		}
		channels = format->nChannels;
		bits = format->wBitsPerSample;
		rate = format->nSamplesPerSec;
		validBits = bits;
		tag = format->wFormatTag;
		if (tag == WAVE_FORMAT_EXTENSIBLE && format->cbSize >= 22) {
			const auto *ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE *>(format);
			validBits = ext->Samples.wValidBitsPerSample;
			if (::IsEqualGUID(ext->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
				tag = WAVE_FORMAT_IEEE_FLOAT;
			} else if (::IsEqualGUID(ext->SubFormat, KSDATAFORMAT_SUBTYPE_PCM)) {
				tag = WAVE_FORMAT_PCM;
			}
		}
		if (channels == 0 || (bits != 16 && bits != 24 && bits != 32)) {
			return false;
		}
		return tag == WAVE_FORMAT_IEEE_FLOAT || tag == WAVE_FORMAT_PCM;
	}

	// Read one sample from a device buffer as float in [-1, 1].
	float readSample(const uint8_t *base, uint32_t sampleIndex) const {
		if (tag == WAVE_FORMAT_IEEE_FLOAT) {
			const auto *samples = reinterpret_cast<const float *>(base);
			return samples[sampleIndex];
		}
		if (bits == 16) {
			const auto *samples = reinterpret_cast<const int16_t *>(base);
			return static_cast<float>(samples[sampleIndex]) / 32768.0f;
		}
		if (bits == 24) {
			const auto *p = base + static_cast<size_t>(sampleIndex) * 3u;
			int32_t value =
				static_cast<int32_t>(p[0]) | (static_cast<int32_t>(p[1]) << 8) | (static_cast<int32_t>(p[2]) << 16);
			if ((value & 0x00800000) != 0) {
				value |= static_cast<int32_t>(0xFF000000);
			}
			return static_cast<float>(value) / 8388608.0f;
		}
		const auto *samples = reinterpret_cast<const int32_t *>(base);
		// 32-bit PCM with valid bits < 32 is left-aligned; shift it down first.
		const int shift = (validBits > 0 && validBits < 32) ? (32 - validBits) : 0;
		return static_cast<float>(samples[sampleIndex] >> shift) / 2147483648.0f;
	}
};

// Stateful mono resampler with linear interpolation. Deliberately the simplest
// correct algorithm: the host mirrors it in `audio/resample.ts`.
class MonoResampler {
public:
	explicit MonoResampler(uint32_t targetRate) : m_targetRate(targetRate) {}

	void reset(uint32_t sourceRate) {
		m_sourceRate = sourceRate;
		m_step = (sourceRate == 0 || sourceRate == m_targetRate)
					 ? 1.0
					 : static_cast<double>(sourceRate) / static_cast<double>(m_targetRate);
		m_position = 0.0;
		m_pending.clear();
	}

	void push(const std::vector<float> &mono) { m_pending.insert(m_pending.end(), mono.begin(), mono.end()); }

	// Produce as many output samples as the buffered input allows.
	void drain(std::vector<float> &out) {
		if (m_sourceRate == m_targetRate) {
			out.insert(out.end(), m_pending.begin(), m_pending.end());
			m_pending.clear();
			m_position = 0.0;
			return;
		}
		while (m_position + 1.0 < static_cast<double>(m_pending.size())) {
			const size_t index = static_cast<size_t>(m_position);
			const double frac = m_position - static_cast<double>(index);
			const float a = m_pending[index];
			const float b = m_pending[index + 1];
			out.push_back(static_cast<float>(a + (b - a) * frac));
			m_position += m_step;
		}
		// Drop consumed samples, keeping the interpolation carry-over.
		const size_t consumed = static_cast<size_t>(m_position);
		if (consumed > 0) {
			m_pending.erase(m_pending.begin(), m_pending.begin() + static_cast<std::ptrdiff_t>(consumed));
			m_position -= static_cast<double>(consumed);
		}
	}

	void flush(std::vector<float> &out) {
		if (m_sourceRate == m_targetRate) {
			out.insert(out.end(), m_pending.begin(), m_pending.end());
			m_pending.clear();
			return;
		}
		while (m_position < static_cast<double>(m_pending.size())) {
			const size_t index = static_cast<size_t>(m_position);
			const double frac = m_position - static_cast<double>(index);
			const float a = m_pending[index];
			const float b = (index + 1 < m_pending.size()) ? m_pending[index + 1] : a;
			out.push_back(static_cast<float>(a + (b - a) * frac));
			m_position += m_step;
		}
		m_pending.clear();
		m_position = 0.0;
	}

private:
	uint32_t m_targetRate = 16000;
	uint32_t m_sourceRate = 0;
	double m_step = 1.0;
	double m_position = 0.0;
	std::vector<float> m_pending;
};

// ── Command line ────────────────────────────────────────────────────────────

enum class Command { None, Probe, ListDevices, Capture, Serve, Version, Help };

struct Options {
	Command command = Command::None;
	std::string device = "default";
	uint32_t rate = static_cast<uint32_t>(kDefaultRate);
	uint16_t channels = static_cast<uint16_t>(kDefaultChannels);
};

// ── Control replies ─────────────────────────────────────────────────────────

void ReplyProbe(StdoutSink &sink) {
	std::vector<DeviceEntry> devices;
	const HRESULT hr = EnumerateCaptureDevices(devices);
	const int active = CountActive(devices);
	const bool available = SUCCEEDED(hr) && active > 0;
	std::string json = "{\"kind\":\"probe\",";
	json += "\"backend\":\"" + std::string(kBackend) + "\",";
	json += "\"version\":\"" + std::string(kHelperVersion) + "\",";
	json += std::string("\"available\":") + (available ? "true" : "false") + ",";
	json += "\"deviceCount\":" + std::to_string(devices.size()) + ",";
	json += "\"activeDeviceCount\":" + std::to_string(active) + ",";
	// Windows has no per-app permission prompt: capture either works, or the OS
	// privacy setting denies it (surfaced as E_ACCESSDENIED at capture start).
	json += "\"permission\":\"granted\",";
	json += "\"platform\":\"win32\",";
	json += "\"arch\":\"x64\"}";
	sink.writeJsonLine(json);
}

void ReplyListDevices(StdoutSink &sink) {
	std::vector<DeviceEntry> devices;
	const HRESULT hr = EnumerateCaptureDevices(devices);
	if (FAILED(hr)) {
		sink.writeJsonLine("{\"kind\":\"error\",\"code\":\"CAPTURE_ENUMERATION_FAILED\",\"devices\":[]}");
		return;
	}
	std::string json = "{\"kind\":\"devices\",\"devices\":[";
	for (size_t i = 0; i < devices.size(); ++i) {
		if (i > 0) {
			json += ",";
		}
		json += "{\"id\":\"" + JsonEscape(devices[i].id) + "\",";
		json += "\"name\":\"" + JsonEscape(devices[i].name) + "\",";
		json += "\"state\":\"" + devices[i].state + "\",";
		json += std::string("\"isDefault\":") + (devices[i].isDefault ? "true" : "false") + "}";
	}
	json += "]}";
	sink.writeJsonLine(json);
}

// ── Capture ─────────────────────────────────────────────────────────────────

struct CaptureSession {
	IMMDeviceEnumerator *enumerator = nullptr;
	IMMDevice *device = nullptr;
	IAudioClient *client = nullptr;
	IAudioCaptureClient *capture = nullptr;
	HANDLE audioEvent = nullptr;
	WAVEFORMATEX *mixFormat = nullptr;
	FormatConverter converter;
	MonoResampler resampler{kDefaultRate};
	uint32_t outRate = kDefaultRate;
	std::vector<float> monoScratch;
	std::vector<float> resampled;
	std::vector<int16_t> pcmScratch;

	void release() {
		if (audioEvent != nullptr) {
			::CloseHandle(audioEvent);
			audioEvent = nullptr;
		}
		SafeRelease(capture);
		if (client != nullptr) {
			client->Stop();
			client->Release();
			client = nullptr;
		}
		SafeRelease(device);
		SafeRelease(enumerator);
		if (mixFormat != nullptr) {
			::CoTaskMemFree(mixFormat);
			mixFormat = nullptr;
		}
	}
};

// Ask WASAPI for exactly the requested format so it converts internally, which
// keeps the helper's own conversion path off the hot path when available.
bool DeviceAcceptsRequestedFormat(IAudioClient *client, uint32_t rate, uint16_t channels) {
	WAVEFORMATEX desired{};
	desired.wFormatTag = WAVE_FORMAT_PCM;
	desired.nChannels = channels;
	desired.nSamplesPerSec = rate;
	desired.wBitsPerSample = 16;
	desired.nBlockAlign = static_cast<WORD>(desired.nChannels * desired.wBitsPerSample / 8);
	desired.nAvgBytesPerSec = desired.nSamplesPerSec * desired.nBlockAlign;
	desired.cbSize = 0;
	WAVEFORMATEX *closest = nullptr;
	const HRESULT hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, &desired, &closest);
	if (closest != nullptr) {
		::CoTaskMemFree(closest);
	}
	return hr == S_OK;
}

// Ask WASAPI for 16 kHz mono PCM16. Accepted formats are 1..2 bytes/sample and
// small, so this does not rely on an untrusted `cbSize` for stack space.
bool BuildRequestedFormat(uint32_t rate, uint16_t channels, WAVEFORMATEXTENSIBLE &storage, WAVEFORMATEX &out) {
	::ZeroMemory(&storage, sizeof(storage));
	storage.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
	storage.Format.nChannels = channels;
	storage.Format.nSamplesPerSec = rate;
	storage.Format.wBitsPerSample = 16;
	storage.Format.nBlockAlign = static_cast<WORD>(channels * 16 / 8);
	storage.Format.nAvgBytesPerSec = rate * storage.Format.nBlockAlign;
	storage.Format.cbSize = static_cast<WORD>(sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX));
	storage.Samples.wValidBitsPerSample = 16;
	storage.dwChannelMask = (channels == 1) ? SPEAKER_FRONT_CENTER : (SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT);
	storage.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;
	out = storage.Format;
	return true;
}


bool InitializeClient(CaptureSession &session, uint32_t rate, uint16_t channels, const std::string &deviceId,
					  std::string &errorCode) {
	HRESULT hr = ::CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator),
									reinterpret_cast<void **>(&session.enumerator));
	if (FAILED(hr)) {
		errorCode = ErrorCodeFromHresult(hr);
		diag("enumerator_failed", 0, hr);
		return false;
	}

	const bool useDefault = deviceId.empty() || deviceId == "default";
	if (useDefault) {
		// `default` is resolved at capture start, not at argument parse time.
		hr = session.enumerator->GetDefaultAudioEndpoint(eCapture, eConsole, &session.device);
	} else {
		const int needed = ::MultiByteToWideChar(CP_UTF8, 0, deviceId.c_str(), -1, nullptr, 0);
		std::wstring wide(static_cast<size_t>(std::max(needed, 1)), L'\0');
		if (needed > 0) {
			::MultiByteToWideChar(CP_UTF8, 0, deviceId.c_str(), -1, wide.data(), needed);
		}
		hr = session.enumerator->GetDevice(wide.c_str(), &session.device);
	}
	if (FAILED(hr) || session.device == nullptr) {
		errorCode = useDefault ? "CAPTURE_NO_DEVICE" : ErrorCodeFromHresult(hr);
		diag("device_open_failed", 0, hr);
		return false;
	}

	hr = session.device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
								  reinterpret_cast<void **>(&session.client));
	if (FAILED(hr) || session.client == nullptr) {
		errorCode = ErrorCodeFromHresult(hr);
		diag("activate_failed", 0, hr);
		return false;
	}

	const bool negotiated = DeviceAcceptsRequestedFormat(session.client, rate, channels);
	hr = session.client->GetMixFormat(&session.mixFormat);
	if (FAILED(hr) || session.mixFormat == nullptr) {
		errorCode = "CAPTURE_UNSUPPORTED_FORMAT";
		diag("mix_format_failed", 0, hr);
		return false;
	}

	// Shared-mode capture on this class of device mixes at 48 kHz stereo float32
	// (measured in F0). WASAPI's internal conversion for a 16 kHz mono request is
	// not a no-op, so unless the device reports it natively we take the mix
	// format and normalise it ourselves — explicit, and identical to the host's
	// `core/voice/audio/*` contract.
	WAVEFORMATEX *format = session.mixFormat;
	WAVEFORMATEXTENSIBLE requestedStorage;
	WAVEFORMATEX requestedFormat;
	if (negotiated) {
		BuildRequestedFormat(rate, channels, requestedStorage, requestedFormat);
		format = &requestedFormat;
	}
	session.outRate = rate;

	if (!session.converter.configure(format)) {
		errorCode = "CAPTURE_UNSUPPORTED_FORMAT";
		diag("convert_configure_failed", static_cast<int>(format->wFormatTag));
		return false;
	}
	session.resampler.reset(session.converter.rate);

	// 200 ms shared-mode buffer; the host drains far more often than that.
	const REFERENCE_TIME bufferDuration = 2000000;
	hr = session.client->Initialize(AUDCLNT_SHAREMODE_SHARED,
									AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST, bufferDuration,
									0, format, nullptr);
	if (FAILED(hr)) {
		errorCode = ErrorCodeFromHresult(hr);
		diag("initialize_failed", 0, hr);
		return false;
	}

	session.audioEvent = ::CreateEventW(nullptr, FALSE, FALSE, nullptr);
	if (session.audioEvent == nullptr) {
		errorCode = "CAPTURE_HELPER_ERROR";
		return false;
	}
	hr = session.client->SetEventHandle(session.audioEvent);
	if (FAILED(hr)) {
		errorCode = ErrorCodeFromHresult(hr);
		return false;
	}
	hr = session.client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void **>(&session.capture));
	if (FAILED(hr) || session.capture == nullptr) {
		errorCode = ErrorCodeFromHresult(hr);
		return false;
	}
	return true;
}

// Pull every available packet, normalise it, and write it out as frames.
// Returns false when stdout is gone (the host closed the pipe) or the device was
// invalidated — both mean "stop capturing".
bool PumpOnce(CaptureSession &session, StdoutSink &sink, uint64_t &framesOut, uint64_t &bytesOut) {
	UINT32 packetFrames = 0;
	HRESULT hr = session.capture->GetNextPacketSize(&packetFrames);
	if (FAILED(hr)) {
		diag("get_next_packet_failed", 0, hr);
		return hr != AUDCLNT_E_DEVICE_INVALIDATED;
	}
	while (packetFrames > 0) {
		BYTE *data = nullptr;
		UINT32 available = 0;
		DWORD flags = 0;
		hr = session.capture->GetBuffer(&data, &available, &flags, nullptr, nullptr);
		if (FAILED(hr)) {
			diag("get_buffer_failed", 0, hr);
			return hr != AUDCLNT_E_DEVICE_INVALIDATED;
		}
		if (available > 0) {
			if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nullptr) {
				session.monoScratch.assign(available, 0.0f);
			} else {
				session.monoScratch.resize(available);
				const uint32_t channels = session.converter.channels;
				for (UINT32 i = 0; i < available; ++i) {
					float sum = 0.0f;
					for (uint32_t c = 0; c < channels; ++c) {
						sum += session.converter.readSample(data, i * channels + c);
					}
					// Average, never sum: summing clips on dense mixes.
					session.monoScratch[i] = sum / static_cast<float>(channels);
				}
			}
			session.resampled.clear();
			session.resampler.push(session.monoScratch);
			session.resampler.drain(session.resampled);
			if (!session.resampled.empty()) {
				session.pcmScratch.resize(session.resampled.size());
				for (size_t i = 0; i < session.resampled.size(); ++i) {
					session.pcmScratch[i] = FloatToPcm16(session.resampled[i]);
				}
				const uint32_t payloadBytes = static_cast<uint32_t>(session.pcmScratch.size() * sizeof(int16_t));
				if (payloadBytes > kMaxFramePayload) {
					diag("frame_too_large", static_cast<int>(payloadBytes));
				} else if (!WriteFrame(sink, reinterpret_cast<const uint8_t *>(session.pcmScratch.data()), payloadBytes,
									   session.outRate, 1, 16)) {
					session.capture->ReleaseBuffer(available);
					return false; // host closed stdout
				} else {
					++framesOut;
					bytesOut += payloadBytes;
				}
			}
		}
		session.capture->ReleaseBuffer(available);
		hr = session.capture->GetNextPacketSize(&packetFrames);
		if (FAILED(hr)) {
			break;
		}
	}
	return true;
}

// Runs a capture until stdin closes (`q`/newline also stops it), stdout breaks,
// or the device is invalidated. The stdin watch is what guarantees the helper
// never outlives the extension host: the host's pipe closing at exit is EOF.
//
// stdout is unbuffered (`_IONBF`): the frames must reach the host as they are
// captured, not in one block when the process exits.
int RunCapture(const Options &options, StdoutSink &sink) {
	std::setvbuf(stdout, nullptr, _IONBF, 0);
	sink.writeJsonLine("{\"kind\":\"captureStarted\",\"backend\":\"" + std::string(kBackend) +
					   "\",\"sampleRate\":" + std::to_string(options.rate) + ",\"channels\":1}");

	CaptureSession session;
	std::string errorCode;
	if (!InitializeClient(session, options.rate, options.channels, options.device, errorCode)) {
		session.release();
		sink.writeJsonLine("{\"kind\":\"error\",\"code\":\"" + errorCode + "\"}");
		return 0;
	}

	HRESULT hr = session.client->Start();
	if (FAILED(hr)) {
		const std::string code = ErrorCodeFromHresult(hr);
		session.release();
		sink.writeJsonLine("{\"kind\":\"error\",\"code\":\"" + code + "\"}");
		return 0;
	}

	HANDLE stdinHandle = ::GetStdHandle(STD_INPUT_HANDLE);
	const bool watchStdin = stdinHandle != nullptr && stdinHandle != INVALID_HANDLE_VALUE &&
							::GetFileType(stdinHandle) == FILE_TYPE_PIPE;

	uint64_t framesOut = 0;
	uint64_t bytesOut = 0;
	bool finished = false;

	while (!finished) {
		const DWORD wait = ::WaitForSingleObject(session.audioEvent, 100);
		if (wait == WAIT_OBJECT_0) {
			if (!PumpOnce(session, sink, framesOut, bytesOut)) {
				finished = true;
			}
		} else if (wait == WAIT_FAILED) {
			finished = true;
		}
		if (finished) {
			break;
		}
		// A closed (or "q") stdin means the host is gone: stop and exit.
		if (watchStdin) {
			DWORD available = 0;
			if (!::PeekNamedPipe(stdinHandle, nullptr, 0, nullptr, &available, nullptr)) {
				finished = true;
				continue;
			}
			if (available > 0) {
				char buffer[128];
				DWORD read = 0;
				if (!::ReadFile(stdinHandle, buffer, sizeof(buffer), &read, nullptr) || read == 0) {
					finished = true;
					continue;
				}
				for (DWORD i = 0; i < read; ++i) {
					if (buffer[i] == 'q' || buffer[i] == '\n') {
						finished = true;
					}
				}
			}
		}
	}

	session.client->Stop();
	PumpOnce(session, sink, framesOut, bytesOut); // drain what the device already had
	session.release();

	sink.writeJsonLine("{\"kind\":\"captureStopped\",\"frames\":" + std::to_string(framesOut) +
					   ",\"bytes\":" + std::to_string(bytesOut) + "}");
	return 0;
}

// ── Argument parsing ────────────────────────────────────────────────────────

bool ParseArgs(int argc, char **argv, Options &options) {
	for (int i = 1; i < argc; ++i) {
		const std::string arg = argv[i];
		if (arg == "--probe") {
			options.command = Command::Probe;
		} else if (arg == "--list-devices") {
			options.command = Command::ListDevices;
		} else if (arg == "--capture") {
			options.command = Command::Capture;
		} else if (arg == "--version") {
			options.command = Command::Version;
		} else if (arg == "--help" || arg == "-h") {
			options.command = Command::Help;
		} else if (arg == "--device" && i + 1 < argc) {
			options.device = argv[++i];
		} else if (arg == "--rate" && i + 1 < argc) {
			const long value = std::strtol(argv[++i], nullptr, 10);
			if (value <= 0 || value > 192000) {
				return false;
			}
			options.rate = static_cast<uint32_t>(value);
		} else if (arg == "--channels" && i + 1 < argc) {
			const long value = std::strtol(argv[++i], nullptr, 10);
			if (value <= 0 || value > 2) {
				return false;
			}
			options.channels = static_cast<uint16_t>(value);
		} else {
			return false;
		}
	}
	return options.command != Command::None;
}

} // namespace

int main(int argc, char **argv) {
	// Device names are UTF-8 on the wire; make our own console agree.
	::SetConsoleOutputCP(CP_UTF8);

	Options options;
	if (!ParseArgs(argc, argv, options)) {
		diag("invalid_arguments");
		StdoutSink sink;
		sink.writeJsonLine("{\"kind\":\"error\",\"code\":\"HELPER_INVALID_ARGUMENT\"}");
		return 2;
	}

	StdoutSink sink;
	switch (options.command) {
	case Command::Version:
		sink.writeJsonLine("{\"kind\":\"version\",\"version\":\"" + std::string(kHelperVersion) + "\"}");
		return 0;
	case Command::Help:
		sink.writeJsonLine("{\"kind\":\"help\",\"version\":\"" + std::string(kHelperVersion) +
						   "\",\"commands\":[\"--probe\",\"--list-devices\",\"--capture\",\"--version\",\"--help\"]}");
		return 0;
	default:
		break;
	}

	ComScope com;
	if (!com.ok()) {
		diag("com_init_failed", 0, com.hr);
		sink.writeJsonLine("{\"kind\":\"error\",\"code\":\"CAPTURE_COM_INIT_FAILED\"}");
		return 0;
	}

	switch (options.command) {
	case Command::Probe:
		ReplyProbe(sink);
		return 0;
	case Command::ListDevices:
		ReplyListDevices(sink);
		return 0;
	case Command::Capture:
		return RunCapture(options, sink);
	default:
		return 2;
	}
}
