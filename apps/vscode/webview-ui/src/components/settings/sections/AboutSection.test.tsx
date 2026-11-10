import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import AboutSection from "./AboutSection"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}))

/**
 * The About screen is the only place inside the product that points users at
 * the official website, repository, Marketplace listing and community chat.
 * Keep those four destinations pinned so a rebrand or repo move cannot leave a
 * dead or misspelled link in the shipped extension.
 */
describe("AboutSection official links", () => {
	it("renders the website, GitHub, VS Code Marketplace and Discord destinations", () => {
		render(<AboutSection renderSectionHeader={() => null} version="1.0.2" />)

		expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://bytos.dev/")
		expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/Balahurra/Bytos")
		expect(screen.getByRole("link", { name: "VS Code Marketplace" })).toHaveAttribute(
			"href",
			"https://marketplace.visualstudio.com/items?itemName=Bytos.bytos",
		)
		expect(screen.getByRole("link", { name: "Discord" })).toHaveAttribute("href", "https://discord.gg/2hSFZY9Bs")
	})

	it("keeps the issue tracker on the official repository", () => {
		render(<AboutSection renderSectionHeader={() => null} version="1.0.2" />)

		expect(screen.getByRole("link", { name: "Report an Issue" })).toHaveAttribute(
			"href",
			"https://github.com/Balahurra/Bytos/issues",
		)
	})
})
