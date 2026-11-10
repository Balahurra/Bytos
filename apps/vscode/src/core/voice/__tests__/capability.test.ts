import { describeOs, detectVoiceCapability } from "@core/voice/capability"
import { describe, expect, it } from "vitest"

/**
 * T2 — platform and runtime capability detection.
 *
 * Acceptance rule from the plan: no test asserts support for a platform F1 did
 * not verify. Every unsupported environment must report `canCapture: false`
 * WITH a specific reason code.
 */

const HELPER = "C:\\ext\\assets\\voice\\bin\\win32-x64\\bv-os-audio-helper.exe"

describe("detectVoiceCapability", () => {
	it("supports local Windows x64 with a helper and a device", () => {
		const capability = detectVoiceCapability({
			platform: "win32",
			arch: "x64",
			helperPath: HELPER,
			deviceCount: 1,
			permission: "granted",
			voiceEnabled: true,
		})
		expect(capability.canCapture).toBe(true)
		expect(capability.backend).toBe("wasapi")
		expect(capability.reason).toBe("")
		expect(capability.osLabel).toContain("Windows")
	})

	it("reports REMOTE_HOST_UNSUPPORTED for SSH/WSL/container hosts", () => {
		for (const remoteName of ["ssh-remote", "wsl", "dev-container", "attached-container", "codespaces"]) {
			const capability = detectVoiceCapability({
				platform: "win32",
				arch: "x64",
				remoteName,
				helperPath: HELPER,
				deviceCount: 1,
			})
			expect(capability.canCapture).toBe(false)
			expect(capability.reason).toBe("REMOTE_HOST_UNSUPPORTED")
			expect(capability.detail).toContain(remoteName)
			expect(capability.osLabel).toContain("remote")
		}
	})

	it("reports WEB_UI_UNSUPPORTED for VS Code Web", () => {
		const capability = detectVoiceCapability({ platform: "win32", arch: "x64", isWeb: true, helperPath: HELPER })
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("WEB_UI_UNSUPPORTED")
	})

	it("makes NO support claim for macOS", () => {
		const capability = detectVoiceCapability({ platform: "darwin", arch: "arm64", helperPath: HELPER, deviceCount: 1 })
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("PLATFORM_NOT_SUPPORTED_IN_F1")
		expect(capability.backend).toBe("none")
	})

	it("makes NO support claim for Linux", () => {
		const capability = detectVoiceCapability({ platform: "linux", arch: "x64", helperPath: HELPER, deviceCount: 1 })
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("PLATFORM_NOT_SUPPORTED_IN_F1")
	})

	it("makes NO support claim for win32-arm64", () => {
		const capability = detectVoiceCapability({ platform: "win32", arch: "arm64", helperPath: HELPER, deviceCount: 1 })
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("PLATFORM_NOT_SUPPORTED_IN_F1")
	})

	it("reports CAPTURE_HELPER_MISSING when the helper is absent", () => {
		const capability = detectVoiceCapability({ platform: "win32", arch: "x64", deviceCount: 1 })
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("CAPTURE_HELPER_MISSING")
	})

	it("reports NO_CAPTURE_DEVICE when no microphone is present", () => {
		const capability = detectVoiceCapability({ platform: "win32", arch: "x64", helperPath: HELPER, deviceCount: 0 })
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("NO_CAPTURE_DEVICE")
	})

	it("reports RECORDER_ISOLATION_UNVERIFIED until the T1 gate is green", () => {
		const capability = detectVoiceCapability({
			platform: "win32",
			arch: "x64",
			helperPath: HELPER,
			deviceCount: 1,
			recorderIsolationVerified: false,
		})
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("RECORDER_ISOLATION_UNVERIFIED")
	})

	it("reports VOICE_DISABLED when the setting is off", () => {
		const capability = detectVoiceCapability({
			platform: "win32",
			arch: "x64",
			helperPath: HELPER,
			deviceCount: 1,
			voiceEnabled: false,
		})
		expect(capability.canCapture).toBe(false)
		expect(capability.reason).toBe("VOICE_DISABLED")
	})
})

describe("describeOs", () => {
	it("labels local and remote hosts", () => {
		expect(describeOs("win32", "x64")).toBe("Windows x64 (local)")
		expect(describeOs("linux", "arm64", "ssh-remote")).toBe("Linux arm64 (remote: ssh-remote)")
	})
})
