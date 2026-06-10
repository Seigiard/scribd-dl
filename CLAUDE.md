# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime and commands

Runtime is **Bun 1.3.14** (ESM-only, `"type": "module"`). Source is TypeScript; Bun runs `.ts` natively — no separate build step. Do not introduce Node-specific build steps or a different package manager.

Repository is a **Bun workspaces monorepo** — one root `bun.lock`, one hoisted `node_modules/`. Workspaces are wired in the root `package.json` as `["packages/*", "apps/*"]`.

```bash
bun install               # install deps for all workspaces (single root bun.lock)
bun start <url-or-file>   # run CLI: single URL, or path to a file with URLs
bun run engine            # launch HTTP/WS sidecar (default port 4747)
bun run tui               # launch Ink terminal UI client (requires engine running)
bun run app:dev           # Vite dev server for the SPA (apps/web)
bun run dev:spa           # engine + Vite together
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
  engine/         # @scribd-dl/engine — headless: CLI (run.ts) + HTTP/WS sidecar (engine.ts)
  shared/         # @scribd-dl/shared — job/HTTP/WS wire contract + thin client (client.ts)
apps/
  tui/            # @scribd-dl/tui — Ink/React TUI client (HTTP/WS via @scribd-dl/shared)
  web/            # @scribd-dl/web — Vite SPA client (HTTP/WS via @scribd-dl/shared)
  desktop/        # reserved slot for the future Tauri client
docs/             # plans, brainstorms, requirements (lives at repo root)
output/           # runtime artefact dir (lives at repo root; see Architecture note)
scripts/          # repo-root tooling (dev-spa.ts launches engine + Vite together)
```

Internal versioning between workspaces uses `"@scribd-dl/shared": "workspace:*"`.

## Architecture

Scribd-only product. Slideshare and Everand support was removed.

Entry point `packages/engine/run.ts` uses `@effect/cli` for argv parsing and `BunRuntime.runMain` (guarded by `import.meta.main` so tests can import `runCli` without bootstrapping the CLI). `runCli(arg)` branches on `existsSync(arg)`: existing file → `Bun.file(arg).text()`; otherwise → `arg` is treated as raw text. The text is handed to `DownloadEngine.enqueue`, which extracts URLs, classifies them, and drives them through the queue.

The downloader runs on [Effect.ts](https://effect.website/) with **Layer-based dependency injection** instead of singleton instances. Each component is a `Context.Tag` with a `*Live` Layer:

- `DownloadEngine` (`packages/engine/src/service/DownloadEngine.ts`) — event-driven job queue. `enqueue(text)` extracts URLs and classifies scribd vs unsupported, supported go to a single-fiber worker, unsupported immediately become Failed Jobs (`retryable: false`). Exposes `remove / retry / snapshot / events`. UI clients (Ink TUI in `apps/tui`, SPA in `apps/web`, future Tauri desktop) consume the engine over HTTP/WS via `@scribd-dl/shared`; they do not link the engine in-process.
- `ScribdDownloader` (`packages/engine/src/service/ScribdDownloader.ts`) — Effect-based scraping + PDF generation, consumed by `DownloadEngine`'s worker as the executor of one job.
- `PuppeteerSg` (`packages/engine/src/utils/request/PuppeteerSg.ts`) — `Layer.scoped` over `Effect.acquireRelease(puppeteer.launch, browser.close)`. **Scope guarantees browser cleanup** on success, error, and interrupt — no `process.on("exit")` best-effort logic.
- `PdfGenerator` (`packages/engine/src/utils/io/PdfGenerator.ts`) — Effect wrapper over `pdf-lib` (`merge` only; image-flow `generate` was removed with Slideshare).
- `ConfigLoader` (`packages/engine/src/utils/io/ConfigLoader.ts`) — `Context.Tag` exposing `ConfigData`. `makeConfigLoader(data)` returns a `Layer.succeed`. Defaults live in `DEFAULT_CONFIG`. `run.ts` builds the layer from CLI options (`--output`, `--filename`, `--rendertime`) — no file is read at startup; any wrapper or shell can override via flags.
- `DirectoryIo` (`packages/engine/src/utils/io/DirectoryIo.ts`) — `fs.promises.mkdir/rm` wrapped in tagged errors (`DirectoryIoFailed`).

Domain errors live in `packages/engine/src/errors/DomainErrors.ts` as `Data.TaggedError` classes. Each `*Live` Layer fails into one of them; consumers see typed error channels.

`run.ts` composes all Layers and provides them to the handler effect — `PuppeteerSgLive` is intentionally kept out of the top-level CLI layer so `@effect/cli --help` does not spawn a browser.

Configuration: passed as CLI flags. `--filename title` uses document title as the output filename; any other value falls back to the document ID. `--output <dir>` (default `output/`), sanitized via `sanitize-filename`. `--rendertime <ms>` controls Scribd lazy-load wait before page extraction. There is no config file — flags only.

**`output/` location:** root scripts that produce files invoke entry points by direct path (e.g. `bun packages/engine/run.ts`, `bun apps/tui/tui.ts`), never `bun --cwd <workspace> …`, so `process.cwd()` stays at repo root and `output/` lands at repo root regardless of which entry point ran. Do not switch these to `--cwd`.

## Wire contract

`packages/shared` is the **single source of truth** for the job/HTTP/WS contract — `Job`, `JobId`, `JobStatus`, `JobDomain`, `JobFailure`, `JobProgress`, `EngineSnapshot`, `JobEvent`, `ProgressStage` in `jobs.ts`; HTTP request/response body shapes in `http.ts`. It also ships a thin **plain-Promise HTTP/WS client** (`client.ts` — `fetchSnapshot`, `enqueueText`, `removeJob`, `retryJob`, `fetchFolder`, `setFolder`, `subscribeEvents`, `toWsUrl`) used by both `apps/web` and `apps/tui`. Built on global `fetch`/`WebSocket` — no `effect` runtime in shared. `packages/engine`, `apps/web`, and `apps/tui` all import from `@scribd-dl/shared`. Duplicating these types or transport functions in any consumer is forbidden — if the contract changes, edit `packages/shared/src/{jobs,http,client}.ts` and let TypeScript surface the consumer breaks.

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
