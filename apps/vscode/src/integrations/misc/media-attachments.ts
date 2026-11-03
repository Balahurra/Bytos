import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { UserFileContentBlock } from "@bytos/shared"
import { truncateContent } from "@/shared/content-limits"
import { Logger } from "@/shared/services/Logger"

/**
 * Optional video/audio processing with external tools.
 *
 * Native media is handled by the file loader when the model advertises the
 * matching input modality. These helpers cover the fallback path:
 * - video → a few sampled frames + metadata (ffmpeg/ffprobe)
 * - audio → a text transcript (an installed Whisper CLI)
 *
 * Nothing is bundled; missing tools produce a clear, actionable error.
 */

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 60_000
const TRANSCRIBE_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_FRAMES = 4
const DEFAULT_FRAME_WIDTH = 1280
const MAX_VIDEO_SECONDS = 10 * 60

export interface RunCommandResult {
	stdout: string
	stderr: string
}

export type RunCommand = (command: string, args: string[], options?: { timeout?: number }) => Promise<RunCommandResult>

const defaultRunCommand: RunCommand = async (command, args, options) => {
	const { stdout, stderr } = await execFileAsync(command, args, {
		timeout: options?.timeout ?? COMMAND_TIMEOUT_MS,
		maxBuffer: 20 * 1024 * 1024,
		windowsHide: true,
	})
	return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }
}

async function commandAvailable(run: RunCommand, command: string, args: string[]): Promise<boolean> {
	try {
		await run(command, args, { timeout: 5_000 })
		return true
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code
		return code !== "ENOENT" && code !== "EACCES"
	}
}

export interface MediaToolchain {
	ffmpeg: boolean
	ffprobe: boolean
	whisper?: "whisper" | "whisper-ctranslate2"
}

export async function detectMediaToolchain(run: RunCommand = defaultRunCommand): Promise<MediaToolchain> {
	const [ffmpeg, ffprobe] = await Promise.all([
		commandAvailable(run, "ffmpeg", ["-version"]),
		commandAvailable(run, "ffprobe", ["-version"]),
	])
	const whisper = (await commandAvailable(run, "whisper", ["--help"]))
		? "whisper"
		: (await commandAvailable(run, "whisper-ctranslate2", ["--help"]))
			? "whisper-ctranslate2"
			: undefined
	return { ffmpeg, ffprobe, whisper }
}

export function describeMediaToolRequirement(kind: "video" | "audio"): string {
	if (kind === "audio") {
		return (
			"Audio transcription requires an installed Whisper CLI (`whisper` or `whisper-ctranslate2`) on PATH. " +
			"Install one with `pip install -U openai-whisper` or `pip install -U whisper-ctranslate2`."
		)
	}
	return (
		"Video frame extraction requires ffmpeg/ffprobe on PATH. " +
		"Install ffmpeg (macOS: brew install ffmpeg; Linux: apt install ffmpeg; Windows: install ffmpeg and add its bin folder to PATH)."
	)
}

export interface VideoProbe {
	durationSeconds?: number
	width?: number
	height?: number
	codec?: string
}

export async function probeVideo(filePath: string, run: RunCommand = defaultRunCommand): Promise<VideoProbe> {
	try {
		const { stdout } = await run(
			"ffprobe",
			["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
			{ timeout: COMMAND_TIMEOUT_MS },
		)
		const parsed = JSON.parse(stdout) as {
			format?: { duration?: string }
			streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>
		}
		const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video")
		const duration = Number(parsed.format?.duration ?? videoStream?.duration)
		return {
			durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
			width: videoStream?.width,
			height: videoStream?.height,
			codec: videoStream?.codec_name,
		}
	} catch (error) {
		Logger.warn(`[Media] ffprobe failed for ${filePath}:`, error)
		return {}
	}
}

export interface VideoFrameOptions {
	run?: RunCommand
	maxFrames?: number
	frameWidth?: number
}

/**
 * Sample a few frames from a video and return them as image content plus a
 * metadata text block. Uses only ffmpeg/ffprobe; returns undefined when the
 * toolchain is missing.
 */
export async function extractVideoFrames(
	filePath: string,
	options: VideoFrameOptions = {},
): Promise<UserFileContentBlock[] | undefined> {
	const run = options.run ?? defaultRunCommand
	if (!(await commandAvailable(run, "ffmpeg", ["-version"]))) {
		return undefined
	}
	const maxFrames = Math.max(1, Math.min(8, options.maxFrames ?? DEFAULT_MAX_FRAMES))
	const frameWidth = Math.max(320, options.frameWidth ?? DEFAULT_FRAME_WIDTH)
	const probe = await probeVideo(filePath, run)
	const duration = Math.min(probe.durationSeconds ?? maxFrames, MAX_VIDEO_SECONDS)
	const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-video-"))

	try {
		const timestamps = Array.from({ length: maxFrames }, (_, index) => {
			const ratio = maxFrames === 1 ? 0.1 : 0.05 + (index / (maxFrames - 1)) * 0.9
			return Math.max(0, duration * ratio)
		})

		const images: UserFileContentBlock[] = []
		for (const [index, timestamp] of timestamps.entries()) {
			const outputPath = path.join(outputDir, `frame-${index + 1}.jpg`)
			try {
				await run(
					"ffmpeg",
					[
						"-y",
						"-ss",
						timestamp.toFixed(2),
						"-i",
						filePath,
						"-frames:v",
						"1",
						"-vf",
						`scale=${frameWidth}:-2`,
						"-q:v",
						"4",
						outputPath,
					],
					{ timeout: COMMAND_TIMEOUT_MS },
				)
				const data = await fs.readFile(outputPath)
				images.push({
					type: "image",
					data: data.toString("base64"),
					mediaType: "image/jpeg",
				})
			} catch (error) {
				Logger.warn(`[Media] ffmpeg frame extraction failed at ${timestamp.toFixed(2)}s:`, error)
			}
		}

		if (images.length === 0) {
			return undefined
		}

		const meta = [
			`Video attachment: ${path.basename(filePath)}`,
			probe.durationSeconds ? `duration: ${probe.durationSeconds.toFixed(1)}s` : undefined,
			probe.width && probe.height ? `resolution: ${probe.width}x${probe.height}` : undefined,
			probe.codec ? `codec: ${probe.codec}` : undefined,
			`sampled frames: ${images.length}`,
		]
			.filter(Boolean)
			.join(", ")

		return [{ type: "text", text: `[${meta}]` }, ...images]
	} finally {
		await fs.rm(outputDir, { recursive: true, force: true }).catch((error) => {
			Logger.warn(`[Media] Could not clean up ${outputDir}:`, error)
		})
	}
}

export interface AudioTranscriptionOptions {
	run?: RunCommand
	language?: string
	model?: string
}

/** Transcribe an audio/video file with an installed Whisper CLI. */
export async function transcribeAudio(filePath: string, options: AudioTranscriptionOptions = {}): Promise<string | undefined> {
	const run = options.run ?? defaultRunCommand
	const toolchain = await detectMediaToolchain(run)
	const whisper = toolchain.whisper
	if (!whisper) {
		return undefined
	}
	const model = options.model?.trim() || "base"
	const language = options.language?.trim()
	const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-audio-"))
	try {
		const args = [filePath, "--model", model, "--output_format", "txt", "--output_dir", outputDir, "--task", "transcribe"]
		if (language) {
			args.push("--language", language)
		}
		await run(whisper, args, { timeout: TRANSCRIBE_TIMEOUT_MS })
		const files = (await fs.readdir(outputDir)).filter((file) => file.toLowerCase().endsWith(".txt"))
		if (files.length === 0) {
			return undefined
		}
		const text = (await fs.readFile(path.join(outputDir, files[0]), "utf8")).trim()
		return text ? truncateContent(text) : undefined
	} catch (error) {
		Logger.warn(`[Media] Audio transcription failed for ${filePath}:`, error)
		return undefined
	} finally {
		await fs.rm(outputDir, { recursive: true, force: true }).catch((error) => {
			Logger.warn(`[Media] Could not clean up ${outputDir}:`, error)
		})
	}
}
