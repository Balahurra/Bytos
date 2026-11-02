# [experimental] @bytos/core

`@bytos/core` is the stateful orchestration layer of the Bytos SDK. It
connects the agent runtime, provider settings, storage, default tools, and
session lifecycle into a host-ready runtime.

## What You Get

- session lifecycle and orchestration primitives
- provider settings and account services
- default runtime tools and MCP integration
- storage-backed session and team state helpers
- host-facing Node helpers through `@bytos/core`

## Installation

```bash
npm install @bytos/core
```

## Entry Points

- `@bytos/core`: core contracts, shared utilities, and Node/server helpers for building hosts and runtimes

## Typical Usage

Most host apps should start with `@bytos/core`.

```ts
import { BytosCore } from "@bytos/core";

const bytos = await BytosCore.create({});

const result = await bytos.start({
	config: {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: process.env.ANTHROPIC_API_KEY ?? "",
		cwd: process.cwd(),
		mode: "act",
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		systemPrompt: "You are a concise assistant.",
	},
	prompt: "Summarize this project.",
	interactive: false,
});

console.log(result.result?.text);
await bytos.dispose();
```

When both `cwd` and `workspaceRoot` are omitted, the execution host places
the session in the shared chat workspace at
`<bytos-data-dir>/workspaces/chat` (by default
`~/.bytos/data/workspaces/chat`), seeded with an `AGENTS.md` rules file that
tells the agent to treat the session as a chat and only create a named
project folder when the user asks for one.
Read the resolved paths from `result.manifest.cwd` and
`result.manifest.workspace_root`.

## Session Bootstrap

`BytosCore.create(...)` also accepts `prepare(input)`.

Use it when a host needs to prepare workspace-scoped runtime state before each
session starts, then apply watcher/extensions/telemetry inputs through
explicit `localRuntime` bootstrap fields without widening the shared host
contract.

Preparation runs before the execution host resolves an omitted workspace, so
pathless starts expose neither `cwd` nor `workspaceRoot` to `prepare(input)`.

## Main APIs

### Runtime and Sessions

Use `@bytos/core` for host-facing runtime assembly:

- `BytosCore.create(...)`
- `createRuntimeHost(...)`
- `LocalRuntimeHost`
- `HubRuntimeHost` and `RemoteRuntimeHost`
- `DefaultRuntimeBuilder`

`BytosCore` is the app-facing session API. The lower-level `RuntimeHost`
boundary uses runtime-primitive names such as `startSession` and `runTurn` so
transport adapters stay distinct from product methods like `start` and `send`.
Service-style operations such as pending prompt edits, accumulated usage lookup,
and active-session model switching are exposed through `BytosCore` when the
selected transport supports them rather than being part of the minimal host
primitive vocabulary.

### Default Tools

`@bytos/core` owns the built-in host tools and executors:

- `createBuiltinTools(...)`
- `createDefaultTools(...)`
- `createDefaultExecutors(...)`

### Storage and Settings

The package also exports storage and settings helpers such as:

- `ProviderSettingsManager`
- `CoreSettingsService` and `createCoreSettingsService`
- MCP settings helpers such as `setMcpServerDisabled`
- `SqliteTeamStore`
- SQLite-backed local session stores and artifacts through `@bytos/core`

## Related Packages

- `@bytos/agents`: stateless agent loop and tool primitives
- `@bytos/llms`: provider/model configuration and handlers

## More Examples

- Repo examples: [examples](https://github.com/bytos/sdk/tree/main/examples), [apps/examples](https://github.com/bytos/sdk/tree/main/apps/examples)
- Workspace overview: [README.md](https://github.com/bytos/bytos/blob/main/README.md)
- API and architecture references: [DOC.md](https://github.com/bytos/bytos/blob/main/DOC.md), [ARCHITECTURE.md](https://github.com/bytos/bytos/blob/main/ARCHITECTURE.md)
