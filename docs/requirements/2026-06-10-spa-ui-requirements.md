---
title: "SPA UI Requirements — scribd-dl desktop client"
status: active
date: 2026-06-10
type: requirements
scope: ui-only
sources:
  - docs/brainstorms/tui-explanation.md
  - docs/plans/2026-06-09-004-feat-ink-tui-client-plan.md
  - docs/brainstorms/2026-06-09-desktop-app-tauri-bun-requirements.md
  - docs/plans/2026-06-09-007-feat-desktop-app-tauri-bun-plan.md
design-system: DESIGN.md (Linear)
---

# SPA UI Requirements — scribd-dl

UI-only requirements for the React SPA living in `app/`. Engine, transport (HTTP/WS), Tauri shell, packaging, persistence — out of scope here. This document is the contract the UI layer must satisfy; visual style is governed by `DESIGN.md`.

Audience: a designer or frontend implementer picking the SPA up cold without reading the engine plans.

---

## Product framing

A small desktop utility window. One job: paste Scribd links → see them download → done. No sidebar, no dashboard, no login, no settings screen, no history.

Single window, single view. Session-only state (queue clears when the window closes; only the output folder persists).

---

## Layout

Three vertical regions, full-height:

1. **Header** — top bar, fixed height. Shows current output folder + `Change folder` action.
2. **Queue** — flexible middle region. Scrolls when items overflow. Empty queue → region stays empty (no placeholder text, no illustration).
3. **Status bar** — bottom bar, fixed height. Shows the hint line, replaced by transient messages.

Optional fourth region: **Disconnect banner** between Header and Queue, appears only when the engine connection is down.

Modal dialogs (folder picker fallback, exit-confirm) overlay the whole window.

---

## Functional requirements

### F1. Header

- **F1.1.** Shows label `Download folder` (eyebrow style) and the current output path (mono).
- **F1.2.** Path is read from the engine on mount (`GET /folder` or equivalent). Updates after a successful folder change.
- **F1.3.** `Change folder` button on the right side. In Tauri build → opens native folder picker. In browser-only build → button stays present but may be disabled if no folder API is available.
- **F1.4.** Folder selection persists between app launches (Tauri concern — UI just shows whatever the engine reports).

### F2. Queue list

- **F2.1.** Renders jobs from the engine snapshot in insertion order. New paste → appended to the tail.
- **F2.2.** Each job is rendered as a card with: display title, status badge, source URL (mono), optional action, optional progress bar, optional failure reason.
- **F2.3.** Only one job runs at a time (engine enforces); UI reflects whatever the snapshot reports.
- **F2.4.** Empty queue → region is blank. No "No downloads yet" text.

### F3. Queue item — per status

| Status         | Title shown | URL shown | Action      | Progress | Reason |
| -------------- | ----------- | --------- | ----------- | -------- | ------ |
| `Queued`       | yes         | yes       | `Remove`    | no       | no     |
| `Downloading`  | yes         | yes       | none        | yes      | no     |
| `Downloaded`   | yes         | yes       | none        | no       | no     |
| `Failed` (retryable) | yes  | yes       | `Retry`     | no       | yes    |
| `Failed` (non-retryable, e.g. unsupported domain) | yes | yes | none | no | yes  |

- **F3.1.** Status badge is the primary at-a-glance indicator (color-coded per design system).
- **F3.2.** URL row is monospace and visually subordinate to the title.
- **F3.3.** Failure reason is shown on its own row when status is `Failed`.
- **F3.4.** Progress (when present) shows a horizontal bar plus `done / total (stage)` in mono — stage is `scrape` or `render`.

### F4. Paste

- **F4.1.** `Cmd+V` / `Ctrl+V` anywhere in the window triggers paste handling. Standard input fields keep native paste.
- **F4.2.** Clipboard text is sent verbatim to the engine, which extracts URLs and classifies them.
- **F4.3.** Multi-URL paste → one card per extracted URL, appended in order.
- **F4.4.** Mixed paste (URLs + arbitrary text) → only URLs are kept; text is silently dropped.
- **F4.5.** Paste with zero URLs found → no queue change; status bar shows transient `No links found in clipboard` for ~2 seconds, then reverts.
- **F4.6.** Paste containing an unsupported URL → engine immediately creates a `Failed` job with `Unsupported domain`. UI just renders it.
- **F4.7.** Do NOT show "Added N links" feedback. The queue update is the feedback.

### F5. Remove

- **F5.1.** `Remove` action visible only on `Queued` items.
- **F5.2.** Activation → call engine remove → item disappears from the list on the next snapshot.
- **F5.3.** Engine error response (job already started, etc.) is swallowed silently; the next snapshot is authoritative.

### F6. Retry

- **F6.1.** `Retry` action visible only on `Failed` items where `failure.retryable === true`.
- **F6.2.** `Failed` items with `retryable === false` (unsupported domain) show NO retry button.
- **F6.3.** Activation → call engine retry → item moves to the tail of the queue with status `Queued`.

### F7. Status bar

- **F7.1.** Default text: `Press ⌘V to add links` (single-line hint).
- **F7.2.** Transient state replaces the hint for ~2 seconds when paste finds no URLs (`No links found in clipboard`). Transient is visually distinct (warning tone).
- **F7.3.** No queue stats, no spinner. The status bar is for hints, not state.

### F8. Disconnect banner

- **F8.1.** Visible only when the engine connection (HTTP probe / WS) is down.
- **F8.2.** Shows text "Backend disconnected — engine is not reachable." and a `Reconnect` button.
- **F8.3.** Reconnect button → re-attempts the WS connection and snapshot fetch.
- **F8.4.** Banner sits between Header and Queue; pushes Queue down (does not overlay).
- **F8.5.** When connection is restored → banner disappears, snapshot reloads, queue resumes live updates.

### F9. Exit / Quit guard

- **F9.1.** (Tauri build only) Attempting to close the window with any `Queued` or `Downloading` job → native confirm dialog with `Cancel` (default) and `Close anyway`.
- **F9.2.** `Cancel` → keeps the window open. `Close anyway` → kills the engine and exits.
- **F9.3.** Browser build has no quit guard (browser owns window close).

### F10. Notifications (Tauri only)

- **F10.1.** When `document.visibilityState === 'hidden'` and a job transitions to `Downloaded` or `Failed` → emit one macOS system notification per transition.
- **F10.2.** Notification click → focuses the app window.
- **F10.3.** No in-app toast for completion events when visible (the queue row update is enough).

### F11. Live updates

- **F11.1.** UI subscribes to engine events over WebSocket on mount. Each event triggers a snapshot re-render.
- **F11.2.** No optimistic UI for remove/retry — the snapshot is the single source of truth.
- **F11.3.** Reconnect after a transport drop must not lose ordering or duplicate jobs (engine guarantees stable IDs).

### F12. Keyboard

- **F12.1.** `Cmd+V` / `Ctrl+V` — paste (F4).
- **F12.2.** `Tab` — cycles focus across visible actionable controls in DOM order: `Change folder` → `Remove` buttons (top-down) → `Retry` buttons (top-down) → `Reconnect` (if visible) → wraps.
- **F12.3.** `Enter` / `Space` — activate focused control.
- **F12.4.** `Esc` — closes any open dialog. Does not exit the app on its own.

---

## Non-functional

- **NF1.** All copy is English.
- **NF2.** Visual language follows `DESIGN.md` (Linear): dark canvas, lavender accent, single chromatic accent, hairline borders, Linear/Inter type stack.
- **NF3.** Window is sized for desktop (default ~720×540). The layout collapses gracefully on narrower widths, but mobile is out of scope.
- **NF4.** All interactive elements meet ≥40px touch height (per DESIGN.md responsive rules).
- **NF5.** Color is not the only state cue — status badge text repeats the status name; progress bar carries `done / total` text alongside the bar.
- **NF6.** No animations on status transitions other than the implicit re-render. Progress bar may use a subtle transition.

---

## Out of scope

Carried from the source documents — explicit non-features so they don't drift back in:

- Sidebar, dashboard, charts, settings screen.
- Login, accounts, persistent download history.
- "Open file" / "Show in Folder" buttons on completed jobs.
- "Added N links" toast or any paste-confirmation feedback.
- Duplicate detection at the UI layer (engine concern, not currently implemented).
- Per-job pause/cancel during download (engine doesn't support it).
- Empty-state illustration or copy.
- Light mode.
- A second chromatic accent (per DESIGN.md).

---

## Acceptance scenarios

Lift-and-shift from the original brainstorm, narrowed to UI behavior:

1. Paste one valid Scribd link → card appears as `Queued` → transitions through `Downloading` (with progress) → ends at `Downloaded` or `Failed`.
2. Paste a blob with multiple supported links → one card per link, in paste order.
3. Paste mixed text with URLs → only URL cards appear; the rest of the text is invisible.
4. Paste an unsupported URL → card appears as `Failed` with reason `Unsupported domain` and NO retry button.
5. Paste text with no URLs → no card; status bar shows `No links found in clipboard` for ~2s.
6. `Remove` action is present on a `Queued` card and absent on every other status.
7. `Retry` action is present only on a `Failed` retryable card.
8. Activating `Retry` → card moves to the queue tail and becomes `Queued`.
9. Killing the engine process → disconnect banner appears within seconds; restarting the engine + clicking `Reconnect` restores live updates.
10. (Tauri) Closing the window with an active job → native confirm dialog; `Cancel` keeps the window open.
11. (Tauri) A job finishes while the window is hidden → one macOS notification appears; clicking it focuses the window.

---

## Component inventory

For implementer reference — current SPA component shape, kept in sync with `app/src/`:

| Component         | File                                  | Responsibility                                  |
| ----------------- | ------------------------------------- | ----------------------------------------------- |
| `App`             | `app/src/App.tsx`                     | Wires hooks, owns transient-message timer       |
| `Header`          | `app/src/components/Header.tsx`       | Folder display + `Change folder` button         |
| `Queue`           | `app/src/components/Queue.tsx`        | Maps snapshot → list of `QueueItem`             |
| `QueueItem`       | `app/src/components/QueueItem.tsx`    | Single card per status; renders action + progress |
| `StatusBar`       | `app/src/components/StatusBar.tsx`    | Hint / transient message                        |
| `DisconnectBanner`| `app/src/components/DisconnectBanner.tsx` | Disconnect state + reconnect button         |
| `useEngineState`  | `app/src/hooks/useEngineState.ts`     | HTTP snapshot + WS events bridge                |
| `usePasteHandler` | `app/src/hooks/usePasteHandler.ts`    | Window-level paste capture                      |
