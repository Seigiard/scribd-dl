---
title: "refactor: $draftFolder atom for folder-modal input state"
status: completed
created: 2026-06-11
completed: 2026-06-11
type: refactor
depth: shallow
---

# refactor: `$draftFolder` atom for folder-modal input state

## Summary

Заменить uncontrolled `<input .value=${folder ?? ""}>` в `apps/web/src/views/folder-modal.ts` на controlled через локальный nanostore atom `$draftFolder`. Draft seedится при открытии модалки из `$folder`, обновляется через `@input`, читается в `trySave`. Цель — устранить hidden bug, где внешний `$folder.set(...)` во время typing'а перезаписывал бы user input. Поведение для текущих сценариев (open / type / save / cancel / Enter / Escape) не меняется. Юнит-тесты folder-modal остаются зелёные (с минимальной адаптацией под новый source-of-truth).

---

## Problem Frame

В коммите `cb2aff5` `folder-modal.ts` использует uncontrolled input: на каждый рендер uhtml сетит `.value=${folder ?? ""}` через property assignment. Если между open и Save `$folder` не меняется — uhtml кэширует last template arg и **не трогает** `input.value`, поэтому draft user'а сохраняется. Это работает потому что:

1. `$folder` стабилен между open и save в текущем коде (`engineClient.loadFolder()` зовётся только на reconnect, до open модалки)
2. `$modalError` re-render тригерит template diff, но `folder` arg не меняется → input.value не трогается

Bomb: если кто-то добавит реактивный источник `$folder` (multi-tab sync, push event от engine, second WebSocket client) — `$folder.set("/новый")` во время typing'а → re-render → `.value=${"/новый"}` ≠ cached → uhtml перезапишет input.value → **draft потерян, курсор прыгнет**.

Дополнительно: тест "open modal, type, then external $folder change" сейчас невозможен без mock'ов DOM-уровня, потому что состояние draft'а живёт в DOM. С atom — это просто `$draftFolder.get()`.

---

## Requirements

- **R1** — Источник правды для значения input — atom `$draftFolder`, не `input.value` в DOM.
- **R2** — При открытии модалки (`$modal: none → folder`) `$draftFolder` seedится текущим `$folder.get() ?? ""`.
- **R3** — Каждое нажатие клавиши в input обновляет `$draftFolder` через `@input` handler.
- **R4** — `trySave` читает значение из `$draftFolder.get()`, не из DOM.
- **R5** — `main.ts` подписан на `$draftFolder` (нужно, иначе input.value не обновится при программном изменении draft'а).
- **R6** — `resetStores()` в `store.ts` сбрасывает `$draftFolder` в `""` для консистентности с другими атомами.
- **R7** — Все существующие сценарии folder-modal тестов остаются зелёные. Добавляется новый тест "внешний `$folder.set` во время typing'а не перезаписывает draft".
- **R8** — `bun run lint`, `format:check`, `test` — зелёные.

---

## Key Technical Decisions

### KTD1. `$draftFolder` живёт в `folder-modal.ts`, не в `store.ts`

Atom — view-local state, не application state. Это **продолжение** паттерна `$modalError`, который уже в `folder-modal.ts`. `store.ts` остаётся для cross-view state (`$folder`, `$modal`, `$jobs`, etc.). Reasoning: глобальный `store.ts` не должен расти каждый раз когда у модалки появляется новое внутреннее поле.

Исключение для `resetStores()`: нужно импортировать `$draftFolder` в `store.ts` чтобы reset работал, **или** — лучший вариант — оставить reset draft'а внутри view-файла как module-level `resetStores`-hook нет. Решение: добавить публичную функцию `resetFolderModal()` экспортируемую из view, и `resetStores()` зовёт её. Альтернатива (отвергнута): cycle import `store.ts → folder-modal.ts → store.ts` — рискованно.

### KTD2. `$draftFolder` — `atom<string>`, не `atom<string | null>`

Input.value всегда string. `null` смысла не имеет (для placeholder используется `?? ""` в seed). Упрощает тип проверки в template.

### KTD3. Seed во время `$modal` listen, не во время рендера

Уже есть `$modal.listen` блок в `folder-modal.ts` (он сбрасывает `$modalError` и теперь Escape handler). Seed `$draftFolder` идёт туда же:

```ts
$modal.listen((mode) => {
  if (mode === "folder") {
    $modalError.set(null);
    $draftFolder.set($folder.get() ?? "");
    attachEscape();
  } else {
    detachEscape();
  }
});
```

Reasoning: один источник side-effects при open/close, легче следить. Альтернатива — seed внутри view функции — нарушает pure-function правило.

### KTD4. `.value=${draft}` в template + `@input` для обратной связи

```html
<input
  class="folder-modal-input"
  .value=${draft}
  @input=${onInput}
  @keydown=${onInputKeydown}
/>
```

`@input` fires on каждом нажатии (включая paste, backspace, IME). `@change` fires только на blur — не подходит. Reasoning: realtime sync atom ↔ input, иначе trySave() прочитает stale draft при Enter без blur.

### KTD5. `main.ts` подписывается на `$draftFolder` в той же группе что и `$modal`/`$folder`/`$modalError`

```ts
$modal.listen(renderModal);
$folder.listen(renderModal);
$modalError.listen(renderModal);
$draftFolder.listen(renderModal);
```

Reasoning: каждое нажатие → atom set → render. Auto-keyed diff uhtml только переписывает `.value` prop, что не сбрасывает каретку (browser behavior для setter с same/new value). Cost: один template-diff на клавишу — для модалки с парой узлов незаметно.

Альтернатива (отвергнута): debounce. Лишний код, нет визуальной разницы для пользователя.

### KTD6. trim() остаётся в `trySave`, не в `onInput`

`$draftFolder` хранит сырой input (с пробелами). Trim — только в момент save validation. Reasoning: пользователь может временно иметь leading/trailing space во время typing'а и это не должно ломать UI (например, при пасте с переносом строки в начале — он сможет его удалить вручную не потеряв rest).

---

## High-Level Technical Design

### State flow

```text
$modal: "none"           →  $draftFolder: ""        (initial)
  ↓ (user clicks Change)
$modal.set("folder")
  ↓ (listener)
$draftFolder.set($folder.get() ?? "")    ← seed
  ↓ (re-render)
<input .value=${draft}>
  ↓ (user types "x")
@input → $draftFolder.set("x")
  ↓ (listener → renderModal)
<input .value="x">  (cursor preserved by browser)
  ↓ (user clicks Save)
trySave():
  val = $draftFolder.get().trim()
  if (!val) → $modalError.set(EMPTY_ERROR); return
  await saveFolder(val)
  → $folder.set(val) (внутри saveFolder)
  → $modal.set("none")
  → (listener detachEscape, NO seed because mode !== folder)
  → re-render (mode none → empty hole, draft не виден)
```

External `$folder.set` во время typing'а:

```text
[user typing "/foo"]
$draftFolder = "/foo"
<input .value="/foo">
  ↓ (другая вкладка: $folder.set("/bar") приходит через WS)
$folder = "/bar"  но  $draftFolder ОСТАЁТСЯ "/foo"
re-render: <input .value="/foo">  ← draft сохранён ✓
```

### File layout changes

```text
apps/web/src/views/folder-modal.ts    # MODIFY: add $draftFolder + seed + onInput + trySave reads
apps/web/src/main.ts                  # MODIFY: subscribe $draftFolder to renderModal
apps/web/src/store.ts                 # MODIFY: resetStores() calls resetFolderModal()
apps/web/test/folder-modal.test.ts    # MODIFY: adapt scenarios + add 1 new test
```

---

## Implementation Units

### U1. Introduce `$draftFolder` + seed + read

**Goal:** atom существует, sеedится при open, читается в trySave. View рендерит `.value=${draft}` через @input.

**Requirements:** R1, R2, R3, R4, R6.

**Files:**
- `apps/web/src/views/folder-modal.ts` — MODIFY
- `apps/web/src/store.ts` — MODIFY: вызов `resetFolderModal()` из `resetStores()`

**Approach:**
1. В `folder-modal.ts` добавить:
   ```ts
   export const $draftFolder = atom<string>("");
   export const resetFolderModal = (): void => {
     $modalError.set(null);
     $draftFolder.set("");
   };
   ```
2. Обновить `$modal.listen`:
   ```ts
   $modal.listen((mode) => {
     if (mode === "folder") {
       $modalError.set(null);
       $draftFolder.set($folder.get() ?? "");
       attachEscape();
     } else {
       detachEscape();
     }
   });
   ```
3. Добавить `onInput`:
   ```ts
   const onInput = (e: Event): void => {
     $draftFolder.set((e.target as HTMLInputElement).value);
   };
   ```
4. Изменить `trySave`:
   ```ts
   const trySave = async (): Promise<void> => {
     const val = $draftFolder.get().trim();
     if (!val) { $modalError.set(EMPTY_ERROR); return; }
     try { await saveFolder(val); $modalError.set(null); close(); }
     catch { $modalError.set(SAVE_ERROR); }
   };
   ```
   Убрать аргумент `input: HTMLInputElement` и `findInput()` helper — больше не нужны.
5. Изменить `onSaveClick` и `onInputKeydown` — вызывают `trySave()` без аргументов.
6. В template:
   ```html
   <input
     class="folder-modal-input"
     type="text"
     autocomplete="off"
     spellcheck="false"
     .value=${draft}
     @input=${onInput}
     @keydown=${onInputKeydown}
   />
   ```
   Где `draft = $draftFolder.get()` — но wait, props всё ещё через FolderModalProps. Решение ниже в KTD: либо передавать `draft` через props (требует подписки в main.ts), либо читать прямо в template — но это нарушает pure-function. Правильное решение: **передавать через props**, что требует обновления `FolderModalProps`:
   ```ts
   export type FolderModalProps = {
     mode: ModalMode;
     folder: string | null;  // оставляем для отображения текущего сохранённого folder, если понадобится в UI
     error: string | null;
     draft: string;          // NEW
   };
   ```
   Actually `folder` prop становится unused в самом template после изменения (он используется только для seed, который делается в listen). Можно убрать. Но это меняет props API → тесты. Решение: оставить `folder` в props для семантической полноты + дать возможность тестам передавать его независимо.

7. В `store.ts`:
   ```ts
   import { resetFolderModal } from "./views/folder-modal";
   // ...
   export const resetStores = (): void => {
     $jobs.set({});
     $folder.set(null);
     $connected.set(false);
     clearTransient();
     $modal.set("none");
     resetFolderModal();
   };
   ```
   ⚠️ Cycle risk: `folder-modal.ts` imports from `store.ts` (`$modal`, `$folder`, `ModalMode`). Adding `store.ts → folder-modal.ts` import = cycle.
   **Alternative:** держать reset логику где-то neutral. Простейший вариант: `folder-modal.ts` сам подписывается на event "reset" — но в nanostores нет такого. Pragmatic: использовать `$modal.listen` уже существующий — он сбрасывает draft когда mode становится "none" (но draft нужен только когда mode "folder", so OK не сбрасывать):
   ```ts
   $modal.listen((mode) => {
     if (mode === "folder") {
       $modalError.set(null);
       $draftFolder.set($folder.get() ?? "");
       attachEscape();
     } else {
       $modalError.set(null);   // also reset on close
       $draftFolder.set("");
       detachEscape();
     }
   });
   ```
   Тогда `resetStores()` неявно сбрасывает draft через `$modal.set("none")` listener. Никакого import cycle.

   **Решение:** убрать `resetFolderModal()`, опираться на `$modal.listen` callback внутри view-файла.

**Execution note:** test-first для нового сценария (R7); существующие тесты адаптируются как side effect.

**Test scenarios:**
- Все 12 существующих сценариев folder-modal.test.ts остаются зелёные после адаптации
- **NEW:** open modal, set `$draftFolder` to "draft", external `$folder.set("/external")` → re-render → input.value === "draft" (draft не перезаписан)

**Verification:**
- `bun --cwd apps/web run test test/folder-modal.test.ts` — все 13 тестов зелёные
- Grep `apps/web/src/views/folder-modal.ts` — нет `findInput`, `input: HTMLInputElement` параметров в `trySave`
- В живом SPA: open / type / save → ok; open / type / Cancel → ok; reopen → input value reset на текущий `$folder`

---

### U2. Wire `$draftFolder` subscription in main.ts

**Goal:** `main.ts` subscribed to `$draftFolder` чтобы каждое нажатие триггерило re-render с новым `draft` props.

**Requirements:** R5.

**Files:**
- `apps/web/src/main.ts` — MODIFY

**Approach:**
```ts
import { folderModal, $modalError, $draftFolder } from "./views/folder-modal";
// ...
const renderModal = mount(".mount-modal", () =>
  folderModal({
    mode: $modal.get(),
    folder: $folder.get(),
    error: $modalError.get(),
    draft: $draftFolder.get(),
  }),
);
$modal.listen(renderModal);
$folder.listen(renderModal);
$modalError.listen(renderModal);
$draftFolder.listen(renderModal);
renderModal();
```

**Test scenarios:** none (integration с реальным DOM покрывает SPA smoke). Юнит-тесты folder-modal проходят через прямой render(container, folderModal({...})), они не зависят от main.ts wiring.

**Verification:**
- `bun --cwd apps/web run test` — все 46 тестов зелёные
- В живом SPA: тyping в input — input.value обновляется realtime; курсор не прыгает

---

### U3. Update tests + add external-folder-change test

**Goal:** все существующие folder-modal сценарии адаптированы под `draft` props. Новый тест покрывает R7 happy path.

**Requirements:** R7.

**Files:**
- `apps/web/test/folder-modal.test.ts` — MODIFY

**Approach:**
1. Обновить `mountModal` helper:
   ```ts
   const mountModal = (
     props: { mode: "none" | "folder"; folder: string | null; error: string | null; draft?: string },
   ): HTMLElement => {
     const container = document.createElement("div");
     document.body.appendChild(container);
     render(container, folderModal({ draft: "", ...props }));
     return container;
   };
   ```
   default draft = "" для совместимости с тестами что фокусируются на mode/folder/error.

2. Адаптировать сценарии "Save with empty path" и "Save with valid path":
   ```ts
   // OLD: input.value = "   "; save.click(); expect(...)
   // NEW: $draftFolder.set("   "); mountModal({...}); save.click(); expect(...)
   ```
   Или ещё проще: тесты mount'ят с `draft: "   "` напрямую через props, и save читает из `$draftFolder` (который НЕ синхронизирован с props автоматически — нужно set'ить отдельно).

   **Pragmatic:** в тестах сетим `$draftFolder.set(...)` напрямую (это публичный экспорт), и mount'им с тем же значением в props. Two-step но честно отражает реальный flow (atom — source of truth, props — snapshot).

3. Тест "Enter in input triggers save flow" — input.value больше не sets draft через DOM; вместо этого `$draftFolder.set("/new")` + dispatch Enter.

4. Новый тест:
   ```ts
   it("external $folder change during typing does not overwrite draft", () => {
     $modal.set("folder");
     $draftFolder.set("/my-draft");
     const root = mountModal({ mode: "folder", folder: "/old", error: null, draft: "/my-draft" });
     const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
     expect(input.value).toBe("/my-draft");

     // simulate external change
     $folder.set("/external");
     // в реальности: main.ts wiring сделал бы re-render. в юнит-тесте — манульно:
     render(root, folderModal({ mode: "folder", folder: "/external", error: null, draft: $draftFolder.get() }));
     expect(input.value).toBe("/my-draft");  // draft preserved
   });
   ```

**Test scenarios:** см. approach.

**Verification:** все 13 тестов зелёные. Grep test файла — нет `input.value = ...` (input → draft direction идёт через `@input` который тестируется через `$draftFolder.set`).

---

## Scope Boundaries

### In scope

U1, U2, U3.

### Out of scope

- **Реактивное обновление `$folder` извне через push events** — это гипотетический будущий сценарий, который мотивирует этот рефакторинг, но не имплементируется здесь. Сегодня `$folder` меняется только через `saveFolder()` (внутри которого `$folder.set`) и `loadFolder()` (только на reconnect).
- **Cursor position preservation при программном `$draftFolder.set("...")`** — браузер сохраняет курсор когда новое value === старому или при минимальных изменениях. Для extreme cases (паста длинного текста + одновременный external change) могут быть артефакты — не цель рефакторинга.
- **Debouncing input updates** — micro-optimization, не нужно.
- **Migration других views на atom-based input state** — других input'ов в SPA сейчас нет.

---

## Risks & Dependencies

### R1 — Существующие тесты ломаются от изменения API

`FolderModalProps` получает поле `draft`. Тесты что mount'ят modal через props и проверяют input.value сейчас могут сломаться.

Mitigation: default `draft: ""` в `mountModal` helper'е; точечные обновления только для сценариев где draft релевантен.

### R2 — `@input` handler не отрабатывает в jsdom при `dispatchEvent`

`dispatchEvent(new KeyboardEvent("keydown", ...))` не триггерит `@input` (input event fires on value change, не на keydown). Тесты что использовали `input.value = ...; dispatchEvent("keydown", "Enter")` теперь должны сетить `$draftFolder.set(...)` напрямую и потом dispatch'ить Enter.

Mitigation: тесты пишутся вокруг atom-based model, не DOM-based.

### R3 — Cursor jump при re-render

uhtml `.value=${draft}` setter может прыгнуть в конец input при каждом keystroke. В реальном браузере setter с тем же value (что только что напечатано) — no-op. В jsdom — поведение может отличаться.

Mitigation: ручной тест в живом SPA в U2 verification. Если курсор прыгает — fallback на uncontrolled с оговоркой (но это будет признаком что atom-based не работает; deferred к будущему research).

### R4 — Реактивность каскадирует — `$draftFolder.set` → re-render → uhtml diff → DOM update — на каждом keystroke

При очень быстром typing'е могут быть лаги. Для текущей модалки с парой узлов — практически незаметно.

Mitigation: измерить через DevTools profiler если будут жалобы. Не блокирует.

---

## Success Criteria

См. R1-R8.

Дополнительно:
- Diff в PR `< 100 строк` чистого кода (без тестов): чистое, локализованное изменение
- Никаких новых exports из `store.ts` (`$draftFolder` живёт в view-файле, как `$modalError`)
- В коммит-сообщении указано "Mitigates hypothetical race between external $folder.set and user typing"

---

## Patterns to Follow

- **`$modalError` в `folder-modal.ts`** — образец view-local atom pattern. `$draftFolder` зеркалит structure
- **`$modal.listen` block** — образец single-source-of-truth для open/close side-effects (Escape, error reset, теперь draft seed)
- **Существующие vitest patterns в folder-modal.test.ts** — для атом-based assertions (`expect($modal.get()).toBe(...)`)

---

## Sources & Research

- Текущий код: `apps/web/src/views/folder-modal.ts` (commit `cb2aff5`)
- Plan-источник: `docs/plans/2026-06-11-002-refactor-uhtml-islands-rewrite-plan.md` U7 Approach: "Альтернатива (deferred to implementation): локальный `$draftFolder` atom"
- uhtml `.value` prop semantics: `node_modules/uhtml/index.js` — точка перед именем = property assignment, value props кэшируются по template arg identity
