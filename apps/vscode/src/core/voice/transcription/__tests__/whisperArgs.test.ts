import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { VoiceError } from "../../types"
import {
	buildWhisperArgs,
	DEFAULT_WHISPER_THREADS,
	defaultWhisperThreads,
	normaliseTranscript,
	parseDetectedLanguage,
	parseDetectedLanguageProbability,
	parseInferenceMs,
	parseTranscriptStdout,
} from "../whisperArgs"

/**
 * The argv contract is not cosmetic. On the pinned `b5454` build:
 *  - `-otxt -of -`  → exit 0, EMPTY transcript (the `-of` value is eaten)
 *  - `-of - -otxt`  → transcript on stdout (what Bytos uses)
 *  - `-f -`         → input read, but the transcript never reaches the caller
 * These tests exist so that a "tidy-up" of the argument order cannot silently
 * reintroduce the empty-transcript bug.
 */
describe("buildWhisperArgs", () => {
	const base = {
		modelPath: "C:\\models\\ggml-base.bin",
		language: "tr" as const,
		outputBase: "C:\\Temp\\bytos-whisper-abc",
	}

	it("uses a real output base path, never '-'", () => {
		const args = buildWhisperArgs(base)
		const ofIndex = args.indexOf("-of")
		expect(ofIndex).toBeGreaterThan(-1)
		// "-" here would route the transcript to the console device, which a pipe
		// cannot capture — measured as exit 0 with empty stdout.
		expect(args[ofIndex + 1]).not.toBe("-")
		expect(path.isAbsolute(args[ofIndex + 1])).toBe(true)
		expect(args[ofIndex + 1]).toBe(path.resolve(base.outputBase))
	})

	it("requests exactly one output format: txt", () => {
		const args = buildWhisperArgs(base)
		expect(args).toContain("-otxt")
		for (const flag of ["-oj", "-ojf", "-osrt", "-ovtt", "-ocsv", "-olrc", "-owts"]) {
			expect(args).not.toContain(flag)
		}
	})

	it("puts the stdin input last and uses it exactly once", () => {
		const args = buildWhisperArgs(base)
		expect(args[args.length - 1]).toBe("-")
		expect(args.filter((arg) => arg === "-")).toHaveLength(1)
	})

	it("never uses -f: the input is a bare positional", () => {
		const args = buildWhisperArgs(base)
		expect(args).not.toContain("-f")
		expect(args).not.toContain("--file")
	})

	it("passes the model as an absolute path", () => {
		const args = buildWhisperArgs(base)
		const modelIndex = args.indexOf("-m")
		expect(args[modelIndex + 1]).toBe(path.resolve(base.modelPath))
	})

	it.each(["tr", "en", "de", "auto"] as const)("forwards the %s language code", (language) => {
		const args = buildWhisperArgs({ ...base, language })
		expect(args[args.indexOf("-l") + 1]).toBe(language)
	})

	it("disables timestamps and sizes threads for the host", () => {
		const args = buildWhisperArgs(base)
		expect(args).toContain("-nt")
		// F4: the count follows the machine (measured 18 % faster than the old
		// fixed 4), so the assertion is about the policy, not a magic number.
		expect(args[args.indexOf("-t") + 1]).toBe(String(defaultWhisperThreads()))
	})

	describe("defaultWhisperThreads", () => {
		it("uses cores - 1, capped at 6", () => {
			expect(defaultWhisperThreads(2)).toBe(1)
			expect(defaultWhisperThreads(4)).toBe(3)
			expect(defaultWhisperThreads(7)).toBe(6)
			expect(defaultWhisperThreads(16)).toBe(6)
			// The cap is the point: past it, parallel transcriptions (this repo's own
			// test suite runs many) oversubscribe the CPU and every run gets slower.
			expect(defaultWhisperThreads(64)).toBe(6)
		})

		it("never returns less than one thread", () => {
			expect(defaultWhisperThreads(1)).toBe(1)
			expect(defaultWhisperThreads(0)).toBe(1)
			expect(defaultWhisperThreads(Number.NaN)).toBe(1)
		})

		it("beats the legacy fixed value without saturating the machine", () => {
			// The regression this guards: the engine used 4 threads on a 16-thread
			// machine and gave away ~18 % of wall time.
			expect(defaultWhisperThreads(16)).toBeGreaterThan(DEFAULT_WHISPER_THREADS)
			// ...but must leave cores free for the editor and other processes.
			expect(defaultWhisperThreads(16)).toBeLessThan(16)
		})
	})

	it("does not pass -np, which would silence the language report", () => {
		// Measured: -np disables whisper's log callback, which is where the
		// `auto-detected language: …` line comes from.
		expect(buildWhisperArgs(base)).not.toContain("-np")
	})

	it("rejects a language Bytos does not support", () => {
		expect(() => buildWhisperArgs({ ...base, language: "xx" as never })).toThrow(VoiceError)
	})

	it("rejects an empty model path or output base", () => {
		expect(() => buildWhisperArgs({ ...base, modelPath: "" })).toThrow(VoiceError)
		expect(() => buildWhisperArgs({ ...base, outputBase: "" })).toThrow(VoiceError)
	})

	it("rejects an invalid thread count", () => {
		expect(() => buildWhisperArgs({ ...base, threads: 0 })).toThrow(VoiceError)
		expect(() => buildWhisperArgs({ ...base, threads: 1000 })).toThrow(VoiceError)
	})

	it.each([
		"-f",
		"--file",
		"-of",
		"--output-file",
		"-otxt",
		"-osrt",
		"-oj",
		"-t",
		"-l",
		"-m",
		"-tr",
		"-",
		"@args.txt",
	])("refuses the caller-supplied flag %s", (flag) => {
		expect(() => buildWhisperArgs({ ...base, extraArgs: [flag] })).toThrow(VoiceError)
	})
})

describe("parseTranscriptStdout", () => {
	it("strips whisper's leading newline and indentation", () => {
		expect(parseTranscriptStdout("\r\n The quick brown fox.\r\n")).toBe("The quick brown fox.")
	})

	it("joins multiple segments into one line", () => {
		expect(parseTranscriptStdout("\n Hello there.\n General Kenobi.\n")).toBe("Hello there. General Kenobi.")
	})

	it("collapses interior whitespace runs", () => {
		expect(parseTranscriptStdout("a    b\n\tc")).toBe("a b c")
	})

	it("preserves non-ASCII graphemes exactly", () => {
		const turkish = "Merhaba, bu bir ses tanıma testidir. İğüşçö."
		expect(parseTranscriptStdout(`\n ${turkish}`)).toBe(turkish)
	})

	it("returns an empty string for empty output", () => {
		expect(parseTranscriptStdout("")).toBe("")
		expect(parseTranscriptStdout("\r\n\r\n")).toBe("")
	})

	it("does not invent punctuation or change case", () => {
		expect(normaliseTranscript("  hello WORLD  ")).toBe("hello WORLD")
	})
})

describe("parseInferenceMs", () => {
	it("reads whisper's total time", () => {
		expect(parseInferenceMs("whisper_print_timings:    total time =   557.09 ms\r\n")).toBe(557.09)
	})

	it("returns undefined when the line is absent", () => {
		expect(parseInferenceMs("nothing here")).toBeUndefined()
	})
})

describe("parseDetectedLanguage", () => {
	it("reads the auto-detected language, not the requested one", () => {
		const stderr = [
			"main: processing '-' (106368 samples, 6.6 sec), 4 threads, lang = auto, task = transcribe ...",
			"whisper_full_with_state: auto-detected language: tr (p = 0.989703)",
		].join("\r\n")
		// "lang = auto" is the request; the detection line is the answer.
		expect(parseDetectedLanguage(stderr)).toBe("tr")
		expect(parseDetectedLanguageProbability(stderr)).toBeCloseTo(0.989703, 5)
	})

	it("returns undefined when no detection happened", () => {
		expect(parseDetectedLanguage("lang = de")).toBeUndefined()
	})
})
