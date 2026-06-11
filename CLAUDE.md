# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime and commands

Runtime is **Bun 1.3.14** (ESM-only, `"type": "module"`). Source is TypeScript; Bun runs `.ts` natively — no separate build step. Do not introduce Node-specific build steps or a different package manager.

Repository is a **Bun workspaces monorepo** — one root `bun.lock`, one hoisted `node_modules/`. Workspaces are wired in the root `package.json` as `["packages/*", "apps/*"]`.

```bash
bun install               # install deps for all workspaces (single root bun.lock)
bun run engine            # launch HTTP/WS sidecar (default port 4747) — only entry point
bun run tui               # launch Ink terminal UI (apps/tui client of engine)
bun run dev:spa           # engine + Vite together (apps/web)
bun run dev:tui           # engine (backgrounded, logs to .dev-tui-engine.log) + TUI in foreground
bun run dev:app           # Tauri desktop dev (apps/desktop, sidecar engine bundled)
bun run build:spa         # Vite production build for the SPA
bun run build:tui         # bun build --compile → dist/scribd-dl-tui standalone binary
bun run build:app         # Tauri production build (apps/desktop)
bun run test              # all workspace tests (engine bun:test + web Vitest)
bun --filter @scribd-dl/engine test                  # one workspace's tests
bun --cwd packages/engine test path/to.test.ts       # single test file
bun run lint              # oxlint across all workspaces
bun run lint:fix          # oxlint --fix
bun run format            # oxfmt --write
bun run format:check      # oxfmt --check (CI)
```

## Repository layout

```text
packages/
  engine/         # @scribd-dl/engine — HTTP/WS sidecar (engine.ts)
  shared/         # @scribd-dl/shared — job/HTTP/WS wire contract + thin client (client.ts)
apps/
  tui/            # @scribd-dl/tui — Ink/React terminal client (HTTP/WS via @scribd-dl/shared)
  web/            # @scribd-dl/web — Vite SPA client (HTTP/WS, local api.ts shim)
  desktop/        # reserved slot for the future Tauri client
docs/             # plans, brainstorms, requirements (lives at repo root)
output/           # default download dir (lives at repo root; see Architecture note)
scripts/          # repo-root tooling (dev-spa.ts launches engine + Vite together)
```

Internal versioning between workspaces uses `"@scribd-dl/shared": "workspace:*"`.

## Architecture

Scribd-only product. Slideshare and Everand support was removed.

The single entry point is `packages/engine/engine.ts` — `@effect/cli` parses one option (`--port`) and starts the HTTP/WS sidecar via `BunRuntime.runMain`. There is no standalone CLI download mode; all clients (Ink TUI, Vite SPA, future Tauri desktop) talk to the engine over HTTP/WS.

The downloader runs on [Effect.ts](https://effect.website/) with **Layer-based dependency injection** instead of singleton instances. Each component is a `Context.Tag` with a `*Live` Layer:

- `DownloadEngine` (`packages/engine/src/service/DownloadEngine.ts`) — event-driven job queue. `enqueue(text)` extracts URLs and classifies scribd vs unsupported, supported go to a single-fiber worker, unsupported immediately become Failed Jobs (`retryable: false`). Exposes `remove / retry / snapshot / events / outputFolder / setOutputFolder`. Other UIs plug into the same `Context.Tag` without changing the engine.
- `ConfigStore` (`packages/engine/src/service/ConfigStore.ts`) — persistent `outputFolder` setting backed by `~/.config/scribd-dl/settings.json`. Atomic write via tmp+rename. Corrupt/missing files fall back to defaults with a warning.
- `JobStore` (`packages/engine/src/service/JobStore.ts`) — persistent state-snapshot of the queue backed by `~/.config/scribd-dl/jobs.jsonl` (one JSON-encoded `Job` per line). Atomic write serialized by a Semaphore. On read, `Downloading` is normalized to `Queued` (with `progress` dropped) so a kill-mid-flight engine resumes work on next start.
- `ScribdDownloader` (`packages/engine/src/service/ScribdDownloader.ts`) — Effect-based scraping + PDF generation, consumed by `DownloadEngine`'s worker as the executor of one job.
- `PuppeteerSg` (`packages/engine/src/utils/request/PuppeteerSg.ts`) — `Layer.scoped` over `Effect.acquireRelease(puppeteer.launch, browser.close)`. **Scope guarantees browser cleanup** on success, error, and interrupt — no `process.on("exit")` best-effort logic.
- `PdfGenerator` (`packages/engine/src/utils/io/PdfGenerator.ts`) — Effect wrapper over `pdf-lib` (`merge` only; image-flow `generate` was removed with Slideshare).
- `ConfigLoader` (`packages/engine/src/utils/io/ConfigLoader.ts`) — `Context.Tag` exposing the *static defaults* (`DEFAULT_CONFIG`: `rendertime`, `filename`, default `outputFolder`). `makeConfigLoader(data)` returns a `Layer.succeed`. Persistent overrides live in `ConfigStore`; `ConfigLoader` is the floor.
- `DirectoryIo` (`packages/engine/src/utils/io/DirectoryIo.ts`) — `fs.promises.mkdir/rm` wrapped in tagged errors (`DirectoryIoFailed`).

Domain errors live in `packages/engine/src/errors/DomainErrors.ts` as `Data.TaggedError` classes. Each `*Live` Layer fails into one of them; consumers see typed error channels.

**Persistence behavior.** `DownloadEngine` reads `ConfigStore` and `JobStore` once during its `Layer.scoped` acquire, seeds its `Ref<Map>` + `Ref<folder>` from them, and writes back on every status / title / folder mutation. `JobProgress` events are broadcast on WS but **never** persisted — only state that survives a restart hits disk. Persist errors are logged but never fail the operation that caused them.

Configuration: there are no CLI flags for `outputFolder` / `filename` / `rendertime`. `outputFolder` is mutated via `POST /folder` (or persisted on startup); `filename` and `rendertime` are constants in `DEFAULT_CONFIG`.

**`output/` location:** when nothing has been persisted yet, the engine uses `DEFAULT_CONFIG.directory.output` (`"output"`), resolved against `process.cwd()`. `bun run engine` runs from the repo root so `output/` lands there.

## Web SPA architecture

`apps/web` is **uhtml v4 + vanilla nanostores islands**. There are no Custom Elements, no `nanotags`, no `customElements.define` calls.

- `index.html` carries the page layout with empty `.mount-*` containers (`.mount-header`, `.mount-banner`, `.mount-queue`, `.mount-statusbar`, `.mount-modal`). Each mount is the island boundary.
- `src/views/*.ts` exports a **pure render function** per view (`statusbar`, `disconnectBanner`, `header`, `queueItem`, `queue`, `folderModal`) that returns `Hole` from `uhtml`. Views take props, never read stores directly.
- `src/main.ts` wires each mount: `store.listen(render)` + an explicit initial `render()` call. Multi-store views subscribe to every dependency they consume.
- Event handlers are inline closures inside the view template via `@event=${fn}`. They may import command functions from `engineClient` and may set stores (e.g., `$modal.set("folder")`) — that is business logic, not store wiring.
- List rendering uses uhtml's auto-keyed diff — just `list.map(item => view(item))`. Do **not** add `key=` attributes; uhtml keys on template identity.
- Per-view local state (e.g., modal error) lives in a module-level nanostore atom inside the view file, exported for `main.ts` to subscribe to alongside the other stores.
- CSS classes have no `sd-` prefix (that was only required because Custom Element names must contain a dash). Class names match the view's root (`.queue`, `.queue-item`, `.folder-modal`, `.statusbar`).

When adding a new view, follow the existing files — do not reintroduce `nanotags`, `define`, `ctx.host.innerHTML`, `ctx.getElement`, or `data-ref=` selectors.

## Wire contract

`packages/shared` is the **single source of truth** for the job/HTTP/WS contract — `Job`, `JobId`, `JobStatus`, `JobDomain`, `JobFailure`, `JobProgress`, `EngineSnapshot`, `JobEvent`, `ProgressStage` in `jobs.ts`; HTTP request/response body shapes in `http.ts`. Both `packages/engine` and `apps/web` import from `@scribd-dl/shared`. Duplicating these types in any consumer is forbidden — if the contract changes, edit `packages/shared/src/jobs.ts` or `http.ts` and let TypeScript surface the consumer breaks.

## URL parsing for batch input

`DownloadEngine.enqueue(text)` is intentionally tolerant: per line, trim → skip empty and `#`-prefixed → take the first `https?://\S+` match. Markdown bullets (`- `, `* `), bare URLs, and inline text before the URL all work. This was a deliberate choice to handle markdown-list inputs without a full markdown parser — keep it that way unless the input format requirement actually changes.

## Conventions

- **TypeScript everywhere.** All source and tests are `.ts`. Bun runs them natively; per-workspace `tsconfig.json` has `noEmit: true` and `moduleResolution: "bundler"`.
- **Extensionless ESM imports.** Relative imports omit the extension: `from "./service/ScribdDownloader"`, not `.js` and not `.ts`. Bun + `moduleResolution: "bundler"` resolves to the `.ts` file. The `.js` convention from the pre-TS era is gone.
- **Cross-package types live in `@scribd-dl/shared`.** Engine-internal types (scraping `DocumentMeta`, `PageDimensions`, Tag/Service/Layer types) stay inside `packages/engine`. Anything that crosses the wire (engine ↔ SPA ↔ desktop) goes in shared.
- **No singleton pattern in new code.** Add new services as `Context.Tag` + `Layer.*` (effect/succeed/scoped). Do not reintroduce `if (!Class.instance)` / lowercase-instance exports.
- **Tests use `bun:test` + `Layer.succeed`/`Layer.test` mocks.** Mock services at the Layer boundary (`Layer.succeed(PuppeteerSg, { ... })`); do not `spyOn` singletons (there are none).
- Lint and format are oxlint + oxfmt. Run `bun run format` before committing — oxfmt has opinions about line length and will reflow array literals.
- The `output/` directory and `page_html.txt` are working artifacts, not committed source.

## Legal scope

Per `README.md`: this tool is for content the user is legally authorized to download. Do not add features whose primary purpose is bypassing paywalls, DRM, auth, or platform ToS — those are out of scope by project intent, not technical limitation.
