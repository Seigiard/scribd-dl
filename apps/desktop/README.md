# @scribd-dl/desktop

Reserved workspace slot for the future Tauri desktop client.

The implementation plan of record lives at
[docs/plans/2026-06-09-007-feat-desktop-app-tauri-bun-plan.md](../../docs/plans/2026-06-09-007-feat-desktop-app-tauri-bun-plan.md).

When the desktop client is built it will:

- depend on `@scribd-dl/shared` for the wire contract
- bundle `apps/web/dist/` as its frontend
- talk to the engine HTTP/WS sidecar (`packages/engine`)

Until then this directory is intentionally empty beyond this README and a
placeholder `package.json` so `bun install` recognises the workspace slot.
