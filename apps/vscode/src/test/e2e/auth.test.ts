import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

// The BYOK build opens the chat view directly; provider credentials live in
// Settings → API Configuration. This test covers the real setup path: switch
// the provider, enter the key, return to chat, and verify the key persisted
// (the field shows its saved mask on the next visit).
e2e("Views - can configure a provider key in Settings and return to Chat", async ({ helper, page, sidebar }) => {
	// Initial state: chat is ready without an onboarding screen.
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()

	await helper.configureMockProvider(page, sidebar)

	// Re-open Settings and confirm the key was stored as a mask.
	const settings = await helper.openSettings(page)
	const keyField = settings.getByRole("textbox", { name: "OpenAI Compatible API Key" }).first()
	await expect(keyField).toHaveValue("\u2022".repeat("test-personal-token".length))

	await settings.getByRole("button", { name: "Done" }).click()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()
	await expect(sidebar.getByText(/openai-compat:test-model/)).toBeVisible()
})
