---
title: "feat: dedup, displayTitle propagation, JobProgress, runtime folder change"
status: completed
date: 2026-06-09
type: feat
depth: standard
origin: docs/plans/2026-06-09-004-feat-ink-tui-client-plan.md (Deferred section)
---

# feat: dedup, displayTitle propagation, JobProgress, runtime folder change

## Summary

Four follow-ups carried over from the Ink TUI plan's `Deferred to Follow-Up Work`. All touch the `DownloadEngine` contract (or its `ScribdDownloader` executor) and propagate into both clients (`run.ts` CLI and Ink TUI).

- **U1: URL deduplication** in `engine.enqueue` (ignore if URL already Queued/Downloading/Downloaded; allow re-add for Failed/Removed).
- **U2: displayTitle update from real document metadata** — propagate the title `ScribdDownloader` already extracts back into the Job.
- **U3: JobProgress events + downloader stdout silence** — page/group-level progress in the engine event stream, rendered as a progress bar in the TUI. Side-effect: removes the `cli-progress`/`console.log` writes that would corrupt Ink's alternate screen.
- **U4: Runtime folder change** in the TUI — `[Change]` button in the header opens a popup with text input; new folder applies to subsequent jobs.

---

## Problem Frame

After v1 TUI ships, four UX gaps remain:

1. **Duplicate paste creates duplicate jobs.** `engine.enqueue` is identity-blind: pasting a job list twice processes every URL twice. Downloads are file-system-idempotent (same filename overwrites), but the list is visually noisy.
2. **Job labels stay generic.** `displayTitle` is `Scribd document 490210158` derived from the URL; the real title (e.g. `Into the Odd — Additional Materials`) is extracted by the downloader and used only for the output filename — never surfaced to the UI.
3. **No progress signal.** `Downloading` is binary; the TUI sits with that status for minutes on long documents. The downloader already has internal `cli-progress` bars, but they write to stdout, which corrupts Ink's alt-screen render. **This is a latent bug today** — manifests as redraw flicker — and U3 fixes it as a side-effect.
4. **Output folder is launch-fixed.** Changing it requires restart with `--output`. Brainstorm spec calls for inline change.

---

## Requirements

### Dedup (U1)
- **R1.** For each URL extracted by `enqueue`, if a Job with the same `url` exists with status `Queued`, `Downloading`, or `Downloaded`, do not create a new Job. Return the existing Job in the `created` array slot.
- **R2.** If the only existing Job for a URL is `Failed`, a new Job is created (re-paste behaves as today). Removed Jobs leave no trace; re-paste creates a new Job.
- **R3.** Dedup applies within a single `enqueue` call too — two identical URLs in one paste return the same Job twice.
- **R4.** No new event type for dedup hits; callers see `created` containing pre-existing Jobs and can detect via id reuse if they care.

### displayTitle propagation (U2)
- **R5.** Engine gains a new event: `JobTitleUpdated { id, title }`.
- **R6.** Job's `displayTitle` updates in place; snapshot reflects new title on next read. Errors before title resolution leave the placeholder.
- **R7.** Title source is the same string `ScribdDownloader` uses to compute the output filename (`meta.title` decoded from the mobile overlay, fallback to document id).

### JobProgress (U3)
- **R8.** Engine gains `JobProgress { id, done, total, stage }` where `stage ∈ {"scrape", "render"}`.
- **R9.** `Job` gains optional `progress?: { done: number; total: number; stage: string }`. Cleared when leaving `Downloading`.
- **R10.** TUI `QueueItem` renders an inline bar (`[████░░░░░░] 4/10`) on row 1 next to the status when `status === "Downloading" && progress` is set. Bar width fixed (10 cells).
- **R11.** `ScribdDownloader` stops writing to stdout (`console.log`, `cliProgress.SingleBar`). All progress signals route via the new callback. `run.ts` subscribes to engine events to print the same human-readable lines as today.

### Runtime folder change (U4)
- **R12.** TUI header gains a `[Change]` button after the folder path, sitting at position 0 in the Tab focus order.
- **R13.** Activating `[Change]` opens a popup with a text input pre-filled with current folder, plus `[Cancel]` / `[Save]`. Esc cancels; Enter on `[Save]` applies.
- **R14.** Save validates the path (non-empty after trim; `~` expanded). Directory creation stays lazy (existing `DirectoryIo.create` inside the worker).
- **R15.** New folder applies to Jobs **enqueued or started after** the change. In-flight Downloading jobs keep their original folder (closure semantics).

---

## Key Technical Decisions

### KTD1. Dedup keyed strictly by URL string, exact match

Normalization (trailing slash, query strings, scheme) is a rabbit hole the brainstorm doesn't ask for. Exact match keeps the rule simple and reversible.

### KTD2. ScribdDownloader emits intermediate events via a callback parameter, not a Stream

`execute(url, folder, onEvent: (e: DownloaderEvent) => Effect<void, never, never>)`. Worker constructs `onEvent` as a closure that wraps `setJob` + `publish`.

Alternatives rejected:
- Returning a Stream alongside void — confuses success channel with progress channel.
- Per-job Queue shared between worker and downloader — leaks engine internals into downloader signature.

### KTD3. Replace cli-progress with engine events even in CLI mode

`ScribdDownloader` becomes stdout-silent. `run.ts` subscribes to the engine event stream and prints the same per-file Downloaded line + batch summary it does today. No new path for TUI vs CLI — both consume the same surface. **This is the right fix for the existing TUI flicker bug.**

### KTD4. Folder held in `Ref<string>` inside the engine's scope

Engine reads output folder from `Ref<string>` initialized from `ConfigLoader.directory.output` at startup. New method `engine.setOutputFolder(path)` updates the Ref and publishes `OutputFolderChanged { path }`. Worker reads via `Ref.get` per take. Avoids dynamic Layer rebuild (which would interrupt the worker fiber).

### KTD5. Title and progress flow through the same callback

One tagged union: `{ TitleResolved | ScrapeProgress | RenderProgress }`. Adding new signals later is one more variant.

### KTD6. v1 folder change does not migrate existing files

Files in the old folder stay there. Migration is out of scope.

---

## High-Level Technical Design

### Engine event stream (after U2/U3)

```
JobAdded → JobStarted → JobTitleUpdated → JobProgress×N (scrape) → JobProgress×M (render) → JobCompleted | JobFailed
```

### Downloader callback contract

```ts
type DownloaderEvent =
  | { _tag: "TitleResolved"; title: string }
  | { _tag: "ScrapeProgress"; done: number; total: number }
  | { _tag: "RenderProgress"; done: number; total: number }

type OnEvent = (e: DownloaderEvent) => Effect.Effect<void, never, never>
```

### Folder change flow

```
TUI [Change] focused → Enter → ChangeFolderPopup opens
  → text input edited → Save
  → engine.setOutputFolder(path) → Ref.set + publish OutputFolderChanged
  → next worker.take(queue) reads current folder via Ref.get → passes to execute(url, folder, onEvent)
```

---

## Output Structure

```
src/
  service/
    DownloadEngine.ts       # dedup, new events, Ref<string>, setOutputFolder, OnEvent wiring
    ScribdDownloader.ts     # execute(url, folder, onEvent); no stdout writes
  tui/
    App.tsx                 # ChangeFolderPopup state, [Change] in focus order, useOutputFolder
    Header.tsx              # [Change] button with focus highlight
    QueueItem.tsx           # progress bar render for Downloading + progress
    ChangeFolderPopup.tsx   # NEW — text input + Cancel/Save
test/
  DownloadEngine.test.ts    # dedup, JobTitleUpdated, JobProgress, setOutputFolder
  ScribdDownloader.test.ts  # emits events via callback; no stdout writes
  tui/
    App.test.tsx            # folder change flow, progress smoke
    ChangeFolderPopup.test.tsx
run.ts                      # subscribes to engine events for CLI output
```

---

## Implementation Units

### U1. URL deduplication in engine.enqueue

**Goal:** When `enqueue(text)` encounters a URL already represented by a non-Failed Job, return the existing Job instead of creating a new one.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none

**Files:**
- `src/service/DownloadEngine.ts` — modify `enqueue` body
- `test/DownloadEngine.test.ts` — add dedup test cases

**Approach:**
- Inside `enqueue`, after extracting URLs, read current Map via `Ref.get(stateRef)`. Build `byUrl: Map<string, Job>` of non-Failed Jobs only.
- For each extracted URL: if `byUrl.has(url)`, push existing Job into `created`; skip publish and Queue.offer. Otherwise existing logic.
- Track `seenInThisCall: Map<string, Job>` so two identical URLs in one paste both refer to the first-created Job (R3).

**Patterns to follow:** existing `Ref.update` patterns. No new abstractions.

**Test scenarios:**
- Enqueue URL twice in one call → `created.length === 2`, both refer to same id, snapshot has 1 Job.
- Enqueue URL → wait Downloaded → enqueue same URL → same id reused, no second download triggered.
- Enqueue URL → Job becomes Failed → enqueue same URL → new Job (different id).
- Enqueue URL → Remove → enqueue same URL → new Job.

**Verification:** `bun test` green; lint clean. No TUI changes needed.

---

### U2. displayTitle propagation from ScribdDownloader

**Goal:** Replace URL-derived placeholder with real document title once resolved.

**Requirements:** R5, R6, R7. Establishes callback infra reused by U3.

**Dependencies:** none (independent of U1)

**Files:**
- `src/service/ScribdDownloader.ts` — `execute` signature gains `onEvent: OnEvent`; emits `TitleResolved` after `processPage`. (Folder param added in U4.)
- `src/service/DownloadEngine.ts` — new event `JobTitleUpdated`; worker builds per-job `onEvent` closure that calls `setJob` + `publish`.
- `run.ts` — subscribe to engine events; print existing per-file lines from `JobCompleted/JobFailed` (CLI batch summary already uses final snapshot, so no change there).
- `test/DownloadEngine.test.ts` — assert `JobTitleUpdated` published; snapshot's `displayTitle` reflects it.
- `test/ScribdDownloader.test.ts` — assert `onEvent({_tag: "TitleResolved"})` called after successful scrape.

**Approach:**
- Define and export `DownloaderEvent`, `OnEvent` types in `ScribdDownloader.ts`.
- Change `ScribdDownloaderService.execute` to `(url, onEvent) => Effect<void, ScribdError, never>`. After `processPage`, `yield* onEvent({ _tag: "TitleResolved", title: meta.title ?? id })`.
- Engine worker per-job: `const onEvent = (e) => match (e) { TitleResolved → setJob({...j, displayTitle: e.title}); publish({_tag: "JobTitleUpdated", id, title: e.title}) }`. Other variants handled in U3.

**Patterns to follow:** existing tagged-union events in `DownloadEngine.ts`; existing `Effect.gen + yield*` in `ScribdDownloader.ts`.

**Test scenarios:**
- Mock downloader emits `TitleResolved("Into the Odd")` → snapshot's `displayTitle` = "Into the Odd"; stream contains `JobTitleUpdated`.
- Job fails before title resolution → placeholder kept; no `JobTitleUpdated`.
- `run.ts` test: identical CLI output to today (per-file + batch).

**Verification:** `bun test` green. `bun start <url>` produces identical CLI output.

---

### U3. JobProgress events + TUI progress bar + downloader stdout silence

**Goal:** Surface scrape/render progress as engine events. Render a bar in the TUI. Stop `ScribdDownloader` from writing to stdout (fixes Ink corruption).

**Requirements:** R8, R9, R10, R11

**Dependencies:** U2 (callback infra)

**Files:**
- `src/service/ScribdDownloader.ts` — remove `cliProgress` imports/usage; remove direct `console.log`. Emit `ScrapeProgress` after `processPage` resolves (single-shot with discovered page count) and `RenderProgress` after each PDF group renders.
- `src/service/DownloadEngine.ts` — add `JobProgress` event variant; extend `Job` with optional `progress`; extend worker `onEvent` for both new variants; clear `progress` on `JobCompleted/JobFailed`.
- `src/tui/QueueItem.tsx` — when `status === "Downloading" && progress`, render bar before the status text on row 1.
- `test/DownloadEngine.test.ts` — assert progress events published; snapshot progress updates.
- `test/tui/QueueItem.test.tsx` — render Downloading job with progress; assert bar text appears.

**Approach:**
- In `ScribdDownloader.processPage`, after `evaluate` returns, emit one `ScrapeProgress { done: pages.length, total: pages.length }`. Note: intra-`evaluate` per-page progress would need a refactor of the in-browser code — out of scope.
- In `generatePDFs`, replace `cliProgress.SingleBar` with `yield* onEvent({ _tag: "RenderProgress", done: i + 1, total: groups.length })` after each group.
- Engine worker maps both to `JobProgress { id, done, total, stage }` + `setJob` update.
- QueueItem helper:
  ```ts
  const renderBar = (done: number, total: number, width = 10) => {
    const filled = Math.round((done / total) * width);
    return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "] " + done + "/" + total;
  };
  ```

**Patterns to follow:** progress-bar text is plain string math; no external dep.

**Test scenarios:**
- ScribdDownloader test with mocked Puppeteer: `onEvent` called once with `ScrapeProgress` and N times with `RenderProgress` for N groups.
- Engine: receives both event types, publishes `JobProgress`, snapshot progress updates with correct stage.
- QueueItem renders `Downloading` job with `progress: {done:4, total:10, stage:"render"}` → frame contains `4/10` and bar chars.
- Job → Downloaded → progress cleared.
- No stdout writes from `ScribdDownloader` during execute (assert by capturing process.stdout.write in test).

**Verification:** `bun test` green. Manual: `bun run tui` with a real Scribd URL — progress bar updates, no screen corruption.

---

### U4. Runtime folder change in TUI

**Goal:** TUI `[Change]` button opens a popup; user edits the folder; engine applies it to subsequent jobs.

**Requirements:** R12, R13, R14, R15

**Dependencies:** none for engine plumbing; visually fits best after U3 (single round of TUI churn).

**Files:**
- `src/service/DownloadEngine.ts` — `Ref<string>` for output folder initialized from `ConfigLoader.directory.output`. New `setOutputFolder(path)` method. Worker reads via `Ref.get` per take, passes to `execute(url, folder, onEvent)`. Add `OutputFolderChanged { path }` event.
- `src/service/ScribdDownloader.ts` — `execute` signature gains `folder: string`; uses it instead of `config.directory.output`. `ConfigLoader` is still used for `filename` and `rendertime`.
- `src/tui/Header.tsx` — adds `[Change]` button text after folder; accepts `focused?: boolean`.
- `src/tui/ChangeFolderPopup.tsx` (new) — text input pre-filled with current folder + Cancel/Save buttons.
- `src/tui/App.tsx` — `changeFolderOpen` state; `[Change]` at focus position 0; on Save → `engine.setOutputFolder`; folder display reads from a `useOutputFolder` hook (subscribes to `OutputFolderChanged`).
- `src/tui/useEngineState.ts` — either extended to return folder too, or split into a second hook `useOutputFolder`.
- `test/DownloadEngine.test.ts` — `setOutputFolder` mutates Ref; subsequent `execute` receives new folder; in-flight job keeps original.
- `test/tui/ChangeFolderPopup.test.tsx` — text input editing, Cancel/Save.
- `test/tui/App.test.tsx` — `[Change]` opens popup; Save calls `setOutputFolder`; Header re-renders.

**Approach:**
- Decide text input: try `ink-text-input` first (small, well-tested); if peer-dep issues, roll our own via `useInput` accumulating chars + cursor state. Folder paths don't need rich editing.
- `setOutputFolder` validates non-empty post-trim, expands leading `~` via `os.homedir()`, then `Ref.set` + publish event.
- Worker reads folder per take, so closure of in-flight downloads keeps their captured value (R15 verified).
- `computeActionable` in `App.tsx` prepends `{ type: "change-folder" }` at index 0.

**Patterns to follow:** `ExitConfirm` popup shape — border + focus model.

**Test scenarios:**
- `engine.setOutputFolder("/tmp/x")` → snapshot reads new folder via `OutputFolderChanged` event.
- Enqueue scribd URL with mock that records `folder` arg → matches current Ref value.
- Mid-flight job: enqueue → Downloading → call `setOutputFolder("/tmp/y")` → assert in-flight scribd.execute was called with the original folder, not "/tmp/y".
- Popup: pre-fill matches current folder; type chars; backspace works; Esc closes without saving; Save submits.
- App: Tab to `[Change]` (idx 0) → Enter opens popup → Tab to Save → Enter applies → popup closes → Header shows new folder.

**Verification:** `bun test` green. Manual: launch TUI, change folder, paste URL, file appears in new folder.

---

## Scope Boundaries

### In scope
- All 4 deferred items above.
- `ScribdDownloader` becomes stdout-silent during execute.
- CLI mode rewires output via engine event subscription; preserves existing UX.

### Deferred
- URL normalization in dedup (trailing slash, query strings, scheme).
- Intra-scrape per-page progress (would need refactor of in-browser `evaluate`).
- Folder migration on change (moving existing files).
- Manual title editing in TUI.

### Outside this work's identity
- HTTP/WS adapter — separate track when first out-of-process UI lands.
- Slideshare/Everand support — scribd-only by project intent.
- Chromium installer / Bun executable — independent track.

---

## Risks & Mitigations

- **Removing `cli-progress` regresses CLI batch UX.** The per-file Downloaded line and batch summary must keep working after U3. Mitigation: `run.ts` subscription in U2 covers it; `test/runCli.test.ts` should snapshot-match the expected stdout.
- **Worker race during folder change.** `setOutputFolder` and `Queue.take` happen on different fibers. Per R15, semantics are "applies at take-time", which matches `Ref.get` inside the worker. Document explicitly in tests.
- **`ink-text-input` peer-dep mismatch with React 19 / Ink 7.** Verify during U4. Fallback: roll our own input.
- **Title race vs JobCompleted ordering.** Guaranteed by worker's sequential code (`yield*` linearizes). Test asserts ordering.
- **Bar width on narrow terminals.** Fixed 10-char bar + title `truncate-end` already handles overflow; bar always rendered as-is.

---

## Open Questions

- Should `JobProgress` clear on `JobFailed`? Default yes (R9 — leaves Downloading clears it).
- Should `OutputFolderChanged` be a Job event or engine event? Default: separate engine event; Job events stay job-scoped.
- `ink-text-input` vs hand-rolled? Try lib first.
- Should `setOutputFolder` create the directory eagerly or stay lazy? Default lazy (existing `DirectoryIo.create` in worker handles it).

---

## Sources & Research

- **Prior plan:** `docs/plans/2026-06-09-004-feat-ink-tui-client-plan.md` — Deferred section enumerates these four items; KTD3/KTD6/KTD7 inform the decisions here.
- **Brainstorm:** `docs/brainstorms/tui-explanation.md` — original dedup rules and folder-change UX.
- **Engine surface:** `src/service/DownloadEngine.ts` — event types and worker shape.
- **Downloader surface:** `src/service/ScribdDownloader.ts` — current stdout writes U3 removes.
- **External:** `ink-text-input` — verify React 19 / Ink 7 compatibility at U4 implementation time.
