# Bytos

<p align="center">
  <img src="https://raw.githubusercontent.com/bytos/bytos/main/assets/branding/logos/bytos-wordmark-dark.svg" width="60%" alt="Bytos" />
</p>
<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=bytos.bytos" target="_blank"><strong>Download on VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://github.com/bytos/bytos/discussions" target="_blank"><strong>Discussions</strong></a>
</td>
<td align="center">
<a href="https://github.com/bytos/bytos/discussions" target="_blank"><strong>Discussions</strong></a>
</td>
<td align="center">
<a href="https://github.com/bytos/bytos/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://docs.bytos.dev/getting-started/installing-bytos" target="_blank"><strong>Getting Started</strong></a>
</td>
</tbody>
</table>
</div>

Meet Bytos, an AI assistant that can use your **CLI** a**N**d **E**ditor.

Thanks to [Claude Sonnet's agentic coding capabilities](https://www.anthropic.com/claude/sonnet), Bytos can handle complex software development tasks step-by-step. With tools that let him create & edit files, explore large projects, use the browser, and execute terminal commands (after you grant permission), he can assist you in ways that go beyond code completion or tech support. Bytos can even use the Model Context Protocol (MCP) to create new tools and extend his own capabilities. While autonomous AI scripts traditionally run in sandboxed environments, this extension provides a human-in-the-loop GUI to approve every file change and terminal command, providing a safe and accessible way to explore the potential of agentic AI.

1. Enter your task and add images to convert mockups into functional apps or fix bugs with screenshots.
2. Bytos starts by analyzing your file structure & source code ASTs, running regex searches, and reading relevant files to get up to speed in existing projects. By carefully managing what information is added to context, Bytos can provide valuable assistance even for large, complex projects without overwhelming the context window.
3. Once Bytos has the information he needs, he can:
    - Create and edit files + monitor linter/compiler errors along the way, letting him proactively fix issues like missing imports and syntax errors on his own.
    - Execute commands directly in your terminal and monitor their output as he works, letting him e.g., react to dev server issues after editing a file.
    - For web development tasks, Bytos can launch the site in a headless browser, click, type, scroll, and capture screenshots + console logs, allowing him to fix runtime errors and visual bugs.
4. When a task is completed, Bytos will present the result to you with a terminal command like `open -a "Google Chrome" index.html`, which you run with a click of a button.

> [!TIP]
> Follow [this guide](https://docs.bytos.dev/usage/ide#move-bytos-to-the-right-sidebar) to open Bytos on the right side of your editor. This lets you use Bytos side-by-side with your file explorer, and see how he changes your workspace more clearly.

---



### Use any API and Model

Bytos supports API providers like OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras and Groq. You can also configure any OpenAI compatible API, or use a local model through LM Studio/Ollama. If you're using OpenRouter, the extension fetches their latest model list, allowing you to use the newest models as soon as they're available.

The extension also keeps track of total tokens and API usage cost for the entire task loop and individual requests, keeping you informed of spend every step of the way.

<!-- Transparent pixel to create line break after floating image -->

<br>



### Run Commands in Terminal

Bytos can execute commands and receive their output to install packages, run build scripts, deploy applications, manage databases, and run tests, all while adapting to your dev environment & toolchain to get the job done right.

By default, commands run in a visible VS Code terminal, using the [shell integration API introduced in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api) to stream output as commands run and let you watch or interact with them directly. You can switch to running commands in a background process instead (Settings → Terminal → Terminal Execution Mode).

<!-- Transparent pixel to create line break after floating image -->

<br>



### Create and Edit Files

Bytos can create and edit files directly in your editor, presenting you a diff view of the changes. You can edit or revert Bytos's changes directly in the diff view editor, or provide feedback in chat until you're satisfied with the result. Bytos also monitors linter/compiler errors (missing imports, syntax errors, etc.) so he can fix issues that come up along the way on his own.

All changes made by Bytos are recorded in your file's Timeline, providing an easy way to track and revert modifications if needed.

<!-- Transparent pixel to create line break after floating image -->

<br>



### Use the Browser

With Claude Sonnet's new [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) capability, Bytos can launch a browser, click elements, type text, and scroll, capturing screenshots and console logs at each step. This allows for interactive debugging, end-to-end testing, and even general web use! This gives him autonomy to fixing visual bugs and runtime issues without you needing to handhold and copy-pasting error logs yourself.

Try asking Bytos to "test the app", and watch as he runs a command like `npm run dev`, launches your locally running dev server in a browser, and performs a series of tests to confirm that everything works. [See a demo here.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<br>



### "add a tool that..."

Thanks to the [Model Context Protocol](https://github.com/modelcontextprotocol), Bytos can extend his capabilities through custom tools. While you can use [community-made servers](https://github.com/modelcontextprotocol/servers), Bytos can instead create and install tools tailored to your specific workflow. Just ask Bytos to "add a tool" and he will handle everything, from creating a new MCP server to installing it into the extension. These custom tools then become part of Bytos's toolkit, ready to use in future tasks.

-   "add a tool that fetches Jira tickets": Retrieve ticket ACs and put Bytos to work
-   "add a tool that manages AWS EC2s": Check server metrics and scale instances up or down
-   "add a tool that pulls the latest PagerDuty incidents": Fetch details and ask Bytos to fix bugs

<!-- Transparent pixel to create line break after floating image -->

<br>



### Add Context

**`@url`:** Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Bytos the latest docs

**`@problems`:** Add workspace errors and warnings ('Problems' panel) for Bytos to fix

**`@file`:** Adds a file's contents so you don't have to waste API requests approving read file (+ type to search files)

**`@folder`:** Adds folder's files all at once to speed up your workflow even more

<!-- Transparent pixel to create line break after floating image -->

<br>



### Checkpoints: Compare and Restore

As Bytos works through a task, the extension takes a snapshot of your workspace at each step. You can use the 'Compare' button to see a diff between the snapshot and your current workspace, and the 'Restore' button to roll back to that point.

For example, when working with a local web server, you can use 'Restore Workspace Only' to quickly test different versions of your app, then use 'Restore Task and Workspace' when you find the version you want to continue building from. This lets you safely explore different approaches without losing progress.

<!-- Transparent pixel to create line break after floating image -->

<br>

## Contributing

To contribute to the project, start with our [Contributing Guide](../../CONTRIBUTING.md) to learn the basics. You can also join our [Discord](https://github.com/bytos/bytos/discussions) to chat with other contributors in the `#contributors` channel. If you're looking for full-time work, check out our open positions on our [careers page](https://github.com/bytos/bytos/blob/main/CONTRIBUTING.md)!

## Enterprise

Get the same Bytos experience with enterprise-grade controls: SSO (SAML/OIDC), global policies and configuration, observability with audit trails, private networking (VPC/private link), and self-hosted or on-prem deployments, and enterprise support. Learn more at our [enterprise page](https://bytos.dev/enterprise) or [talk to us](https://bytos.dev/contact-sales).


## License

[Apache 2.0 © 2026 Bytos](./LICENSE)
