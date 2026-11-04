import { describe, expect, it } from "vitest";
import { buildInitialUserContent } from "./user-input-builder";

describe("buildInitialUserContent", () => {
	it("keeps text file attachments as file_content blocks", async () => {
		const content = await buildInitialUserContent(
			"hello",
			[],
			["/tmp/notes.md"],
			async () => "file text",
		);

		expect(content).toEqual([
			{ type: "text", text: "hello" },
			{ type: "file", path: "/tmp/notes.md", content: "file text" },
		]);
	});

	it("forwards native media returned by the host loader", async () => {
		const media = {
			id: "pdf-1",
			modality: "file" as const,
			mediaType: "application/pdf",
			source: { type: "base64" as const, data: "AAAA" },
			name: "report.pdf",
			sizeBytes: 4,
		};

		const content = await buildInitialUserContent(
			"read this",
			[],
			["/tmp/report.pdf"],
			async () => ({
				type: "media",
				media,
			}),
		);

		expect(content).toEqual([
			{ type: "text", text: "read this" },
			{ type: "media", media },
		]);
	});

	it("turns loader failures into a visible file error block", async () => {
		const content = await buildInitialUserContent(
			"hello",
			[],
			["/tmp/broken.pdf"],
			async () => {
				throw new Error("broken");
			},
		);

		expect(content).toEqual([
			{ type: "text", text: "hello" },
			{
				type: "file",
				path: "/tmp/broken.pdf",
				content: "Error fetching content: broken",
			},
		]);
	});
});
