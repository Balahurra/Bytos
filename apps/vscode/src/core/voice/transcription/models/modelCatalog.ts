import { VoiceError } from "../../types"

/**
 * Pinned whisper.cpp artifacts (F2, TD-8 / §12.1).
 *
 * ## Why Bytos pins everything itself
 *
 * `VOICE-F1-IMPLEMENTATION-PLAN.md` §12.1 requires that neither the binary nor a
 * model is trusted from upstream metadata. F2 re-measured the GitHub release API
 * for nightly `b5454`: the published `digest` for `whisper-bin-x64.zip`
 * (`sha256:6ba69e34…`) DOES match the served bytes today, but the F0 audit
 * recorded a mismatch and a nightly tag can be replaced at any time. Both facts
 * lead to the same rule: the values below are the SHA-256 Bytos computed from the
 * exact bytes it verified, and they are the only thing trusted at runtime.
 *
 * ## Measurements (Windows 11 x64, this host, 2026-11-08)
 *
 * | Artifact | Bytes | SHA-256 |
 * |---|---|---|
 * | `whisper-bin-x64.zip` (b5454) | 8 928 640 | `6ba69e34…5d816ccb` |
 * | `ggml-tiny.bin` | 77 691 713 | `be07e048…9c6e1b21` |
 * | `ggml-base.bin` | 147 951 465 | `60ed5bc3…5fba2efe` |
 *
 * The model sizes match the F0 measurement exactly (77 691 713 B / 147 951 465 B),
 * which independently confirms these are the real models.
 */

/** Environment override for the whisper engine directory. */
export const WHISPER_ENGINE_DIR_ENV = "BYTOS_WHISPER_ENGINE_DIR"
/** Environment override for the model directory. */
export const WHISPER_MODEL_DIR_ENV = "BYTOS_WHISPER_MODEL_DIR"

/** One file of the pinned binary set, verified by exact size and SHA-256. */
export interface PinnedBinaryFile {
	fileName: string
	sizeBytes: number
	sha256: string
}

/**
 * Everything `whisper-cli.exe` loads at runtime on Windows.
 *
 * `whisper-cli.exe` alone is not a runnable engine, and a swapped `whisper.dll`
 * is exactly the attack the pinning exists to prevent, so the engine refuses to
 * run unless the whole closure verifies.
 */
export interface PinnedBinary {
	/** Upstream release tag the bytes came from. Informational only. */
	releaseTag: string
	/** Directory under the engine root that holds the executable. */
	subdir: string
	executable: string
	files: readonly PinnedBinaryFile[]
	/** Upstream project licence, for the notices file. */
	license: string
	projectUrl: string
}

export const PINNED_WHISPER_BINARY: PinnedBinary = {
	releaseTag: "b5454",
	subdir: "b5454",
	executable: "whisper-cli.exe",
	license: "MIT",
	projectUrl: "https://github.com/ggml-org/whisper.cpp",
	files: [
		{
			fileName: "whisper-cli.exe",
			sizeBytes: 479744,
			sha256: "331dba46d6427105d2b802cdbc7eae916ea1c5abf9b0d3b5cfe460d8db8e4366",
		},
		{
			fileName: "whisper.dll",
			sizeBytes: 1370112,
			sha256: "034396d75bb5720c1851674ff64a96192b58f6927b68d334ebd254ce6cad9674",
		},
		{
			fileName: "ggml.dll",
			sizeBytes: 62464,
			sha256: "31fe18616d872af9b6134b47a6dff8072ae4ecbe5df0273f4f8dc36766c9db8e",
		},
		{
			fileName: "ggml-base.dll",
			sizeBytes: 693248,
			sha256: "bede0d6b2d387236ecd2b5dd676d51c8984b5b6e0ae461a12174e9c01345c5f0",
		},
		// Pulled in by ggml.dll's backend loader; verified because an unverified
		// DLL would make the engine unverified.
		{
			fileName: "llama.dll",
			sizeBytes: 2755072,
			sha256: "74b7857b05951c0dff4c7baf796205433c84ee40c9bbb0bda3f182d4425ce339",
		},
	],
}

/**
 * The ggml CPU backend DLLs shipped in the pinned archive.
 *
 * ggml picks exactly one at load time from the host CPU's feature set (measured:
 * `ggml-cpu-cascadelake.dll` on the reference host), so Bytos cannot know in
 * advance which will be used. Every one is therefore verified, and the engine
 * requires the whole set to be present and correct.
 */
export const PINNED_CPU_BACKENDS: readonly PinnedBinaryFile[] = [
	{
		fileName: "ggml-cpu-alderlake.dll",
		sizeBytes: 1009664,
		sha256: "d8f5c56ea490394eeae8b271650f2647aecd039a542d6df9e0140726e62a4603",
	},
	{
		fileName: "ggml-cpu-cannonlake.dll",
		sizeBytes: 1049600,
		sha256: "74127b40abd4f595d9db6af0fa313a02e18ff42fc228bfa05281e7c788dd4507",
	},
	{
		fileName: "ggml-cpu-cascadelake.dll",
		sizeBytes: 1061376,
		sha256: "4b11c427b844eeac87529af9a8d94b35aad2024666beb2a35e59fe3077e4b81e",
	},
	{
		fileName: "ggml-cpu-haswell.dll",
		sizeBytes: 1010688,
		sha256: "1306b1014c8118d27234d8ddc0e66ced1f8c8476bf85071595fd182ea9b7263b",
	},
	{
		fileName: "ggml-cpu-icelake.dll",
		sizeBytes: 1061376,
		sha256: "2b4dc4c66e7d8fe2807283816e9cf3b7f7d0556f59df34069871e37eab8aed40",
	},
	{
		fileName: "ggml-cpu-sandybridge.dll",
		sizeBytes: 1026560,
		sha256: "04edbdebc01a1d421062a960881a4f34d520d99693999518243f332406444c6e",
	},
	{
		fileName: "ggml-cpu-skylakex.dll",
		sizeBytes: 1049600,
		sha256: "1774714cf93621406ff35344b54715619a83242ae3e331e44d98a3b35ce801be",
	},
	{
		fileName: "ggml-cpu-sse42.dll",
		sizeBytes: 862720,
		sha256: "f060318772c4c2dbac312bbfff6ea700b85dbc502bb38585a7186d06d549301a",
	},
	{
		fileName: "ggml-cpu-x64.dll",
		sizeBytes: 866816,
		sha256: "4b4b05caba40d4309b5d710ef74c59ba190516b8489f27bdb1ba11ae33c6e9d3",
	},
]

export interface ModelPin {
	id: "tiny" | "base"
	fileName: string
	sizeBytes: number
	sha256: string
	url: string
	tier: "fast" | "balanced"
	approxResidentMemoryMb: number
	multilingual: boolean
}

/**
 * Verified multilingual models.
 *
 * The `.en` variants are deliberately absent: they cannot transcribe Turkish or
 * German, so offering them would be a capability claim Bytos cannot honour
 * (mission rule 8 — do not offer what is not actually supported).
 */
export const PINNED_MODELS: Readonly<Record<"tiny" | "base", ModelPin>> = {
	tiny: {
		id: "tiny",
		fileName: "ggml-tiny.bin",
		sizeBytes: 77691713,
		sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
		tier: "fast",
		approxResidentMemoryMb: 190,
		multilingual: true,
	},
	base: {
		id: "base",
		fileName: "ggml-base.bin",
		sizeBytes: 147951465,
		sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
		tier: "balanced",
		approxResidentMemoryMb: 297,
		multilingual: true,
	},
}

/**
 * Default model. `base` wins on measurement: on the F2 corpus `tiny` mangled
 * Turkish and German content words, while `base` reproduced them, and the
 * measured peak working set (302 MB) is acceptable for a desktop editor.
 * `tiny` stays available for low-memory machines and is ~2× faster.
 */
export const DEFAULT_MODEL_ID = "base" as const

export function isKnownModelId(value: unknown): value is "tiny" | "base" {
	return value === "tiny" || value === "base"
}

export function getModelPin(modelId: unknown): ModelPin {
	if (!isKnownModelId(modelId)) {
		throw new VoiceError("MODEL_UNKNOWN", `Unknown whisper model: ${String(modelId)}`)
	}
	return PINNED_MODELS[modelId]
}

/** All models, cheapest first — the order a picker should show them in. */
export function listModels(): ModelPin[] {
	return [PINNED_MODELS.tiny, PINNED_MODELS.base]
}

/**
 * Only Windows x64 is supported, matching F1: the pinned artifact is a Windows
 * x64 build and F2 makes no claim about any other platform.
 */
export const WHISPER_SUPPORTED_PLATFORM = "win32"
export const WHISPER_SUPPORTED_ARCH = "x64"

export function isWhisperPlatformSupported(platform: string, arch: string): boolean {
	return platform === WHISPER_SUPPORTED_PLATFORM && arch === WHISPER_SUPPORTED_ARCH
}

/** Human-readable size, used when disclosing the download before consent. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "unknown"
	const mib = bytes / (1024 * 1024)
	return `${mib.toFixed(1)} MiB`
}
