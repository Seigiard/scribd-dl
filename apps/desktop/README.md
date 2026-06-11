# @scribd-dl/desktop

Tauri 2.x desktop wrapper for scribd-dl. Bundles the [`apps/web`](../web) SPA
inside a native window and spawns [`packages/engine`](../../packages/engine)
as a self-contained Bun sidecar.

The native shell adds two affordances over the browser experience:

- a native folder picker (Browse… button in the folder modal);
- a quit guard that refuses to close the window while there are still
  `Queued` or `Downloading` jobs, after asking the user.

(System notifications were removed — they require a signed `.app` bundle to
deliver reliably on macOS, and we'd rather show "downloaded" / "failed"
inside the SPA itself. Tracked as follow-up.)

Engine persistence is unchanged — `~/.config/scribd-dl/{settings.json,jobs.jsonl}`
are still authoritative for the folder selection and queue state. Nothing
desktop-specific is persisted in the Tauri layer.

## Prerequisites

- macOS 13+ on Apple Silicon (`aarch64-apple-darwin`). Intel Macs and other
  platforms are deliberately not built yet — the binary is single-arch.
- Bun 1.3.x (pinned at the repo root).
- Rust ≥ 1.77.2 (install via `rustup`); first `cargo check` downloads
  ~400 crates.
- Tauri CLI is pulled in as a dev dependency (`@tauri-apps/cli`); no global
  install needed.

## Develop

```bash
# from the repo root
bun install
bun --filter @scribd-dl/desktop tauri dev
```

`tauri dev` runs the Vite dev server for `apps/web` (`beforeDevCommand`),
opens a window pointed at `http://localhost:5173`, and spawns the engine
sidecar with `--port 0`. The Rust shim parses the engine's `READY port=NNNN`
line and exposes the resolved URL through the `get_backend_url` Tauri
command; `apps/web` reads it from `lib/backendUrl.ts` and falls back to
`http://127.0.0.1:4747` only when there is no Tauri runtime.

Engine logs after the READY handshake land in
`~/Library/Logs/scribd-dl/engine.log` (truncated on every launch).

## Build a DMG

```bash
bun --filter @scribd-dl/desktop tauri build
```

`beforeBuildCommand` runs the web build and the engine binary build first,
then Tauri assembles a `.app` and a `.dmg` under
`src-tauri/target/release/bundle/`. Outputs:

- `src-tauri/target/release/bundle/macos/scribd-dl.app`
- `src-tauri/target/release/bundle/dmg/scribd-dl_0.0.0_aarch64.dmg`

Measured sizes on `aarch64-apple-darwin` (Tauri 2.11.2, Bun 1.3.14):

- DMG: **~27 MB**
- Installed `.app`: **~70 MB** (most of it is the Bun-compiled engine)

Chromium is downloaded on first launch by Puppeteer (engine side), not
bundled in the DMG. Bundling it would push the DMG well past 200 MB and
the call to make that trade-off is deferred.

The artifacts are unsigned — Gatekeeper will warn on first launch. To
override on a clean machine after dragging the app to `/Applications/`:

```bash
xattr -d com.apple.quarantine /Applications/scribd-dl.app
```

Code signing, notarization, auto-update, and cross-arch builds are
intentionally out of scope for this iteration.

## How the pieces fit together

```
.app
├── Contents/MacOS/scribd-dl           # the Tauri Rust binary
├── Contents/Resources/binaries/
│   └── scribd-dl-engine-aarch64-apple-darwin
└── Contents/Resources/_up_/dist/      # apps/web bundle (uhtml SPA)
```

On launch the Rust shim:

1. spawns the engine binary with `--port 0`,
2. reads stdout until `READY port=NNNN`,
3. caches `http://127.0.0.1:NNNN` in app state,
4. answers `get_backend_url` from the webview.

On window close it asks the engine for a `/snapshot`, surfaces the quit
dialog if any job is `Queued`/`Downloading`, then sends SIGTERM (with a
3-second SIGKILL fallback) so Puppeteer's `Layer.scoped` cleanup runs and
no Chromium processes leak.

## Known limitations

- Single architecture (`aarch64-apple-darwin`) — Intel/x86_64 Macs need
  `bun build --compile --target=bun-darwin-x64` plus a second DMG; deferred.
- Unsigned binary — Gatekeeper override required on first run.
- No auto-update; users redownload to get a new version.
- No automatic restart of a crashed engine — the disconnect banner from
  `apps/web` will surface and the user can relaunch the app.
- No per-job progress bar; engine-side `JobProgress` events are streamed
  but the SPA currently shows status only.

See the plan at
[`docs/plans/2026-06-11-004-feat-tauri-desktop-app-plan.md`](../../docs/plans/2026-06-11-004-feat-tauri-desktop-app-plan.md)
for the full scope and follow-up work.
