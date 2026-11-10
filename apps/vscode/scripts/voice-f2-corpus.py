#!/usr/bin/env python3
"""Generate the F2 speech corpus: real speech in Turkish, English and German.

DEVELOPMENT TOOL. It is not part of the extension and is never invoked at
runtime; it exists so the audio fixtures under `test-assets/voice-f2/audio/` can
be reproduced instead of being opaque binary blobs.

Requirements:
    python -m pip install edge-tts miniaudio

The output is 16 kHz mono PCM16 WAV — byte-for-byte the format the F1 capture
path produces and the only format the F2 engine accepts.

Voices are Microsoft Edge neural TTS voices, chosen per language:
    tr-TR-EmelNeural, tr-TR-AhmetNeural, en-US-AriaNeural, en-US-GuyNeural,
    de-DE-KatjaNeural, de-DE-ConradNeural

NOTE: this is synthetic speech. It proves the pipeline recovers words in each
language; it is NOT a substitute for a human-recorded accuracy study.
"""

from __future__ import annotations

import argparse
import asyncio
import pathlib
import sys
import wave

TARGET_RATE = 16000

# clip id, voice, language, spoken text
CLIPS: list[tuple[str, str, str, str]] = [
    (
        "en_numbers",
        "en-US-GuyNeural",
        "en",
        "The quick brown fox jumps over the lazy dog.",
    ),
    (
        "en_hello",
        "en-US-AriaNeural",
        "en",
        "Hello, this is a voice transcription test for the Bytos editor extension.",
    ),
    (
        "tr_merhaba",
        "tr-TR-EmelNeural",
        "tr",
        "Merhaba, bu bir ses tanıma testidir. Bytos kod düzenleyicisi için çalışıyor.",
    ),
    (
        "tr_komut",
        "tr-TR-AhmetNeural",
        "tr",
        "Lütfen dosyayı aç ve içindeki hataları düzelt.",
    ),
    (
        "de_hallo",
        "de-DE-KatjaNeural",
        "de",
        "Guten Tag, dies ist ein Test für die Spracherkennung.",
    ),
    (
        "de_satz",
        "de-DE-ConradNeural",
        "de",
        "Bitte öffne die Datei und behebe die Fehler im Code.",
    ),
]


async def synthesise(clip_id: str, voice: str, text: str, out_dir: pathlib.Path) -> pathlib.Path:
    """Render one clip to MP3 and return the path."""
    import edge_tts

    mp3 = out_dir / f"{clip_id}.mp3"
    await edge_tts.Communicate(text, voice).save(str(mp3))
    return mp3


def to_wav(mp3: pathlib.Path) -> pathlib.Path:
    """Decode to 16 kHz mono PCM16 with miniaudio — whisper's own decoder."""
    import miniaudio

    decoded = miniaudio.decode_file(
        str(mp3),
        output_format=miniaudio.SampleFormat.SIGNED16,
        nchannels=1,
        sample_rate=TARGET_RATE,
    )
    wav_path = mp3.with_suffix(".wav")
    with wave.open(str(wav_path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(TARGET_RATE)
        handle.writeframes(decoded.samples.tobytes())
    return wav_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parent.parent / "test-assets" / "voice-f2" / "audio",
        help="output directory for the generated clips",
    )
    parser.add_argument("--keep-mp3", action="store_true", help="keep the intermediate MP3 files")
    args = parser.parse_args()

    out_dir: pathlib.Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    for clip_id, voice, language, text in CLIPS:
        try:
            mp3 = asyncio.run(synthesise(clip_id, voice, text, out_dir))
            wav_path = to_wav(mp3)
            if not args.keep_mp3:
                mp3.unlink(missing_ok=True)
            seconds = (wav_path.stat().st_size - 44) / 2 / TARGET_RATE
            print(f"{wav_path.name}: {language} {voice} {seconds:.2f}s")
        except Exception as error:  # noqa: BLE001 - a fixture generator reports and continues
            print(f"FAILED {clip_id} ({voice}): {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
