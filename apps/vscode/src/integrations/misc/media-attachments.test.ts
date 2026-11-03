import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
	describeMediaToolRequirement,
	detectMediaToolchain,
	extractVideoFrames,
	type RunCommand,
	transcribeAudio,
} from "./media-attachments"

function commandError(code: string): NodeJS.ErrnoException {
	const error = new Error(code) as NodeJS.ErrnoException
	error.code = code
	return error
}

describe("detectMediaToolchain", () => {
	it("reports missing tools", async () => {
		const run: RunCommand = async () => {
			throw commandError("ENOENT")
		}

		await expect(detectMediaToolchain(run)).resolves.toEqual({
			ffmpeg: false,
			ffprobe: false,
			whisper: undefined,
		})
	})

	it("detects ffmpeg, ffprobe and whisper", async () => {
		const run: RunCommand = async (command) => {
			if (command === "ffmpeg" || command === "ffprobe" || command === "whisper") {
				return { stdout: "ok", stderr: "" }
			}
			throw commandError("ENOENT")
		}

		await expect(detectMediaToolchain(run)).resolves.toEqual({
			ffmpeg: true,
			ffprobe: true,
			whisper: "whisper",
		})
	})
})

describe("extractVideoFrames", () => {
	it("returns undefined when ffmpeg is missing", async () => {
		const run: RunCommand = async () => {
			throw commandError("ENOENT")
		}

		await expect(extractVideoFrames("/tmp/clip.mp4", { run })).resolves.toBeUndefined()
	})

	it("samples frames and returns metadata plus images", async () => {
		const run: RunCommand = async (command, args) => {
			if (command === "ffmpeg" && args[0] === "-version") {
				return { stdout: "ffmpeg", stderr: "" }
			}
			if (command === "ffprobe" && args[0] === "-version") {
				return { stdout: "ffprobe", stderr: "" }
			}
			if (command === "ffprobe") {
				return {
					stdout: JSON.stringify({
						format: { duration: "10" },
						streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
					}),
					stderr: "",
				}
			}
			if (command === "ffmpeg") {
				const outputPath = args[args.length - 1]
				await fs.writeFile(outputPath, "jpeg")
				return { stdout: "", stderr: "" }
			}
			throw commandError("ENOENT")
		}

		const content = await extractVideoFrames("/tmp/clip.mp4", { run, maxFrames: 3 })

		expect(content).toHaveLength(4)
		expect(content?.[0]).toMatchObject({ type: "text" })
		expect((content?.[0] as { text: string }).text).toContain("duration: 10.0s")
		expect(content?.slice(1).every((block) => block.type === "image")).toBe(true)
	})
})

describe("transcribeAudio", () => {
	it("returns undefined when Whisper is missing", async () => {
		const run: RunCommand = async () => {
			throw commandError("ENOENT")
		}

		await expect(transcribeAudio("/tmp/voice.mp3", { run })).resolves.toBeUndefined()
	})

	it("returns the transcript written by Whisper", async () => {
		const run: RunCommand = async (command, args) => {
			if (command === "ffmpeg" || command === "ffprobe" || command === "whisper") {
				if (args[0] === "--help") {
					return { stdout: "help", stderr: "" }
				}
				const outputDir = args[args.indexOf("--output_dir") + 1]
				if (outputDir) {
					await fs.writeFile(path.join(outputDir, "voice.txt"), "transcribed text")
				}
				return { stdout: "", stderr: "" }
			}
			throw commandError("ENOENT")
		}

		await expect(transcribeAudio("/tmp/voice.mp3", { run })).resolves.toBe("transcribed text")
	})
})

describe("describeMediaToolRequirement", () => {
	it("names the required tools", () => {
		expect(describeMediaToolRequirement("video")).toContain("ffmpeg")
		expect(describeMediaToolRequirement("audio")).toContain("Whisper")
	})
})
