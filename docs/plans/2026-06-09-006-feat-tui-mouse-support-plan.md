---
title: "feat: TUI mouse click support for buttons"
status: cancelled
date: 2026-06-09
cancelled: 2026-06-12
cancelled-reason: План писался для старого TUI до выноса в apps/tui и parity-рефакторов; десктоп и SPA уже дают кликабельный UX, отдельная поддержка мыши в Ink TUI больше не нужна.
type: feat
depth: standard
---

# feat: TUI mouse click support for buttons

## Summary

Make the four button surfaces in the Ink TUI clickable with the mouse — `[Change]` in the header, `[Remove]`/`[Retry]` in queue items, `[Cancel]`/`[Close anyway]` in the exit popup, and `[Cancel]`/`[Save]` in the folder-change popup. A click activates the same effect as Enter on a focused button, with no intermediate "first focus, then activate" step. Keyboard navigation is untouched. Scope is clicks only — no scroll-wheel, no drag, no text selection.

Primary implementation: `@zenobius/ink-mouse@1.0.4` (`MouseProvider` + `useOnMouseClick(ref, cb)`). Fallback path: a small in-repo SGR hook with the same hook shape, swapped in if the library is incompatible with Ink 7 at runtime.

---

## Problem Frame

The TUI we just shipped is keyboard-only — Tab to cycle focus, Enter to activate. For a small queue with one-or-two visible buttons this is fine, but mouse-driven activation is a baseline expectation in modern terminals (iTerm2, WezTerm, Kitty, Ghostty, VS Code terminal all forward SGR mouse events). Users have already paste-driven the app via clipboard; clicking `[Remove]` or `[Change]` is a natural next gesture.

Ink does not ship mouse support. The button positions are not known to React — Ink renders via Yoga and only exposes layout coordinates through a `DOMElement` ref's `yogaNode`. Hit-testing therefore has to live either inside a library that walks the Yoga tree or inside a custom hook we own.

---

## Requirements

- **R1.** Clicking `[Change]` in the header opens the `ChangeFolderPopup`, identical to the keyboard path (Tab to index 0 → Enter).
- **R2.** Clicking `[Remove]` on a Queued job calls `engine.remove(id)`. Clicking `[Retry]` on a retryable Failed job calls `engine.retry(id)`.
- **R3.** Clicking `[Cancel]` or `[Close anyway]` in `ExitConfirm` dismisses the popup or invokes `exit()` respectively.
- **R4.** Clicking `[Cancel]` or `[Save]` in `ChangeFolderPopup` dismisses or calls `engine.setOutputFolder(trimmedValue)` respectively.
- **R5.** Keyboard navigation (Tab / Enter / Esc / paste / `q` / `й`) keeps working unchanged. Mouse and keyboard are additive, not exclusive.
- **R6.** Stray escape sequences must not bleed into the rendered frame. When the popup or app exits cleanly, mouse capture is disabled so the host shell is not left in mouse-reporting mode.
- **R7.** No regression in clipboard paste behavior — long input strings still route through the existing `useInput` paste path, not through mouse parsing.

### Non-functional

- **R8.** Bun install must succeed without `--force`. peerDependency mismatches are tolerable as warnings; install failure is not.
- **R9.** All existing tests stay green. New automated coverage targets the click-handler wiring; the SGR-stream path itself is manually verified in a real terminal.

---

## Key Technical Decisions

### KTD1. Use `@zenobius/ink-mouse@1.0.4`, accept the Ink 6 peerDep warning

The library's `1.0.4` (published 2025-10-09) declares `peerDependencies: { ink: "^6.0.1", react: "^19.0.0" }`. Our repo runs Ink 7 and React 19. The relevant Ink internals it uses (`useStdin`, `DOMElement.yogaNode.getComputedLeft/Top/Width/Height`) are stable across 6→7. Bun's installer will emit a peer-resolution warning but proceed. We accept the warning and verify runtime behavior at U1; if it fails, KTD2 kicks in.

Alternatives rejected:
- **`ink-terminal`** — full renderer replacement extracted from Claude Code's internals. Drops Ink itself. Far too heavy for adding mouse clicks to four buttons.
- **Roll our own from the start.** Doable, but the library is ~100 LoC of mature SGR parsing we'd otherwise rebuild. Worth trying first.

### KTD2. Keep a fallback hook path as a separate, deferred implementation unit

The fallback (U6) lives in the plan but ships **only if** U1's runtime check fails. The fallback uses the same hook shape (`useOnMouseClick(ref, cb)`, `<MouseProvider>`) so U2–U5 do not need to change — only the import source switches from `@zenobius/ink-mouse` to a local `src/tui/mouse/`. This decouples the library bet from the rest of the work and keeps the diff reversible.

### KTD3. Click activates immediately; does not move focus first

A button click fires its action callback directly. Focus state (`focusIndex`) is not updated by mouse — keyboard users keep their place, mouse users get one-step activation. The "first click focuses, second click activates" Windows-style pattern is rejected as friction without benefit in a keyboard-first TUI.

### KTD4. Trigger callback on press, not release

`useOnMouseClick(ref, (pressed) => ...)` fires twice per click — `pressed=true` on mousedown, `pressed=false` on mouseup. We fire the action on `pressed=true` (matching the library README example), so a press feels instant. Drag-off-to-cancel semantics are skipped — out of scope.

### KTD5. Mouse capture is enabled at app mount and disabled on unmount

`<MouseProvider>` wraps the entire `<App>`. We call `useMouse().toggle()` once on mount inside a top-level effect (so the SGR `\x1b[?1006h` escape sequence is emitted exactly once), and the existing `process.stdout.write("\x1b[?1049l")` alt-screen-off in `tui.ts` is paired with a corresponding mouse-off write to prevent the host shell being left in mouse-reporting mode after exit (R6).

### KTD6. Tests cover the wiring, not the SGR stream

`ink-testing-library` provides `stdin.write()` for keystroke simulation but does not interpret SGR mouse sequences. Two test layers:
1. **Component unit tests** verify each button renders correctly and that its `onClick` prop, when invoked directly, calls the right engine method. We extract a `<MouseButton label onClick>` wrapper to make this clean.
2. **Manual verification** in iTerm2 / Terminal.app covers the actual escape-sequence path. Documented in the plan's Verification section, not as an automated test.

Mocking `@zenobius/ink-mouse` to fake-click via Jest mocks is explicitly rejected — it would test the mock, not the integration.

---

## High-Level Technical Design

### Mouse activation flow

```
tui.ts startup → render(<App>) → <MouseProvider> writes "\x1b[?1006h"
  → user clicks (col, row) on terminal
  → MouseProvider parses SGR sequence from stdin
  → walks tree of registered refs; finds <Box ref> covering (col, row)
  → matched ref's useOnMouseClick callback fires with pressed=true
  → callback dispatches engine.remove / setChangeFolderOpen(true) / etc.
tui.ts exit → app.exit() → finalizer writes "\x1b[?1006l" then "\x1b[?1049l"
```

### Button wrapper shape

```tsx
// pseudo-shape, not implementation
<MouseButton label="[Remove]" onClick={() => remove(id)} focused={isFocused} />
// internally: <Box ref><Text inverse={focused}>{label}</Text></Box>
// + useOnMouseClick(ref, p => p && onClick())
```

Components currently rendering raw `<Text inverse={focused}>[Label]</Text>` get refactored to use `<MouseButton>`. The visual output is byte-identical; the only addition is a ref-bearing `<Box>` wrapping the Text.

---

## Output Structure

```
src/
  tui/
    MouseButton.tsx          # NEW — wrapper: Box+ref+Text, useOnMouseClick
    mouse/                   # NEW (only if U6 fallback ships)
      MouseProvider.tsx      # context + stdin SGR parser
      useOnMouseClick.ts     # ref-based hit-test hook
      useMouse.ts            # toggle() entry; emits enable/disable escape
    App.tsx                  # wraps tree in <MouseProvider>; mounts useMouse
    Header.tsx               # [Change] → <MouseButton>
    QueueItem.tsx            # [Remove] / [Retry] → <MouseButton>
    ExitConfirm.tsx          # [Cancel] / [Close anyway] → <MouseButton>
    ChangeFolderPopup.tsx    # [Cancel] / [Save] → <MouseButton>
test/
  tui/
    MouseButton.test.tsx     # NEW — render + onClick wiring
    Header.test.tsx          # NEW — clicking [Change] fires opener callback
    QueueItem.test.tsx       # add cases — onAction prop wiring
    ChangeFolderPopup.test.tsx # add cases — Save/Cancel onClick wiring
    App.test.tsx             # smoke: tree renders inside MouseProvider
tui.ts                       # disable mouse capture in alt-screen finalizer
package.json                 # +@zenobius/ink-mouse
```

---

## Implementation Units

### U1. Add dependency, wire `<MouseProvider>`, verify Ink 7 compatibility

**Goal:** Install `@zenobius/ink-mouse@1.0.4`, wrap the root tree, run the existing TUI manually to confirm the library boots under Ink 7. This is the bet-test gate — its outcome decides whether U6 fallback is needed.

**Requirements:** R5, R6, R8

**Dependencies:** none

**Files:**
- `package.json` — add `@zenobius/ink-mouse: ^1.0.4`
- `src/tui/App.tsx` — wrap return in `<MouseProvider>`; mount `useMouse().toggle()` once on init
- `tui.ts` — finalizer writes `\x1b[?1006l` before `\x1b[?1049l`

**Approach:**
- Install via `bun add @zenobius/ink-mouse@1.0.4`. Expect a peerDep warning on `ink ^6`; non-fatal.
- Inside `App`, call `useMouse().toggle()` in a `useEffect(() => { mouse.toggle(); return () => mouse.toggle(); }, [])` so capture is enabled on mount and disabled on unmount, complementing the alt-screen finalizer in `tui.ts`.
- Add explicit `\x1b[?1006l\x1b[?1000l` write in `tui.ts` finalizer in case `<MouseProvider>` does not own its own teardown (defensive — many TUI libs leak escape state on crash).
- After install, run `bun run tui <scribd-url>` manually and confirm: TUI renders, paste still works, no escape codes leak into the frame, exit returns the shell to normal mode.

**Patterns to follow:** existing `tui.ts` alt-screen acquire/release pattern.

**Execution note:** This unit is a runtime compatibility check first, implementation second. If the library fails to load, throws, or corrupts the frame, stop and switch to U6 before continuing. Do not attempt U2–U5 against a broken `MouseProvider`.

**Test scenarios:**
- Existing `App.test.tsx` smoke test still passes — tree renders inside `<MouseProvider>` without throwing.
- New: render `<App>` and assert `lastFrame()` does not contain raw `\x1b` bytes.

**Verification:** `bun test` green. Manual: launch TUI in iTerm2, observe no escape-code bleed, exit cleanly, shell prompt unaffected by mouse-reporting state.

---

### U2. Extract `<MouseButton>` wrapper

**Goal:** Create a single reusable component that renders a labelled button, accepts an `onClick` callback, and wires it through `useOnMouseClick`. Centralizes the ref + hook bookkeeping so U3–U5 are mechanical.

**Requirements:** R5, R9

**Dependencies:** U1

**Files:**
- `src/tui/MouseButton.tsx` — NEW
- `test/tui/MouseButton.test.tsx` — NEW

**Approach:**
- Props: `{ label: string; focused?: boolean; onClick: () => void }`.
- Renders `<Box ref={ref}><Text inverse={focused === true}>{label}</Text></Box>`.
- `useOnMouseClick(ref, (pressed) => { if (pressed) onClick(); })`.
- No internal state — focus is owned by the parent, mouse press fires `onClick` immediately (KTD3, KTD4).

**Patterns to follow:** the existing manual `<Text inverse={focused === true}>{label}</Text>` rendering in `QueueItem.tsx`, `ExitConfirm.tsx`, `ChangeFolderPopup.tsx`. The wrapper preserves byte-identical output.

**Test scenarios:**
- Renders the given label with no inverse styling when `focused` is undefined.
- Renders with inverse styling when `focused={true}`.
- Calling the `onClick` prop directly (not via mouse) invokes the parent callback exactly once — this proves wiring without simulating SGR events.

**Verification:** new test file passes; existing tests untouched.

---

### U3. Migrate `[Change]` in `Header.tsx`

**Goal:** Replace the raw `<Text inverse>[Change]</Text>` with `<MouseButton>`; route its click to the same code path that the keyboard Enter triggers (opens `ChangeFolderPopup`).

**Requirements:** R1, R5

**Dependencies:** U2

**Files:**
- `src/tui/Header.tsx` — add `onChangeClick?: () => void` prop, replace inline `[Change]` Text
- `src/tui/App.tsx` — pass `onChangeClick={() => setChangeFolderOpen(true)}` to `<Header>`
- `test/tui/Header.test.tsx` — NEW (no existing file)

**Approach:**
- `Header` already receives `changeFocused`. Add `onChangeClick`; when provided, swap the Text node for `<MouseButton label="[Change]" focused={changeFocused} onClick={onChangeClick} />`.
- In `App.tsx`, the same handler the keyboard path uses (`setChangeFolderOpen(true)`) is passed down. Keyboard Enter still works because `useInput` independently inspects `focusIndex === 0`.
- The `changeFolderOpen ? <ChangeFolderPopup /> : null` block is unchanged.

**Patterns to follow:** Header is a presentational component; keep state ownership in App.

**Test scenarios:**
- Header renders `[Change]` whether or not `onChangeClick` is passed.
- When `onChangeClick` is given, calling it through a directly-invoked MouseButton onClick prop fires the parent handler — same as U2's wiring test but at the Header boundary.

**Verification:** new + existing tests green; manual: click `[Change]` in real terminal opens the popup.

---

### U4. Migrate `[Remove]`/`[Retry]` in `QueueItem.tsx`

**Goal:** Each queue row's action button becomes clickable. The click dispatches the same `engine.remove(id)` / `engine.retry(id)` call the keyboard Enter path makes.

**Requirements:** R2, R5

**Dependencies:** U2

**Files:**
- `src/tui/QueueItem.tsx` — add `onAction?: () => void` prop, replace inline `[Remove]`/`[Retry]` Text
- `src/tui/Queue.tsx` — accept `onAction(id, type)` callback, wire to `QueueItem` per row
- `src/tui/App.tsx` — pass `onAction={(id, type) => type === "remove" ? engine.remove(id) : engine.retry(id)}` (using `Effect.runPromise`)
- `test/tui/QueueItem.test.tsx` — add coverage

**Approach:**
- `QueueItem`'s existing `action?: QueueItemAction` plus new `onAction?: () => void` — when `action` is set and `onAction` provided, render `<MouseButton label="[Remove]" focused={focused} onClick={onAction} />` (or `[Retry]`).
- `Queue` maps over actionable items and binds each `onAction` to the right `(id, type)` pair before passing to its row.
- App's existing keyboard Enter branch (`actionable[focusIndex - 1]` → `engine.remove`/`engine.retry`) stays as-is. Mouse and keyboard converge on the same Effect-driven calls.

**Patterns to follow:** existing `actionable` array in `App.tsx`; existing `Effect.runPromise(...).catch(() => {})` pattern for engine calls from the React side.

**Test scenarios:**
- QueueItem with `action="remove"` and `onAction` provided renders `[Remove]`; calling the onAction prop fires.
- QueueItem with `action="retry"` and no `onAction` renders `[Retry]` and does not throw.
- App-level: render `<App>` with two queued jobs, directly invoke the `onAction` for the second row's MouseButton (via test handle or by reaching into props), assert `engine.snapshot` shows one job removed. (If reaching into props proves brittle, fall back to wiring-only test at QueueItem boundary.)

**Verification:** `bun test` green. Manual: click `[Remove]` on a queued row → row disappears; click `[Retry]` on a retryable Failed row → row goes back to Queued.

---

### U5. Migrate popup buttons in `ExitConfirm.tsx` and `ChangeFolderPopup.tsx`

**Goal:** Both popups become fully clickable: `[Cancel]`/`[Close anyway]` in `ExitConfirm`, `[Cancel]`/`[Save]` in `ChangeFolderPopup`. Save validates and trims exactly as the keyboard Enter path does.

**Requirements:** R3, R4, R5

**Dependencies:** U2

**Files:**
- `src/tui/ExitConfirm.tsx` — add `onCancel?: () => void`, `onConfirm?: () => void`; swap Text nodes
- `src/tui/ChangeFolderPopup.tsx` — already has `onSave`/`onCancel` props; swap Cancel/Save Text nodes for `<MouseButton>`
- `src/tui/App.tsx` — pass `onCancel={() => setPopupOpen(false)}` and `onConfirm={() => { setPopupOpen(false); exit(); }}` to `<ExitConfirm>`
- `test/tui/ChangeFolderPopup.test.tsx` — extend existing cases
- `test/tui/App.test.tsx` — add mouse-equivalent assertions paralleling existing keyboard cases

**Approach:**
- `ExitConfirm` currently is purely presentational with a `focus: number` prop; add the two callback props and swap the Text nodes for MouseButtons when callbacks are provided. Keyboard handling stays in `App.tsx`'s `useInput`.
- `ChangeFolderPopup`'s text-input area is **not** a MouseButton — only Cancel/Save are. Clicking inside the input region does nothing (out of scope; keyboard typing remains the only way to edit the path).
- Validation logic (`value.trim() !== ""`) stays inside the popup's existing save path so mouse and keyboard share the same gate.

**Patterns to follow:** existing prop-callback shape in `ChangeFolderPopup.tsx`.

**Test scenarios:**
- ExitConfirm renders both buttons; calling `onConfirm` prop fires once.
- ChangeFolderPopup renders Cancel/Save buttons; calling Save's onClick after typing fires the onSave callback with the trimmed value.
- ChangeFolderPopup Save callback is **not** fired when the trimmed value is empty (preserves existing guard).

**Verification:** `bun test` green. Manual: open exit popup with active job → click `[Cancel]` keeps the app running; reopen → click `[Close anyway]` exits. Open folder popup → click `[Save]` after typing applies the folder.

---

### U6. Fallback: in-repo `useOnMouseClick` hook (conditional, only if U1 fails)

**Goal:** Replace `@zenobius/ink-mouse` with a small local hook that does the same job, in case Ink 7 breaks the library at runtime.

**Requirements:** R5, R6 (preserves all of R1–R4 through the unchanged component layer)

**Dependencies:** U1 (only triggered when U1's runtime check fails)

**Files:**
- `src/tui/mouse/MouseProvider.tsx` — NEW
- `src/tui/mouse/useOnMouseClick.ts` — NEW
- `src/tui/mouse/useMouse.ts` — NEW (same `toggle()` shape as the library)
- `package.json` — remove `@zenobius/ink-mouse`
- Component files U2–U5 — change import source from `@zenobius/ink-mouse` to `../tui/mouse` (one-line change per file)

**Approach:**
- `<MouseProvider>` uses `useStdin()` and writes `\x1b[?1000h\x1b[?1006h` on mount, opposite on unmount.
- Listens to stdin in raw mode; parses SGR sequences matching `^\x1b\[<(\d+);(\d+);(\d+)([Mm])$` — button, col, row, press (`M`) or release (`m`).
- Maintains a `Map<symbol, { ref, callback }>` of registered click subscribers in context. `useOnMouseClick(ref, cb)` registers itself on mount, unregisters on unmount.
- On a parsed event, walks the registry; for each entry, reads `ref.current?.yogaNode?.getComputedLeft()/Top()/Width()/Height()` and tests whether `(col, row)` lies inside. First match wins.
- Coordinates from SGR are 1-indexed; Yoga is 0-indexed — adjust by subtracting 1.

**Patterns to follow:** the SGR escape sequence reference (`CSI < button;col;row M`); existing Effect-free React idioms in `useEngineState.ts` for stdin subscriptions.

**Execution note:** Build the parser first against a fixture stream (a hand-written SGR sequence string) before integrating with stdin. Stdin in raw mode is hard to debug live; a deterministic test for the parser is worth the 20 minutes.

**Test scenarios:**
- SGR parser: given `\x1b[<0;5;10M` returns `{ button: 0, col: 5, row: 10, pressed: true }`.
- SGR parser: given `\x1b[<0;5;10m` returns `{ pressed: false }`.
- SGR parser: ignores buffered non-mouse bytes; resumes parsing on next `\x1b[<`.
- Hit-test: a registered subscriber with `getComputedLeft=10, Top=5, Width=10, Height=1` matches a click at `(col=15, row=6)` (1-indexed click → 0-indexed Yoga: `14,5`) and does not match `(col=5, row=6)`.
- Integration smoke: a `<MouseButton>` wrapped in our `<MouseProvider>` calls its onClick when the parser is fed a synthesized in-bounds event.

**Verification:** `bun test` green. Manual: same matrix as U2–U5 but with the swapped import — all four button surfaces respond to clicks identically.

---

## Scope Boundaries

### In scope
- Click activation on the seven button labels enumerated in R1–R4.
- Mouse-capture lifecycle tied to alt-screen lifecycle (enable on mount, disable on unmount and on crash via finalizer).

### Deferred to Follow-Up Work
- Mouse-driven focus update (click on a row also moves the keyboard `focusIndex`).
- Scroll-wheel navigation when the queue exceeds visible rows. Requires viewport state in `Queue.tsx`, currently absent.
- Hover state styling (subtle highlight on hover before click).
- Click-to-position-cursor inside `ChangeFolderPopup`'s text input.

### Outside this work's identity
- Drag/select for text copy — terminal text selection is the host shell's job; intercepting it would break the user's expectation of selection persistence.
- Mouse on the CLI path (`run.ts`) — CLI has no interactive surface.
- Windows / non-SGR terminal support — both the library and our fallback rely on SGR 1006; legacy terminals are out.

---

## Risks & Mitigations

- **`@zenobius/ink-mouse@1.0.4` breaks under Ink 7.** peerDep mismatch is the canonical surface; less obvious is the `yogaNode` API surface. *Mitigation:* U6 is pre-designed with identical hook shape so only the import path changes downstream.
- **Mouse-reporting state leaks on crash.** If the React tree throws before the cleanup effect runs, the shell stays in mouse-reporting mode and prints `\x1b[<...M` strings on every move. *Mitigation:* `tui.ts` finalizer explicitly writes `\x1b[?1006l\x1b[?1000l` before the alt-screen-off, irrespective of React unmount completion.
- **Paste-vs-mouse ambiguity.** A pasted URL containing the bytes `\x1b[<` could in theory be parsed as a mouse event. In practice URLs don't contain control bytes, but a paranoid user could break it. *Mitigation:* documented; not coded around.
- **Tests can't simulate SGR.** *Mitigation:* test the wiring (callbacks invoked directly), document manual verification path, accept the gap as proportional to the work.
- **`<MouseButton>` ref attached to a non-`<Box>` element.** Ink only attaches refs to `<Box>` / `<Static>`; attaching to `<Text>` is a runtime no-op. *Mitigation:* the wrapper always renders Box→Text, never Text directly.

---

## Open Questions

- Should the mouse-capture toggle be exposed as a CLI flag (`--no-mouse`) for users in non-SGR terminals? Default: not in v1. Add only if real reports of escape-code bleed surface.
- Should `[Cancel]` in popups be clickable even when not focused? Default: yes — mouse-click does not require prior focus (KTD3 applies uniformly).

---

## Sources & Research

- **`@zenobius/ink-mouse`** — [npm](https://www.npmjs.com/package/@zenobius/ink-mouse), [GitHub](https://github.com/zenobi-us/ink-mouse). Verified `1.0.4` peerDeps directly from `registry.npmjs.org/@zenobius/ink-mouse/1.0.4`.
- **SGR mouse protocol** — `CSI < button;col;row M` (press) / `m` (release). Universal across iTerm2, WezTerm, Kitty, Ghostty, modern xterm. Enable with `\x1b[?1000h\x1b[?1006h`, disable with the lowercase variants.
- **Ink internals** — `DOMElement.yogaNode.getComputedLeft()` etc. exposed since Ink 4; stable through 7.
- **Prior plan** — `docs/plans/2026-06-09-005-feat-engine-progress-and-folder-change-plan.md` — shipped `[Change]`, ChangeFolderPopup, and the focus model that this plan extends.
