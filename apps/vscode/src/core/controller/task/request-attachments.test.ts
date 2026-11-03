import { ChatAttachment } from "@shared/proto/bytos/task"
import { describe, expect, it } from "vitest"
import { resolveRequestAttachments } from "./request-attachments"

function attachment(patch: Partial<ChatAttachment>): ChatAttachment {
	return ChatAttachment.create(patch)
}

describe("resolveRequestAttachments", () => {
	it("prefers the legacy images/files arrays during the compatibility window", () => {
		const resolved = resolveRequestAttachments(
			[attachment({ kind: "image", name: "ignored.png", data: "data:image/png;base64,AAAA" })],
			["data:image/png;base64,LEGACY"],
			["/tmp/legacy.md"],
		)

		expect(resolved).toEqual({
			images: ["data:image/png;base64,LEGACY"],
			files: ["/tmp/legacy.md"],
		})
	})

	it("maps typed image and text attachments when only attachments are sent", () => {
		const resolved = resolveRequestAttachments(
			[
				attachment({ kind: "image", name: "photo.webp", data: "data:image/webp;base64,AAAA" }),
				attachment({ kind: "text", name: "notes.md", path: "/tmp/notes.md" }),
				attachment({ kind: "document", name: "report.pdf", path: "/tmp/report.pdf" }),
			],
			[],
			[],
		)

		expect(resolved.images).toEqual(["data:image/webp;base64,AAAA"])
		expect(resolved.files).toEqual(["/tmp/notes.md", "/tmp/report.pdf"])
	})

	it("ignores reserved media kinds until their transport phase lands", () => {
		const resolved = resolveRequestAttachments(
			[
				attachment({ kind: "video", name: "clip.mp4", path: "/tmp/clip.mp4" }),
				attachment({ kind: "model3d", name: "scene.glb", path: "/tmp/scene.glb" }),
				attachment({ kind: "text", name: "keep.md", path: "/tmp/keep.md" }),
			],
			[],
			[],
		)

		expect(resolved).toEqual({ images: [], files: ["/tmp/keep.md"] })
	})

	it("infers the kind from the name when the client omits it", () => {
		const resolved = resolveRequestAttachments(
			[
				attachment({ name: "photo.jpeg", data: "data:image/jpeg;base64,AAAA" }),
				attachment({ name: "notes.md", path: "/tmp/notes.md" }),
			],
			[],
			[],
		)

		expect(resolved.images).toEqual(["data:image/jpeg;base64,AAAA"])
		expect(resolved.files).toEqual(["/tmp/notes.md"])
	})

	it("returns empty arrays when there is nothing to resolve", () => {
		expect(resolveRequestAttachments(undefined, undefined, undefined)).toEqual({ images: [], files: [] })
	})
})
