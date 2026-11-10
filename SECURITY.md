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
- the published desktop app (`apps/examples/desktop-app`);
- build and packaging scripts that affect released artifacts;
- the independently deployed documentation site and evaluation tooling.

Out of scope:

- vulnerabilities in third-party model providers or MCP servers you configure;
- issues that require a compromised local machine or an already-exposed API key;
- social engineering and denial-of-service against third-party services;
- unpublished example workspace packages unless the issue also affects a
  released artifact.

## Security-relevant defaults

- Provider API keys are stored in VS Code SecretStorage, not in plaintext
  settings, and are never sent to the webview.
- Tool permissions are fail-closed: reads, edits, terminal commands, browser
  access, MCP tools, and unknown tools require approval until auto-approved.
  The CLI, ACP host, and VS Code local host install an explicit
  `"*": { autoApprove: false }` baseline. Unattended modes (cloud sandbox,
  cron, `--yolo`) opt in explicitly.
- File tools enforce a canonical workspace boundary, including absolute paths,
  traversal, Windows drive/UNC paths, junctions, and symlinks.
- MCP stdio servers that are absolute `.exe` paths are spawned without a
  command shell; shell-launched wrappers are token-quoted on Windows.
- Telemetry is disabled by default and requires an explicit opt-in.

## Continuous security checks

The `security` GitHub Actions workflow runs on pull requests, pushes to
`main`, and weekly:

- dependency review for newly introduced runtime high/critical advisories;
- `bun audit` (high/critical) plus `npm audit` for `docs`, `evals`, and
  `evals/analysis`;
- CodeQL for JavaScript/TypeScript;
- gitleaks against the full history using `.gitleaks.toml`.

Dependabot keeps weekly checks for npm, bun, Cargo, and GitHub Actions and
groups security updates into focused PRs. Security updates are not suppressed
by routine version-update ignore rules.

Release builds run the local gate before publishing:

```bash
node scripts/security/release-gate.mjs path/to/bytos.vsix
```

It re-runs the high/critical dependency gates and inspects the actual VSIX
bytes with `scripts/security/check-vsix.mjs` (required notices, forbidden
development/test payloads, executable inventory, and credential-shape scan).

## Repository owner actions

The workflow cannot change remote repository settings. An owner must enable:

- **Settings → Code security → Secret scanning** and **Push protection** for
  the repository (the `secret-scan` job only detects committed secrets after
  the fact);
- **Settings → Code security → Dependabot alerts** and **Dependabot security
  updates** (the configuration file alone does not enable alerts);
- branch protection on `main` requiring the `security` and test workflows,
  plus a review for release tags.

## Known accepted residual risks

- `deepmerge@4.3.1` is flagged as a low-severity prototype-pollution advisory
  upstream, but Bytos applies a local patch (`patches/deepmerge@4.3.1.patch`)
  that rejects `__proto__`, `constructor`, and `prototype` keys. The advisory
  database still keys off the upstream version number.
- `@ai-sdk/provider-utils@5.0.0` is a low-severity resource-consumption
  advisory reached only through the pinned Langfuse Vercel AI SDK dependency
  graph. It is not used to validate untrusted tool input; upgrading it alone
  requires a coordinated Langfuse/AI SDK major update.
- `glib@0.18.5`, `proc-macro-error@1.0.4`, and the `zbus`/`zvariant` family
  are Linux-only transitive dependencies of the desktop app's GTK/Tauri and
  D-Bus stack. `glib` has an upstream iterator soundness advisory fixed only
  in `glib@0.20`, which requires a GTK 0.20 rebase not yet supported by
  Tauri 2; the others are unmaintained advisories with no fixed release. The
  published desktop artifacts are macOS and Windows; the Linux build is not
  distributed from this repository.
- `pin-utils@0.1.0` is an unmaintained macro utility pulled in by `hyper`. It
  has no fixed release and no known exploit path; it is not used to parse
  untrusted input.

Thank you for helping keep Bytos users safe.
