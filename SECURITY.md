# Security policy

## Supported versions

We actively patch the most recent minor release of Bytos. Older versions receive
fixes at our discretion.

## Reporting a vulnerability

Please report security issues privately through GitHub:

<https://github.com/bytos/bytos/security/advisories/new>

If you cannot use GitHub, email <security@bytos.dev>.

Include:

- a short summary of the issue
- steps to reproduce or a proof of concept
- logs, stack traces, or screenshots that help us understand the problem

Keep the details private until a fix has shipped. We aim to acknowledge reports
within two business days and to publish an advisory once a patch is available.

## Scope

In scope:

- the Bytos VS Code extension, CLI, desktop app, hub, and SDK
- the agent tool runtime, approval flow, and credential storage
- MCP, hooks, and provider integrations shipped in this repository

Out of scope:

- vulnerabilities in third-party model providers or MCP servers you configure
- issues that require a compromised local machine or an already-exposed API key
- social engineering and denial-of-service against third-party services

Thank you for helping keep Bytos users safe.
