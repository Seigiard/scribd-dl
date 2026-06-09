# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime and commands

Runtime is **Bun 1.3.14** (ESM-only, `"type": "module"`). Source is TypeScript; Bun runs `.ts` natively — no separate build step. Do not introduce Node-specific build steps or a different package manager.

```bash
bun install               # install deps (uses bun.lock)
bun start <url-or-file>   # run CLI: single URL, or path to a file with URLs
bun test                  # run all tests (bun:test)
bun test path/to.test.ts  # run a single test file
bun test --watch          # watch mode
bun test --coverage       # coverage
bun run lint              # oxlint
bun run lint:fix          # oxlint --fix
bun run format            # oxfmt --write
bun run format:check      # oxfmt --check (CI)
```

Docker workflow (no host Bun needed):
```bash
./docker-download.sh <url-or-file>
SCRIBD_DL_OUTPUT=/path/to/output ./docker-download.sh <url>
```
When the argument is an existing file on the host, the script mounts it read-only into the container and passes the in-container path.

## Architecture

Scribd-only product. Slideshare and Everand support was removed.

Entry point `run.ts` uses `@effect/cli` for argv parsing and `BunRuntime.runMain` (guarded by `import.meta.main` so tests can import `runCli` without bootstrapping the CLI). `runCli(arg)` branches on `existsSync(arg)`: existing file → `Bun.file(arg).text()`; otherwise → `arg` is treated as raw text. The text is handed to `DownloadEngine.enqueue`, which extracts URLs, classifies them, and drives them through the queue.

The downloader runs on [Effect.ts](https://effect.website/) with **Layer-based dependency injection** instead of singleton instances. Each component is a `Context.Tag` with a `*Live` Layer:

- `DownloadEngine` (`src/service/DownloadEngine.ts`) — event-driven job queue. `enqueue(text)` extracts URLs and classifies scribd vs unsupported, supported go to a single-fiber worker, unsupported immediately become Failed Jobs (`retryable: false`). Exposes `remove / retry / snapshot / events`. Other UIs (Ink-TUI, browser via Tauri+HTTP adapter) plug into the same `Context.Tag` without changing the engine.
- `ScribdDownloader` (`src/service/ScribdDownloader.ts`) — Effect-based scraping + PDF generation, consumed by `DownloadEngine`'s worker as the executor of one job.
- `PuppeteerSg` (`src/utils/request/PuppeteerSg.ts`) — `Layer.scoped` over `Effect.acquireRelease(puppeteer.launch, browser.close)`. **Scope guarantees browser cleanup** on success, error, and interrupt — no `process.on("exit")` best-effort logic.
- `PdfGenerator` (`src/utils/io/PdfGenerator.ts`) — Effect wrapper over `pdf-lib` (`merge` only; image-flow `generate` was removed with Slideshare).
- `ConfigLoader` (`src/utils/io/ConfigLoader.ts`) — `Context.Tag` exposing `ConfigData`. `makeConfigLoader(data)` returns a `Layer.succeed`. Defaults live in `DEFAULT_CONFIG`. `run.ts` builds the layer from CLI options (`--output`, `--filename`, `--rendertime`) — no file is read at startup; any wrapper or shell can override via flags.
- `DirectoryIo` (`src/utils/io/DirectoryIo.ts`) — `fs.promises.mkdir/rm` wrapped in tagged errors (`DirectoryIoFailed`).

Domain errors live in `src/errors/DomainErrors.ts` as `Data.TaggedError` classes. Each `*Live` Layer fails into one of them; consumers see typed error channels.

`run.ts` composes all Layers and provides them to the handler effect — `PuppeteerSgLive` is intentionally kept out of the top-level CLI layer so `@effect/cli --help` does not spawn a browser.

Configuration: passed as CLI flags. `--filename title` uses document title as the output filename; any other value falls back to the document ID. `--output <dir>` (default `output/`), sanitized via `sanitize-filename`. `--rendertime <ms>` controls Scribd lazy-load wait before page extraction. There is no config file — flags only.

## URL parsing for batch input

`DownloadEngine.enqueue(text)` is intentionally tolerant: per line, trim → skip empty and `#`-prefixed → take the first `https?://\S+` match. Markdown bullets (`- `, `* `), bare URLs, and inline text before the URL all work. This was a deliberate choice to handle the existing `links.md` (markdown list) without a full markdown parser — keep it that way unless the input format requirement actually changes.

## Conventions

- **TypeScript everywhere.** All source and tests are `.ts`. Bun runs them natively; `tsconfig.json` has `noEmit: true` and `moduleResolution: "bundler"`.
- **Extensionless ESM imports.** Relative imports omit the extension: `from "./service/ScribdDownloader"`, not `.js` and not `.ts`. Bun + `moduleResolution: "bundler"` resolves to the `.ts` file. The `.js` convention from the pre-TS era is gone.
- **No singleton pattern in new code.** Add new services as `Context.Tag` + `Layer.*` (effect/succeed/scoped). Do not reintroduce `if (!Class.instance)` / lowercase-instance exports.
- **Tests use `bun:test` + `Layer.succeed`/`Layer.test` mocks.** Mock services at the Layer boundary (`Layer.succeed(PuppeteerSg, { ... })`); do not `spyOn` singletons (there are none).
- Lint and format are oxlint + oxfmt. Run `bun run format` before committing — oxfmt has opinions about line length and will reflow array literals.
- The `output/` directory and `page_html.txt` are working artifacts, not committed source.

## Legal scope

Per `README.md`: this tool is for content the user is legally authorized to download. Do not add features whose primary purpose is bypassing paywalls, DRM, auth, or platform ToS — those are out of scope by project intent, not technical limitation.
