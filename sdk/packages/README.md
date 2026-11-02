# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@bytos/shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@bytos/agents`, `@bytos/core`, apps | None |
| `@bytos/llms` | Model catalog + provider settings schema + handler creation SDK | `@bytos/agents`, `@bytos/core`, apps | None |
| `@bytos/agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@bytos/core`, apps | `@bytos/llms`, `@bytos/shared` |
| `@bytos/core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, local and hub runtime services, hub discovery and client helpers) | CLI/Desktop apps | `@bytos/agents`, `@bytos/llms`, `@bytos/shared` |
| `@bytos/ui` | Internal framework-neutral web theme, Tailwind adapter, and optional base styles | Bytos web apps | None |

## How Packages Work Together

1. `@bytos/llms` defines model/provider capabilities and builds concrete handlers.
2. `@bytos/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@bytos/core` composes runtime behavior with persistent sessions/storage and local or hub-backed runtime services.
4. `@bytos/core` hub services orchestrate scheduled runtime execution, execution history, and schedule command handling.
5. `@bytos/core/hub` exposes discovery, the detached hub daemon, and session-oriented client APIs (`HubSessionClient`, `HubUIClient`) when hosts need a shared daemon.
6. `@bytos/shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@bytos/llms`.
- Put loop/tool/hook/team execution behavior in `@bytos/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@bytos/core`.
- Put scheduled execution and schedule persistence in `@bytos/core` hub services.
- Put hub discovery, attach flows, and session-oriented client adapters in `@bytos/core/hub`.
- Put cross-package utility types and path/session constants in `@bytos/shared`.
- Put remote-config schemas, materialization, telemetry normalization, and blob upload primitives in `@bytos/shared/remote-config`.
- Put shared web tokens and visual foundations in `@bytos/ui`; keep fonts,
  shell layout, and product-specific animation with each consuming app.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@bytos/core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@bytos/core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
