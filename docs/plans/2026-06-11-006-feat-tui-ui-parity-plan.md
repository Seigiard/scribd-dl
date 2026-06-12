---
title: "feat: TUI UI parity with SPA — status zone, clear actions, severity transients"
status: completed
created: 2026-06-11
completed: 2026-06-12
origin: docs/brainstorms/2026-06-11-queue-polish-requirements.md
related-plan: docs/plans/2026-06-11-005-feat-queue-polish-plan.md
type: feat
depth: standard
---

# feat: TUI UI parity with SPA — status zone, clear actions, severity transients

## Summary

Привести Ink TUI (`apps/tui`) к тому же UX, что и SPA после `docs/plans/2026-06-11-005-feat-queue-polish-plan.md`:

- StatusBar переезжает из нижней позиции под header'ом → становится единым каналом нотификаций (severity-typed transient + Clear Finished / Clear All controls справа).
- Transient получает форму `{ severity, message, sticky? }` с приоритетным overwrite (error > warning > info) и per-severity таймерами, как в SPA `$transient`.
- Sticky-error на WS close ("Disconnected from engine"), снимается при reconnect.
- Unsupported URL paste → warning-toast с reason, не silent.
- `Clear Finished` / `Clear All` как сфокусируемые элементы в Tab-обходе, между `[Change]` и actionable controls очереди. `Clear All` с confirm-popup (повторяет паттерн `ExitConfirm`).
- WS handler учитывает `SnapshotReplaced` (применяется inline без HTTP refresh).
- Wire-клиент в `@scribd-dl/shared` получает `clearFinished` / `clearAll`.

Engine, shared wire contract и newest-first порядок уже сделаны в queue-polish PR — TUI остаётся client-side работа.

## Problem Frame

После queue-polish PR'а SPA и TUI расходятся: SPA получил единый канал нотификаций с severity, sticky disconnect, и две Clear-операции; TUI остался с нижним `<StatusBar>` без severity, без Clear-кнопок, без warning для unsupported URL. Цель — снять расхождение, не вводя клиентскую логику mismatch с engine-контрактом.

## Requirements

Из origin (`docs/brainstorms/2026-06-11-queue-polish-requirements.md`) — TUI-проекция:

- **R1.** Очередь рендерится newest-first; источник — engine snapshot (уже работает, TUI рендерит `snapshot.jobs` как есть).
- **R2.** `StatusBar` (или его преемник) сидит **под** `<Header>`, не в футере. Layout: header / status-zone / queue (flexGrow).
- **R3.** Transient в TUI имеет форму `{ severity: 'info' | 'warning' | 'error', message, sticky? } | null` с приоритетным overwrite и per-severity таймерами. Хранится в локальном `useState` внутри `App.tsx` (без введения нового стора — TUI и так не имеет global state-management). Поведение помощника `showTransient(severity, message, opts?)` зеркалит SPA-логику.
- **R4.** Default-state (transient=null) показывает `Press Ctrl/Cmd+V to download links • q to quit • Tab to navigate` слева + `[Clear Finished] [Clear All]` справа.
- **R5.** Severity-rendering в Ink: `info` → `dimColor`; `warning` → `color="yellow"` (Ink не имеет orange); `error` → `color="red"`. Background-tint статус-зоны при активном transient — через `Text inverse` на пустой подложке или `backgroundColor` на обёртке.
- **R6.** При активном transient кнопки рендерятся как пустые placeholder'ы той же ширины (preserve height и Tab-индексацию) ИЛИ остаются видимыми и dim'нутся — см. KTD-2.
- **R7.** Clear Finished и Clear All встроены в Tab-обход. Order: `[Change]` → `[Clear Finished]` → `[Clear All]` → actionable items очереди.
- **R8.** Clear Finished disable когда нет `Downloaded`+`Failed` jobs; Clear All disable когда очередь пуста. Disabled = `dimColor`, Enter на них no-op.
- **R9.** Clear All с подтверждением: появляется `ClearAllConfirm` popup (паттерн `ExitConfirm` — focus tab между `[Cancel]` и `[Confirm]`, Enter применяет). Clear Finished — без подтверждения.
- **R10.** Wire-вызовы: `clearFinished` (последовательно `DELETE /jobs/completed` + `DELETE /jobs/failed`, суммирует `removed`) и `clearAll` (`DELETE /jobs`) добавляются в `packages/shared/src/client.ts` чтобы и SPA, и TUI шарили один клиент. В SPA `apps/web/src/lib/api.ts` `clearFinished`/`clearAll` re-export'ятся из shared — см. KTD-3.
- **R11.** WS handler в `useEngineState` обрабатывает `SnapshotReplaced` через прямое `setSnapshot(event.snapshot)` без HTTP refresh. Существующая fallback-refresh для не-`OutputFolderChanged` событий сохраняется (для fine-grained апдейтов прогресса worker'а).
- **R12.** WS close → sticky error "Disconnected from engine". Reconnect → sticky снимается. TUI не имеет явной reconnect-кнопки (как у SPA), поэтому добавление автоматического reconnect не требуется — engine sidecar обычно поднят постоянно, отдельная itarations.
- **R13.** Paste unsupported URL: после `enqueueText` если все вернувшиеся jobs Failed retryable=false → warning-toast с `failure.reason` (`Unsupported domain`). Частичное rejection → `N of M links rejected`. Пустой clipboard / нет URL → info-toast `No links found in clipboard` (текущее поведение под новой severity-формой).
- **R14.** Файлы на диске НИКОГДА не удаляются (наследуется от engine, TUI просто не имеет такого API).

## Key Technical Decisions

### KTD-1. Transient в локальном `useState`, не в external store

SPA использует nanostores для трансляции реактивности через несколько mount-точек; TUI рендерится одним React-деревом из `App.tsx`. Локальный `useState<TransientState | null>` + helper `useTransient()` (custom hook) достаточен. Перенос в shared store раздул бы пакетный граф без выгоды. Severity priority/timer-логика — чистая функция, переиспользуется тестами.

### KTD-2. При активном transient скрывать кнопки полностью, рисовать transient на всю строку

В Ink нет CSS-`visibility:hidden`. Варианты:
- (A) Не рендерить кнопки → строка короче, но Box flex stays; transient растягивается на flex:1, кнопки не нужны.
- (B) Рендерить кнопки серым `dimColor` рядом с transient → визуальный шум, Tab-обход остаётся.

Выбор: **A**. Tab-обход меняется динамически — при активном transient `focusCount` падает, `focusIndex` clamp'ается (логика уже в `App.tsx`). Это даёт «фокус не доступен на скрытой кнопке», что параллельно SPA `pointer-events:none`. Высота status-zone — одна строка в обоих режимах, прыжков нет.

### KTD-3. Wire-клиент: `clearFinished` / `clearAll` в `packages/shared/src/client.ts`, SPA реэкспортит

Сейчас SPA имеет приватные `clearFinished` / `clearAll` в `apps/web/src/lib/api.ts` (созданы в queue-polish PR). Поднимаем их в shared `client.ts` (где уже живут `enqueueText`, `removeJob`, `retryJob`, `setFolder`). `apps/web/src/lib/api.ts` остаётся как фасад: re-export всех shared-клиентов + сохранение текущих именных импортов в SPA-коде. TUI напрямую использует shared. Это убирает дублирование и держит wire-контракт в одном пакете.

### KTD-4. Confirm popup для Clear All — копия `ExitConfirm` с другим текстом

`ExitConfirm` уже имеет 2-button popup pattern с Tab-фокусом и Enter-confirm. Делаем `ClearAllConfirm` по тому же шаблону. Возможна экстракция общего `<TwoButtonPopup>` — отложить в Deferred (yagni для двух кейсов сейчас).

### KTD-5. Background tint статус-зоны через `<Box>` без явного `backgroundColor`

Ink `<Box>` поддерживает `borderStyle` и `padding`, но фоновое tint требует `backgroundColor` на `<Text>`-уровне (работает в большинстве терминалов через ANSI). Для transient state — обернуть message в `<Text backgroundColor="...">...</Text>`. Тint от `--code-bg-color` в SPA — нет эквивалента в TUI; используем явный `gray` или dim background. Альтернатива — нативный horizontal rule сверху/снизу (`─────`) для визуального выделения. Подберём при импле; baseline — `backgroundColor` на сообщении (не на всей строке, чтобы не подсвечивать пустое место за кнопками).

## High-Level Technical Design

```mermaid
flowchart TB
  subgraph TUI new layout
    H[Header: folder + Change]
    SZ[StatusZone: transient | hint + Clear Finished + Clear All]
    Q[Queue: jobs newest-first]
    H --> SZ --> Q
  end

  WS["WS JobEvent stream"] --> Handle{event._tag}
  Handle -- OutputFolderChanged --> SetFolder
  Handle -- SnapshotReplaced --> SetSnap["setSnapshot(event.snapshot)"]
  Handle -- other --> Refresh["GET /snapshot fallback"]
  WSClose["WS onClose"] --> Sticky["showTransient('error', 'Disconnected...', {sticky:true})"]
  WSOpen["WS onOpen (reconnect)"] --> Dismiss["dismissSticky()"]
```

Tab-обход (focusable controls in order):
```
0  [Change]
1  [Clear Finished]   (skip if disabled)
2  [Clear All]        (skip if disabled)
3+ per-job [Remove] / [Retry]   (existing computeActionable order)
```

Skipping disabled buttons в Tab-обходе — текущая логика `focusCount` это и делает (count actionable + 1 for [Change]), нужна аналогичная расширенная функция `computeFocusable`.

## Implementation Units

### U1. Promote wire clients: `clearFinished` and `clearAll` in `@scribd-dl/shared`

**Goal:** дать TUI и SPA доступ к одному wire-клиенту без дублирования.
**Requirements:** R10, KTD-3.
**Dependencies:** —
**Files:**
- `packages/shared/src/client.ts` (modify)
- `apps/web/src/lib/api.ts` (modify — re-export from shared)
- existing tests `apps/web/test/clear-commands.test.ts` остаются как есть (импорт через `@/lib/api`)

**Approach:**
- В `packages/shared/src/client.ts`: добавить `clearFinished(baseUrl)` → последовательно `DELETE /jobs/completed` + `DELETE /jobs/failed`, возвращает sum'у `removed`. И `clearAll(baseUrl)` → `DELETE /jobs`, возвращает `removed`.
- В `apps/web/src/lib/api.ts`: удалить локальные имплементации, re-export из `@scribd-dl/shared`.

**Patterns to follow:** существующие `enqueueText`, `removeJob` в `packages/shared/src/client.ts` (fetch + status check + typed JSON).

**Test scenarios:**
- `clearFinished` делает оба DELETE, sum'ит `removed`.
- `clearAll` делает один DELETE, возвращает `removed`.
- При non-2xx ответе throw'ает Error с указанием endpoint.

**Patterns to follow:** test-стиль из `apps/web/test/clear-commands.test.ts` (mock fetch). Если в `packages/shared` нет test-файла для client.ts, создаём `packages/shared/test/client.test.ts` (bun:test, mock fetch through global swap).

**Verification:** SPA тесты остаются зелёными после re-export refactor; новые shared-tests проходят.

---

### U2. WS `SnapshotReplaced` handling in `useEngineState`

**Goal:** применять snapshot inline без HTTP refresh.
**Requirements:** R11.
**Dependencies:** —
**Files:**
- `apps/tui/src/hooks/useEngineState.ts` (modify)
- `apps/tui/test/useEngineState.test.ts` (create или extend если есть)

**Approach:** в `onEvent` добавить `if (event._tag === "SnapshotReplaced") { setSnapshot(event.snapshot); return; }` перед fallback'ом `refresh()`.

**Patterns to follow:** существующая обработка `OutputFolderChanged` в том же файле.

**Test scenarios:**
- `SnapshotReplaced` event → snapshot обновлён, `fetchSnapshot` HTTP не вызван.
- `OutputFolderChanged` → folder обновлён, snapshot HTTP не вызван (existing).
- Другие события → fallback `fetchSnapshot` срабатывает (existing).

**Verification:** unit-test зелёный, manual smoke в TUI показывает обновление очереди после paste без видимой задержки HTTP.

---

### U3. Transient state with severity, sticky, priority in TUI

**Goal:** реализовать R3, R4, R5 — TUI-эквивалент SPA `$transient`.
**Requirements:** R3, R4, R5, R13.
**Dependencies:** —
**Files:**
- `apps/tui/src/tui/transient.ts` (create) — pure helpers (`compareSeverity`, `severityTimer`, `applyTransient(current, incoming)`).
- `apps/tui/src/hooks/useTransient.ts` (create) — `useTransient()` hook возвращающий `{ transient, showTransient, dismissSticky }`.
- `apps/tui/src/tui/App.tsx` (modify) — заменить `useState<string | null>` на `useTransient()`.
- `apps/tui/test/transient.test.ts` (create) — тесты pure helpers.
- `apps/tui/test/useTransient.test.ts` (create) — тесты hook'а (using `@testing-library/react-hooks` если установлен, иначе через `renderHook` из react).

**Approach:**
- `applyTransient(current, incoming)` — если incoming.severity > current.severity (по rank info=0, warning=1, error=2) ИЛИ current null → принимаем incoming. Sticky-error блокирует все, кроме другого error. dismissSticky сбрасывает безусловно.
- Per-severity таймеры: `info=2000`, `warning=4000`, `error=6000` (зеркалят SPA). Sticky → нет таймера.
- Hook'ом управляем setTimeout через ref'ы; cleanup в useEffect для отмены при unmount или замене.

**Execution note:** test-first для `applyTransient` — pure-функция легко спецаифицируется.

**Patterns to follow:** `apps/web/src/store.ts:showTransient/dismissSticky` логика (severity priority, sticky behaviour). Не копируем nanostores — переписываем под React idioms.

**Test scenarios:**
- *transient.ts pure:*
  - info overwritable by warning and error.
  - error blocks info/warning unless incoming is error.
  - sticky=true error blocks warning, accepts error.
  - Equal severity overwrites and resets timer expectation.
- *useTransient hook:*
  - showTransient('info', msg) → state set, timer scheduled, после 2000ms → null.
  - showTransient('error', msg, {sticky:true}) → state set, никаких таймеров не сработало после 10s.
  - dismissSticky() → state cleared.
  - При unmount таймеры очищаются (no warning о React state update).

**Verification:** unit-тесты зелёные; integration через рендер App'а (см. U5) подтверждает корректное отображение.

---

### U4. StatusZone view — relocate, integrate Clear actions, severity rendering

**Goal:** реализовать R2, R4, R5, R6, R7, R8 — переезд StatusBar под header, новые кнопки, severity-render.
**Requirements:** R2, R4, R5, R6, R7, R8.
**Dependencies:** U3.
**Files:**
- `apps/tui/src/tui/StatusZone.tsx` (create) — заменяет `StatusBar.tsx` (или существующий файл переименовываем).
- `apps/tui/src/tui/StatusBar.tsx` (delete) — функциональность поглощена.
- `apps/tui/src/tui/App.tsx` (modify) — relocate под `<Header>`, передать props (transient, jobs, focused-button index, callbacks).
- `apps/tui/test/status-zone.test.tsx` (create) — ink-testing-library render snapshots.

**Approach:**
- Props: `{ transient: TransientState | null, terminalCount: number, totalCount: number, clearFinishedFocused: boolean, clearAllFocused: boolean }`.
- Layout: `<Box marginTop={1}>...<Box flexGrow={1}>{text}</Box><ClearButton ... /><ClearButton ... /></Box>`.
- При `transient !== null` — рендерим только текст сообщения (см. KTD-2), без кнопок. Текст обёрнут в `<Text color={severityColor(transient.severity)} backgroundColor={...?}>...</Text>`.
- severityColor: `info → undefined+dimColor`, `warning → "yellow"`, `error → "red"`.
- `ClearButton` — inline-функция или маленький компонент: `<Text inverse={focused} dimColor={disabled}>[Clear Finished]</Text>`. Disabled inverse не применяется (skip focus, см. U5 focus-логику).

**Patterns to follow:** `apps/tui/src/tui/Header.tsx` (props + Box + Text inverse pattern); `apps/tui/src/tui/QueueItem.tsx` (color/dimColor использование).

**Test scenarios:**
- Default state (transient null, jobs empty): рендерит default hint + два кнопки disabled.
- Default state, terminal jobs present: Clear Finished не dim'нута, Clear All доступна.
- Transient warning: рендерит message с `yellow` color, кнопки не видны.
- Transient error sticky: message в `red`, кнопки не видны.
- focused=true на Clear Finished: соответствующий `<Text>` с inverse.

**Verification:** ink-render snapshot/text-contains assertions; manual smoke в `bun run dev:tui`.

---

### U5. Focus order, key bindings, Clear handlers in App

**Goal:** реализовать R7, R8, R9 — Tab расширен на Clear-кнопки, Enter триггерит соответствующее действие, Clear All запускает confirm-popup.
**Requirements:** R7, R8, R9.
**Dependencies:** U1, U3, U4.
**Files:**
- `apps/tui/src/tui/App.tsx` (modify)
- `apps/tui/src/tui/ClearAllConfirm.tsx` (create) — копия `ExitConfirm` с другим текстом и callback'ом.
- `apps/tui/test/app-focus.test.tsx` (create или extend) — integration test через ink-testing-library: Tab по controls, Enter триггерит mock callbacks.

**Approach:**
- Новый helper `computeFocusable(snapshot, transient)`:
  - всегда `[Change]` слот.
  - `[Clear Finished]` если есть terminal jobs И transient===null.
  - `[Clear All]` если есть любые jobs И transient===null.
  - actionable (`remove`/`retry`) после.
- `focusIndex` clamp'ится на изменение списка (уже есть в App.tsx — расширить логику).
- В `useInput`: Enter на Clear Finished → `void clearFinished(baseUrl).catch(...)` + локальный `showTransient('error', err.message)` при провале. Enter на Clear All → `setClearAllOpen(true)`. Confirm в popup → `void clearAll(baseUrl).catch(...)`.

**Execution note:** test-first для `computeFocusable` — pure-функция, легко тестируется.

**Patterns to follow:** существующая Tab-логика в `App.tsx:99-119`, `ExitConfirm` popup pattern, `useInput` на popup mode.

**Test scenarios:**
- Empty queue, transient null: focusable = [Change]; Tab кругом возвращает на Change.
- 2 jobs Queued, transient null: focusable = [Change, Clear All, item1 remove, item2 remove] (Clear Finished disabled — skipped).
- 1 Downloaded + 1 Queued: focusable включает Clear Finished И Clear All.
- Transient active: focusable = [Change, ...actionable items]; Clear-кнопки исключены.
- Enter on Clear Finished → mock api.clearFinished called.
- Enter on Clear All → ClearAllConfirm popup open; Confirm → mock api.clearAll called; Cancel → no call.
- При API error → showTransient('error', err.message) вызван.

**Verification:** integration tests зелёные; manual smoke по сценариям.

---

### U6. Sticky disconnect on WS close, dismiss on open

**Goal:** R12.
**Requirements:** R12.
**Dependencies:** U3, U2.
**Files:**
- `apps/tui/src/hooks/useEngineState.ts` (modify) — принимает callback'и `onOpen`/`onClose` и пробрасывает их вверх.
- `apps/tui/src/tui/App.tsx` (modify) — передаёт `showTransient('error', 'Disconnected from engine', {sticky:true})` в close, `dismissSticky()` в open.
- `apps/tui/test/useEngineState.test.ts` (extend) — close/open callbacks.

**Approach:** расширить интерфейс хука: `useEngineState(baseUrl, initialFolder, { onWsClose?, onWsOpen? })`. Пробросить эти callbacks в `subscribeEvents({ onClose, onOpen, ... })`.

**Patterns to follow:** существующая `subscribeEvents` сигнатура в `packages/shared/src/client.ts` (уже принимает `onOpen`/`onClose`).

**Test scenarios:**
- WS close fires → onWsClose callback invoked.
- WS reopen → onWsOpen invoked.
- Integration через App: close → transient sticky error; open → transient cleared.

**Verification:** unit + integration tests зелёные; manual smoke: `kill -9 engine PID` → TUI показывает sticky error; перезапуск engine → исчезает.

---

### U7. Unsupported URL paste → warning toast in TUI

**Goal:** R13 — match SPA's `handlePastedText` behaviour for unsupported URLs.
**Requirements:** R13.
**Dependencies:** U3, U5.
**Files:**
- `apps/tui/src/tui/App.tsx` (modify) — обновить `looksLikePaste(input)` branch в `useInput`:
  - анализировать response: если `jobs.every(j => j.status === 'Failed' && !j.failure?.retryable)` → `showTransient('warning', jobs[0].failure.reason)` (single) или `... (N links)`.
  - частичное rejection → `showTransient('warning', 'N of M links rejected')`.
  - пустой response → существующий info `No links found in clipboard`.

**Patterns to follow:** `apps/web/src/engineClient.ts:handlePastedText` — портируем логику дословно (только API вызовы остаются Promise-based, нет showTransient → SPA-store, заменён на hook).

**Test scenarios:**
- Empty enqueue response → info "No links found".
- All-failed-retryable=false response → warning toast с reason.
- Mixed response (1 failed + 1 queued) → warning "1 of 2 links rejected".
- Successful enqueue → no toast.

**Verification:** integration test через mock `enqueueText`; manual smoke.

---

## Scope Boundaries

### In scope

- TUI layout flip (status zone под header).
- Severity transient + sticky disconnect + warning для unsupported.
- Clear Finished / Clear All controls в Tab-обходе + confirm popup.
- Shared wire client промоушен (`clearFinished`, `clearAll`).
- `SnapshotReplaced` WS handling.

### Deferred to Follow-Up Work

- Экстракция общего `<TwoButtonPopup>` компонента (ExitConfirm + ClearAllConfirm). Сейчас два экземпляра, дублирование терпимое.
- Reconnect-кнопка в TUI (SPA имеет — TUI engineClient.reconnect аналог отсутствует; engine sidecar обычно persistent).
- Анимация transient появления/исчезновения.

### Outside scope

- Изменения engine'а — он уже отдаёт newest-first и `SnapshotReplaced`.
- Удаление файлов на диске при Clear (наследуется от engine — TUI не имеет такого API).
- Touch/click controls — TUI keyboard-only.

## Open Questions

- **Background tint статус-зоны в Ink.** Подобрать через `backgroundColor` на `<Text>` или horizontal rule — финальное решение при импле; baseline `backgroundColor="gray"` на сообщении.
- **Тестовая инфра для Ink:** в `apps/tui/test/` есть тесты — посмотреть, используется ли `ink-testing-library` или паттерн другой. Если другой — адаптировать новые тесты.
- **`computeFocusable` имя и местоположение:** export'ить из `App.tsx` ради тестов или вынести в `apps/tui/src/tui/focus.ts` — выбор при импле.

## Risks & Dependencies

- **Tab-обход регрессии.** Изменение `focusCount` при transient on/off может вызвать `focusIndex` skip'ы — текущий clamp в App.tsx обрабатывает; integration test покрывает.
- **Sticky-error race с reconnect.** Если close+open происходят очень быстро (engine restart), порядок callback'ов важен. Sticky устанавливается в close, snимается в open — порядок WebSocket events deterministic (close всегда раньше open для одного подключения, новое подключение → onOpen).
- **Shared client промоушен** меняет публичную поверхность `@scribd-dl/shared`. Внешних потребителей нет (монорепо), но `apps/web/src/lib/api.ts` re-export должен сохранить именованный экспорт `clearFinished` / `clearAll` чтобы SPA-tests не сломались.
- **`backgroundColor` поддержка** в терминалах: macOS Terminal.app + iTerm2 поддерживают; пользователь на macOS (текущая среда). Risk низкий; fallback — `inverse` modifier.

## Patterns and References

- **TUI architecture:** `apps/tui/src/tui/App.tsx` (top-level state + useInput), `apps/tui/src/hooks/useEngineState.ts` (WS + snapshot).
- **Popup pattern:** `apps/tui/src/tui/ExitConfirm.tsx` (2-button focus + Enter confirm).
- **Severity logic source-of-truth:** `apps/web/src/store.ts` (showTransient priority + timer logic), `apps/web/test/store.test.ts` (8 сценариев).
- **Wire client:** `packages/shared/src/client.ts` (где живут текущие операции), `apps/web/src/lib/api.ts` (SPA-фасад).
- **Origin brainstorm:** `docs/brainstorms/2026-06-11-queue-polish-requirements.md`.
- **Companion plan:** `docs/plans/2026-06-11-005-feat-queue-polish-plan.md`.

## Sources & Research

- Origin requirements doc carries the product behaviour spec; нет внешнего research — единый клиент engine'а уже спроектирован, TUI работа сводится к UI-проекции на Ink.

## Sequencing

Логически: **U1** (shared client foundation) → **U2** (WS snapshot handler) → **U3** (transient hook + helpers) — все три параллельны если разделены по файлам, но порядок U1→U3 уменьшает merge-conflict риск → **U4** (StatusZone view) → **U5** (focus + key bindings + handlers) → **U6** (sticky disconnect) → **U7** (unsupported toast).

Один PR подходит — все изменения когерентны и меньше queue-polish PR'а.
