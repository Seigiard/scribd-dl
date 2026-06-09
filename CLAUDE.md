# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime and commands

Runtime is **Bun 1.3.14** (ESM-only, `"type": "module"`). Do not introduce Node-specific build steps or a different package manager.

```bash
bun install               # install deps (uses bun.lock)
bun start <url-or-file>   # run CLI: single URL, or path to a file with URLs
bun test                  # run all tests (bun:test)
bun test path/to.test.js  # run a single test file
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

The entry point `run.js` decides single-URL vs batch by `existsSync(arg)`. Existing file → `urlListReader.read()` → `app.executeBatch()` with per-URL try/catch and an end-of-run summary (exit 1 on any failure). Non-file → `app.execute()` (legacy single-URL path, unchanged behavior).

`App.execute(url)` is a router that picks one of three service singletons by regex domain match: `scribdDownloader` (`src/service/ScribdDownloader.js`), `slideshareDownloader`, `everandDownloader`. Each one drives Puppeteer via the **single shared `puppeteerSg` instance** (`src/utils/request/PuppeteerSg.js`) — lazy browser launch on first `getPage`, and each downloader calls `puppeteerSg.close()` when done. In batch mode this means the browser is relaunched per URL via the lazy-launch path; this is intentional (no downloader changes were needed for batch support).

All `src/utils/io/*` and `src/utils/request/*` modules follow the same **singleton constructor pattern**: `if (!Class.instance) Class.instance = this; return Class.instance`, exported as a lowercase instance (`configLoader`, `directoryIo`, `puppeteerSg`, `urlListReader`, …). Match this pattern when adding new utilities.

Scribd/Slideshare downloaders render pages with Puppeteer, screenshot each page, then assemble a PDF via `pdf-lib` (`src/utils/io/PdfGenerator.js`). `cli-progress` shows a single progress bar per document. Everand handles podcast audio differently — see `EverandDownloader.js`.

Configuration lives in `config.ini` (parsed by `ini`) and is read through `configLoader.load(section, key)`. `[DIRECTORY] filename=title` selects document title as output filename; any other value falls back to the document ID. Output goes to `[DIRECTORY] output` (default `output/`), sanitized via `sanitize-filename`.

## URL parsing for batch input

`urlListReader.read(filePath)` is intentionally tolerant: per line, trim → skip empty and `#`-prefixed → take the first `https?://\S+` match. Markdown bullets (`- `, `* `), bare URLs, and inline text before the URL all work. This was a deliberate choice to handle the existing `links.md` (markdown list) without a full markdown parser — keep it that way unless the input format requirement actually changes.

## Conventions

- ESM imports must include the `.js` extension (`from "./service/ScribdDownloader.js"`) — Bun follows Node ESM resolution here.
- Tests use `bun:test` (`import { describe, expect, test } from "bun:test"`); spies use `spyOn`. See `test/App.test.js` for the singleton-mocking pattern (`spyOn(app, "execute").mockImplementation(...)`).
- Lint and format are oxlint + oxfmt. Run `bun run format` before committing — oxfmt has opinions about line length and will reflow array literals.
- The `output/` directory and `page_html.txt` are working artifacts, not committed source.

## Legal scope

Per `README.md`: this tool is for content the user is legally authorized to download. Do not add features whose primary purpose is bypassing paywalls, DRM, auth, or platform ToS — those are out of scope by project intent, not technical limitation.
