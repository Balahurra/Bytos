# Security policy

## Supported versions

Security fixes are provided for the latest `1.x` release of the Bytos VS Code
extension. Older versions may receive fixes at the maintainers' discretion.

## Reporting a vulnerability

Please report security issues privately through GitHub's private vulnerability
reporting form:

<https://github.com/Balahurra/Bytos/security/advisories/new>

Do not open a public issue for a suspected vulnerability. Include:

- a short summary of the issue;
- steps to reproduce or a proof of concept;
- the Bytos version and VS Code version;
- logs, stack traces, or screenshots that help us understand the problem.

Keep the details private until a fix has shipped. We aim to acknowledge reports
within two business days and to coordinate disclosure after a patch is
available.

## Scope

In scope:

- the Bytos VS Code extension package (`apps/vscode`);
- the agent tool runtime, approval flow, and credential storage;
- MCP, hooks, skills, and provider integrations shipped in the extension;
- build and packaging scripts that affect the released VSIX.

Out of scope:

- vulnerabilities in third-party model providers or MCP servers you configure;
- issues that require a compromised local machine or an already-exposed API key;
- social engineering and denial-of-service against third-party services;
- the unpublished CLI, hub, desktop, and example workspace packages, unless the
  issue also affects the shipped extension.

## Security-relevant defaults

- Provider API keys are stored in VS Code SecretStorage, not in plaintext
  settings, and are never sent to the webview.
- Tool permissions are fail-closed: reads, edits, terminal commands, browser
  access, MCP tools, and unknown tools require approval until auto-approved.
- File tools enforce a canonical workspace boundary, including absolute paths,
  traversal, Windows drive/UNC paths, and symlinks.
- Telemetry is disabled by default and requires an explicit opt-in.

Thank you for helping keep Bytos users safe.
