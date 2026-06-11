---
title: "refactor: Rewrite apps/web to uhtml + islands"
status: completed
created: 2026-06-11
completed: 2026-06-11
origin: docs/brainstorms/2026-06-11-uhtml-islands-rewrite-requirements.md
type: refactor
depth: standard
---

# refactor: Rewrite `apps/web` to uhtml + islands

## Summary

Переписать `apps/web` SPA с nanotags + Custom Elements на uhtml v4 + vanilla nanostores по паттерну islands. `index.html` содержит layout с пустыми mount-контейнерами; `main.ts` подписывает каждый mount на минимально необходимые сторы; компоненты становятся pure-функциями, возвращающими `html\`...\`` template. Тесты переписываются под `render(container, view(props))`. Удаляем `nanotags` из dependencies, удаляем проектный skill `idiomatic-nanotags`, дропаем `sd-` CSS-префикс. Big-bang в одном PR из ветки `refactor/uhtml-islands-rewrite`.

---

## Problem Frame

См. origin: `docs/brainstorms/2026-06-11-uhtml-islands-rewrite-requirements.md`.

Кратко: первая попытка ("idiomatic nanotags Phase A") разбилась о hard инвариант — `withRefs` в nanotags резолвится в `connectedCallback()` до `setup()`, что несовместимо с `ctx.host.innerHTML` в `setup()`. Если markup всё равно живёт в TS, nanotags даёт трение без пользы. Решение: уйти на uhtml + islands, где layout остаётся структурным якорем в HTML, контент — функциональный в TS.

---

## Requirements (from origin)

- **R1** — `nanotags` удалён из всех package.json в `apps/web` и не появляется в `bun.lock`.
- **R2** — Ни одного `customElements.define` в `apps/web/src/`.
- **R3** — `index.html` `<body>` содержит layout-структуру с пустыми mount-контейнерами; нет `<sd-*>` тегов.
- **R4** — Каждый mount-point подписан только на минимально необходимые сторы.
- **R5** — `bun run lint`, `bun run format:check`, `bun run test` зелёные.
- **R6** — Поведение SPA не изменилось при ручном тестировании: paste → queue → download → folder modal → disconnect banner.
- **R7** — Старый brainstorm и plan помечены `status: superseded` со ссылкой на новый brainstorm. Старая ветка `refactor/nanotags-idiomatic-phase-a` брошена без merge.

---

## Key Technical Decisions

### KTD1. Директория `src/views/` для новых view-функций

Создаём новую директорию `apps/web/src/views/` параллельно с `components/`. По мере имплементации views в `views/` соответствующие `components/sd-*.ts` удаляются. По завершении `components/` удаляется целиком. Reasoning: чистый диф в PR (новые файлы рядом со старыми, прозрачное замещение), и `components/` исторически ассоциируется с nanotags-стилем — переименование сигнализирует архитектурный сдвиг.

### KTD2. Два mount-point'а в `.terminal-content`: `.mount-banner` и `.mount-queue`

В origin был open question. Резолв: **два**. `.mount-banner` подписан только на `$connected`, `.mount-queue` — только на `$jobs`. Альтернатива (один общий контейнер) экономит одну подписку, но дёргает re-render banner при каждом tick прогресса любого job. Два mount'а — никакого лишнего рендера, чище соответствие "один island — один стор".

### KTD3. CSS-префикс `sd-` дропаем целиком

В origin был open question. Резолв: дропаем. Префикс был обязателен только потому что custom-element имена должны содержать дефис; для классов это не требование. В `styles.css` selectors `sd-queue-item` → `.queue-item`, `sd-header` → `.header` и т.д. Один workspace, нэймспейсов внутри `apps/web` не существует — `sd-` не несёт смысла.

### KTD4. Один файл на view в `src/views/`

В origin был open question. Резолв: один файл на view, зеркалит существующий `components/`. Файлы: `views/statusbar.ts`, `views/disconnect-banner.ts`, `views/header.ts`, `views/queue-item.ts`, `views/queue.ts`, `views/folder-modal.ts` + `views/icons.ts` для общей `STATUS_ICON` map. Reasoning: облегчает per-view diff, упрощает test naming (один тест-файл на view), не размазывает логику по непредсказуемым группам.

### KTD5. Подписка через nanostores `listen()` + `set` начального состояния

Каждый view подписан на свои сторы через стандартный `store.listen(callback)` из nanostores (vanilla JS API). После подписки немедленно вызываем callback с текущим значением для initial render. Reasoning: `listen()` не fire'ит на subscribe (в отличие от RxJS `BehaviorSubject` или uhtml `effect`), но это лучше явного контроля порядка bootstrap'а — initial render явный, не магический.

uhtml имеет встроенный `effect`/`signal` API, но мы его не используем — оставляем nanostores как единственный reactive layer для консистентности с `store.ts`.

### KTD6. Список jobs через `.map` с `key=${id}` атрибутом uhtml

uhtml поддерживает keyed list updates через атрибут `key`. Заменяет `renderList` из nanotags. Reasoning: меньше зависимостей, типизация наследуется от `Object.values(jobs)`, переиспользование узлов гарантировано библиотекой.

### KTD7. Order events / effects в каждом view-файле

Convention для всех view-функций:
1. Pure render functions без сайд-эффектов: `view(props) → html\`...\``
2. Event handlers — closures, переданные через `@click=${fn}` / `oninput=${fn}` прямо в template
3. Setup-логика (subscriptions, listeners) живёт **в `main.ts`**, не в view-файлах
4. View-файлы экспортируют **только** функцию рендера + (при необходимости) тип props

Reasoning: views = pure functions; subscriptions = manage в одном месте (`main.ts`); это упрощает тестирование (рендер без mock'ов store), и делает зависимости каждого view явными через сигнатуру.

---

## High-Level Technical Design

### Архитектурный поток

```text
index.html
└── <body>
    ├── <div class="terminal-banner terminal-header">
    │   ├── <strong>Scribd downloader</strong>
    │   └── <div class="mount-header"></div>       ← header() рендер
    ├── <div class="terminal-content">
    │   ├── <div class="mount-banner"></div>        ← disconnectBanner() рендер
    │   └── <div class="mount-queue"></div>         ← queue() рендер
    ├── <div class="terminal-footer">
    │   └── <div class="mount-statusbar"></div>     ← statusbar() рендер
    └── <div class="mount-modal"></div>             ← folderModal() рендер
```

### Mount → store → view binding

| Mount class | Подписан на | View функция | Props |
|---|---|---|---|
| `.mount-header` | `$folder` | `header({ folder })` | `{ folder: string \| null }` |
| `.mount-banner` | `$connected` | `disconnectBanner({ connected })` | `{ connected: boolean }` |
| `.mount-queue` | `$jobs` | `queue({ jobs })` | `{ jobs: Record<JobId, Job \| undefined> }` |
| `.mount-statusbar` | `$transient` | `statusbar({ transient })` | `{ transient: string \| null }` |
| `.mount-modal` | `$modal`, `$folder` | `folderModal({ mode, folder })` | `{ mode: ModalMode, folder: string \| null }` |

### main.ts shape (directional)

```ts
import { render } from "uhtml";
import { $jobs, $folder, $connected, $transient, $modal } from "./store";
import { header } from "./views/header";
// ... etc

const mount = (selector: string, view: () => Hole) => {
  const el = document.querySelector(selector)!;
  return () => render(el, view());
};

const renderHeader = mount(".mount-header", () => header({ folder: $folder.get() }));
$folder.listen(renderHeader); renderHeader();

const renderBanner = mount(".mount-banner", () => disconnectBanner({ connected: $connected.get() }));
$connected.listen(renderBanner); renderBanner();

// ... rest
```

Directional only — точный shape `mount()` helper'а решает имплементация.

### Зависимости между Implementation Unit'ами

```text
U1 (pre-commit + scaffolding)
 │
 ├─→ U2 (statusbar — proof of concept)
 │
 ├─→ U3 (disconnect-banner)
 │
 ├─→ U4 (header)
 │
 ├─→ U5 (queue-item view) ──→ U6 (queue list)
 │
 ├─→ U7 (folder-modal)
 │
 └─→ U8 (cleanup) ──→ U9 (final validation)
```

U2-U7 независимы между собой (кроме U6 от U5), порядок предложен по нарастанию сложности.

---

## Output Structure

```text
apps/web/
├── index.html                              # MODIFY: layout с mount-контейнерами
├── package.json                            # MODIFY: -nanotags, +uhtml
└── src/
    ├── main.ts                             # REWRITE: bootstrap + per-island subscriptions
    ├── store.ts                            # UNCHANGED
    ├── engineClient.ts                     # UNCHANGED
    ├── devFixtures.ts                      # UNCHANGED
    ├── styles.css                          # MODIFY: tag selectors → class selectors, drop sd- prefix
    ├── views/                              # NEW directory
    │   ├── icons.ts                        # NEW: STATUS_ICON map + icon helper
    │   ├── statusbar.ts                    # NEW
    │   ├── disconnect-banner.ts            # NEW
    │   ├── header.ts                       # NEW
    │   ├── queue-item.ts                   # NEW
    │   ├── queue.ts                        # NEW
    │   └── folder-modal.ts                 # NEW
    ├── components/                         # DELETE entirely after migration
    │   └── sd-*.ts                         # DELETE in U8
    └── lib/                                # UNCHANGED
test/                                       # REWRITE all *.test.ts
    ├── statusbar.test.ts                   # REWRITE
    ├── disconnect.test.ts                  # REWRITE
    ├── folder-modal.test.ts                # REWRITE
    ├── queue.test.ts                       # REWRITE
    ├── queue-item.test.ts                  # REWRITE
    ├── store.test.ts                       # UNCHANGED (store API не меняется)
    ├── smoke.test.ts                       # REWRITE
    └── paste.test.ts                       # likely UNCHANGED (тестирует engineClient, не view)
```

Структура — scope declaration. Имплементация может скорректировать (например, объединить мелкие views в один файл) если откроется лучшая раскладка.

---

## Implementation Units

### U1. Pre-commit + scaffolding

**Goal:** закоммитить пометки `superseded` на старых артефактах и новый brainstorm; добавить `uhtml` в зависимости; создать пустую `views/`; обновить `index.html` с layout и mount-контейнерами; начать миграцию `styles.css` (новые класс-селекторы добавляются, старые тег-селекторы пока остаются для overlap-фазы).

**Requirements:** R3 (частично — layout), R7 (commit superseded marks).

**Dependencies:** none.

**Files:**
- `apps/web/index.html` — MODIFY: layout с `.mount-*` контейнерами; убрать `<sd-*>` теги; оставить `<svg>` defs для иконок
- `apps/web/package.json` — MODIFY: добавить `"uhtml": "^4"` в `dependencies`
- `apps/web/src/views/` — CREATE (директория)
- `apps/web/src/styles.css` — MODIFY: добавить class-селекторы (`.queue-item`, `.header`, ...) рядом с существующими тег-селекторами (overlap fase)
- Repo root: stage уже-отредактированные `docs/brainstorms/2026-06-11-nanotags-idiomatic-refactor-requirements.md`, `docs/plans/2026-06-11-001-refactor-nanotags-idiomatic-phase-a-plan.md`, новый `docs/brainstorms/2026-06-11-uhtml-islands-rewrite-requirements.md`, и этот план

**Approach:**
- `index.html` `<body>` структура — см. HTD выше. SVG `<symbol>` defs остаются для иконок (используются через `<use href="#icon-...">`).
- `bun install` после правки `package.json` — `bun.lock` обновляется.
- `styles.css` — копируем правила от тег-селекторов в класс-селекторы, оставляя старые на время миграции (удаляются в U8).
- Один коммит с docs (superseded marks + new brainstorm + plan), отдельный коммит со scaffolding (index.html + package.json + views/ + styles.css).

**Patterns to follow:** существующий `index.html` для SVG defs; уже-применённые правки superseded к `docs/brainstorms/2026-06-11-nanotags-idiomatic-refactor-requirements.md` и `docs/plans/2026-06-11-001-refactor-nanotags-idiomatic-phase-a-plan.md`.

**Test scenarios:** Test expectation: none — pure scaffolding, нет behavioral change.

**Verification:**
- `bun install` отработал без ошибок, `uhtml` в `node_modules/uhtml/`
- `bun --cwd apps/web run dev` стартует Vite, страница загружается (пусть и без контента — mount-контейнеры пустые)
- Старые тесты всё ещё зелёные (`sd-*` теги в `index.html` пока есть... wait — мы их убрали в этом шаге. Старые тесты могут опираться на структуру `index.html`? Проверить smoke.test.ts перед коммитом)
- Все четыре markdown-файла в `docs/` закоммичены

---

### U2. Statusbar view (proof of concept)

**Goal:** первый view, самый простой (один store, один div, textContent). Подтверждает что uhtml + nanostores islands-паттерн работает end-to-end. Удаляет `components/sd-statusbar.ts` и переписывает `test/statusbar.test.ts`.

**Requirements:** R2 (для statusbar), R4, R5.

**Dependencies:** U1.

**Files:**
- `apps/web/src/views/statusbar.ts` — CREATE
- `apps/web/src/main.ts` — MODIFY: добавить statusbar island
- `apps/web/src/components/sd-statusbar.ts` — DELETE
- `apps/web/test/statusbar.test.ts` — REWRITE

**Approach:**
- View функция: `statusbar({ transient }: { transient: string | null }): Hole` возвращает `html\`...\``.
- Default hint: `"Press Ctrl/Cmd+V to download links"` (как в текущей реализации). Если `transient` — показать его, иначе default.
- В `main.ts`: `const renderStatusbar = () => render(statusbarEl, statusbar({ transient: $transient.get() })); $transient.listen(renderStatusbar); renderStatusbar();`
- Удалить `components/sd-statusbar.ts` и его импорт из `main.ts`.

**Execution note:** test-first для view-функции — пишем `test/statusbar.test.ts` с новым shape, потом view, проверяем зелёный.

**Patterns to follow:** `apps/web/src/components/sd-statusbar.ts` (старая логика — что показывать) и uhtml docs примеры для tagged templates.

**Test scenarios:**
- **Happy path 1:** `statusbar({ transient: null })` рендерится в div, textContent равен default hint
- **Happy path 2:** `statusbar({ transient: "Folder updated" })` рендерится, textContent равен `"Folder updated"`
- **Edge case:** `statusbar({ transient: "" })` — пустая строка как valid transient (показывается пустой; default НЕ срабатывает, потому что value передан)

Тест-шаблон:
```ts
import { render } from "uhtml";
import { statusbar } from "@/views/statusbar";

it("shows default hint when transient is null", () => {
  const container = document.createElement("div");
  render(container, statusbar({ transient: null }));
  expect(container.textContent).toContain("Press Ctrl/Cmd+V");
});
```

**Verification:**
- `bun --cwd apps/web test test/statusbar.test.ts` зелёный
- `bun --cwd apps/web run dev` — статус-бар отображается, при paste меняется на transient и возвращается через 2 секунды
- `components/sd-statusbar.ts` удалён, импорта в `main.ts` нет

---

### U3. Disconnect banner view

**Goal:** второй простой view с одним store ($connected), с button и event handler. Подтверждает что `@click=${fn}` работает корректно.

**Requirements:** R2 (для banner), R4, R5.

**Dependencies:** U1 (паттерн mount из U2 закрепить полезно, но не блокирует).

**Files:**
- `apps/web/src/views/disconnect-banner.ts` — CREATE
- `apps/web/src/main.ts` — MODIFY
- `apps/web/src/components/sd-disconnect-banner.ts` — DELETE
- `apps/web/test/disconnect.test.ts` — REWRITE

**Approach:**
- `disconnectBanner({ connected }: { connected: boolean }): Hole | null`. Возвращает `null` если connected, иначе `html\`<div class="terminal-alert terminal-alert-error">...<button @click=${reconnect}>Reconnect</button>...\``.
- `reconnect` импортируется из `@/engineClient` напрямую в view-файл (это допустимо — это не store, это команда).
- В `main.ts`: subscribe на `$connected`.
- Удалить `components/sd-disconnect-banner.ts`.

**Test scenarios:**
- **Happy path 1:** `disconnectBanner({ connected: true })` рендерится в пустой контейнер (или контейнер очищается)
- **Happy path 2:** `disconnectBanner({ connected: false })` рендерится с текстом "Disconnected" и кнопкой "Reconnect"
- **Integration:** click на Reconnect вызывает `reconnect` mock из `engineClient`

**Verification:**
- `bun --cwd apps/web test test/disconnect.test.ts` зелёный
- Старый файл удалён
- В живом SPA: остановить engine → banner появляется; click Reconnect → пытается переподключиться

---

### U4. Header view

**Goal:** view со static label + dynamic folder display + button открывающий modal.

**Requirements:** R2, R4, R5.

**Dependencies:** U1.

**Files:**
- `apps/web/src/views/header.ts` — CREATE
- `apps/web/src/main.ts` — MODIFY
- `apps/web/src/components/sd-header.ts` — DELETE
- `apps/web/test/header.test.ts` — CREATE (если не было такого теста раньше — проверить; smoke.test.ts покрывает header частично)

**Approach:**
- `header({ folder }: { folder: string | null }): Hole`. Шаблон: `<div class="folder-row"><span>Download folder: <span>${folder ?? "—"}</span></span><button @click=${openModal}>Change</button></div>`.
- `openModal` — локальная функция в view-файле, делает `$modal.set("folder")`. Допустимо: команды на сторы — это бизнес-логика, ей место рядом с handler.
- Альтернативно: handler передаётся через props (`onChangeClick`). Решение — inline в view, чтобы props не разбухали. Если в будущем view понадобится в другом контексте — вытащим в props.

**Test scenarios:**
- **Happy path 1:** `header({ folder: null })` рендерится с placeholder `—`
- **Happy path 2:** `header({ folder: "/Users/foo" })` рендерится с актуальным путём
- **Integration:** click на Change ставит `$modal.set("folder")`

**Verification:**
- Тест зелёный, SPA в браузере: folder display обновляется, click открывает modal

---

### U5. Queue-item view + icons module

**Goal:** центральный view с conditional rendering (progress, reason, action button по статусу). Также вынести общий `STATUS_ICON` map в `views/icons.ts` для переиспользования.

**Requirements:** R2, R4, R5.

**Dependencies:** U1.

**Files:**
- `apps/web/src/views/icons.ts` — CREATE: `STATUS_ICON` map + helper для `<svg><use href=...>`
- `apps/web/src/views/queue-item.ts` — CREATE
- `apps/web/src/components/sd-queue-item.ts` — DELETE (после U6, когда queue будет использовать новый view)
- `apps/web/test/queue-item.test.ts` — REWRITE

**Approach:**
- `queueItem(job: Job): Hole` — pure function от job. Возвращает шаблон с шапкой (icon + title + action button), URL, conditional progress, conditional failure reason.
- Action button: `null` если статус не требует action; иначе `html\`<button @click=${() => onAction(job.id)}>...\``. Решение по обработчику: `onAction` — closure захватывающая `retryJobById` / `removeJobById` импортированных из `engineClient`. Логика выбора retry vs remove — inline в view.
- Conditional rendering — JS ternary внутри template: `${job.status === "Downloading" && job.progress ? html\`<div>${...}</div>\` : null}`.
- SVG icon: `<svg class="item-icon item-icon-status"><use href=${STATUS_ICON[job.status]}/></svg>`. `STATUS_ICON[job.status]` возвращает строку типа `"#icon-queued"`.
- Job's `displayTitle || "—"` для placeholder.

**Test scenarios:**
- **Happy path Queued:** job status Queued — title, default icon, action = Remove button
- **Happy path Downloading с progress:** title + URL + progress text (`done / total (stage)`); нет action
- **Happy path Downloaded:** title + URL, нет action, нет progress, нет reason
- **Happy path Failed retryable:** action = Retry button; reason шоу
- **Happy path Failed non-retryable:** action = Remove button; reason шоу
- **Integration retry:** render Failed retryable, click action → `retryJobByIdMock` вызван с id
- **Integration remove:** render Queued, click action → `removeJobByIdMock` вызван с id
- **Edge case empty title:** job с `displayTitle: ""` → отображается `—`

**Verification:**
- Тест зелёный с теми же сценариями что и старый `queue-item.test.ts` (по содержанию, не по DOM-структуре mount-через-CE)
- `components/sd-queue-item.ts` ещё НЕ удалён — он удалится в U6 когда queue будет использовать новый view (избегаем broken intermediate state)

---

### U6. Queue view (list rendering)

**Goal:** список jobs через `.map` с `key=${id}`. Использует `queueItem` из U5. Удаляет старый `components/sd-queue-item.ts` и `components/sd-queue.ts`.

**Requirements:** R2, R4, R5.

**Dependencies:** U5 (queueItem должен существовать).

**Files:**
- `apps/web/src/views/queue.ts` — CREATE
- `apps/web/src/main.ts` — MODIFY: подключить queue island
- `apps/web/src/components/sd-queue.ts` — DELETE
- `apps/web/src/components/sd-queue-item.ts` — DELETE
- `apps/web/test/queue.test.ts` — REWRITE

**Approach:**
- `queue({ jobs }: { jobs: Record<JobId, Job | undefined> }): Hole`. Реализация:
  ```ts
  const list = Object.values(jobs).filter((j): j is Job => j !== undefined);
  return html`<div class="queue">${list.map(job => html`<div key=${job.id}>${queueItem(job)}</div>`)}</div>`;
  ```
  Wrapper div нужен для `key`-атрибута — uhtml требует key на element, не на Hole.
- В `main.ts`: `$jobs.listen(() => render(queueEl, queue({ jobs: $jobs.get() })))`.

**Test scenarios:**
- **Happy path empty:** `queue({ jobs: {} })` рендерится в пустой `.queue`
- **Happy path single:** `queue({ jobs: { j1: jobFixture } })` рендерится с одним queueItem'ом
- **Happy path multiple, sorted:** три job'а с разными статусами — все три queueItem'а рендерятся
- **Edge undefined values:** `{ j1: jobFixture, j2: undefined }` — рендерится только j1 (фильтруем `undefined`)
- **Integration keyed update:** изначальный `{ j1, j2, j3 }` → ререндер с `{ j2, j1, j4 }` — j4 новый, j1 и j2 переиспользованы (можно проверить через сравнение DOM-узлов до/после)

**Verification:**
- Тест зелёный
- В живом SPA: paste 3 ссылки → 3 items, retry одной → re-render идёт корректно, remove → item исчезает
- `components/sd-queue.ts` и `components/sd-queue-item.ts` удалены

---

### U7. Folder modal view

**Goal:** view с multi-store dependency ($modal + $folder), input control, escape/enter handlers, validation.

**Requirements:** R2, R4, R5.

**Dependencies:** U1.

**Files:**
- `apps/web/src/views/folder-modal.ts` — CREATE
- `apps/web/src/main.ts` — MODIFY: subscribe на `[$modal, $folder]`
- `apps/web/src/components/sd-folder-modal.ts` — DELETE
- `apps/web/test/folder-modal.test.ts` — REWRITE

**Approach:**
- `folderModal({ mode, folder }: { mode: ModalMode, folder: string | null }): Hole | null`. Если `mode !== "folder"` → `null`.
- Когда open: рендерится `<article class="terminal-card">` с input, Cancel, Save, error div.
- **Inputstate dilemma**: input — это draft до save. В nanotags был ref на input и `input.value = $folder.get()` в effect on $modal change. В uhtml: input — uncontrolled. На каждый re-render setvalue=${folder} установит value (или НЕ переопределит существующий draft если правильно).
  - **Решение**: использовать `.value=${folder ?? ""}` на input. uhtml diff'ит свойства — при первом open value установится; при последующих re-render'ах (если $folder где-то изменится — что маловероятно для draft) value тоже обновится. Это **не идеал** — но текущая логика тоже сбрасывает input.value при `$modal` change, что приемлемо.
  - **Альтернатива (deferred to implementation)**: локальный `$draftFolder` atom, который сетится при open и обновляется через `oninput`. Сложнее, но чище. **Не делать в Phase 1; вернуться если UX поломается**.
- Handlers (Escape, Enter, Cancel, Save) — closures внутри view, читают input через `event.target` или delegate (см. ниже).
- **Escape handling**: в текущей реализации `ctx.on(document, "keydown", ...)` глобальный. В uhtml view глобальный listener неестествен. Решение: при mount'е modal'а добавить global keydown listener в `main.ts` через отдельный `$modal.listen`, и снять при close. **Альтернатива (предпочительнее)**: дать modal'у `tabindex="-1"`, focus при open, и слушать keydown на самом modal'е. **Deferred to implementation** — выбрать после первого прохода.
- Save handler: trim → если пусто, показать error; иначе `await saveFolder(value)` → если ок, `$modal.set("none")`; иначе показать SAVE_ERROR. **Error state** — это локальный atom `$modalError` или прямая мутация DOM? В uhtml-стиле — atom. Создаём `$modalError` в `store.ts` или в самом view-файле? **Deferred to implementation**.

**Test scenarios:**
- **Happy path closed:** `folderModal({ mode: "none", folder: null })` → null (или пустой)
- **Happy path open:** `folderModal({ mode: "folder", folder: "/x" })` → modal с input.value = "/x"
- **Happy path open null folder:** `folderModal({ mode: "folder", folder: null })` → modal с input.value = ""
- **Integration save success:** open, input "/y", click Save → `saveFolder` mock вызван с "/y", после resolve $modal.set("none")
- **Integration save empty:** open, очистить input, click Save → error "Path cannot be empty", `saveFolder` НЕ вызван
- **Integration save error:** open, click Save, mock rejected → error "Failed to save"
- **Integration cancel:** click Cancel → $modal.set("none"), `saveFolder` НЕ вызван
- **Integration Enter key in input:** trigger Enter → save flow
- **Integration Escape**: global Escape closes modal — может тестироваться только если global listener в `main.ts`; иначе пропускаем как execution-time deferred

**Verification:**
- Тест зелёный (некоторые сценарии могут быть deferred — отмечать явно)
- В живом SPA: Change folder → modal открыт; Escape закрывает; Enter сохраняет; ошибка показывается; cancel работает

---

### U8. Cleanup

**Goal:** удалить остатки nanotags и старого подхода. После этого unit'а apps/web — uhtml-only.

**Requirements:** R1, R2, R3, R5, R7.

**Dependencies:** U2, U3, U4, U6, U7 (все views переписаны и подключены).

**Files:**
- `apps/web/src/components/` — DELETE директория полностью
- `apps/web/package.json` — MODIFY: убрать `"nanotags"` из dependencies
- `apps/web/styles.css` — MODIFY: удалить старые тег-селекторы (`sd-queue-item { ... }` и т.д.), оставить только класс-селекторы
- `.claude/skills/idiomatic-nanotags/` — DELETE директория
- `bun.lock` — будет обновлён `bun install` после правки package.json

**Approach:**
- Грeп `apps/web/src/` на `nanotags`, `customElements`, `define(` — должно быть пусто после удаления `components/`
- Грeп `index.html` на `<sd-` — должно быть пусто
- Грeп `styles.css` на тег-селекторы `sd-` — должно быть пусто
- `bun install` после правки `package.json`

**Test scenarios:** Test expectation: none — pure cleanup, behavioral coverage уже в U2-U7.

**Verification:**
- `rg "nanotags" apps/web/` ничего не возвращает кроме `bun.lock` который содержит historical entry (or — pin это в gitignore? Нет, bun.lock коммитим — но после `bun install` entry должен исчезнуть)
- `rg "customElements" apps/web/` пусто
- `rg "<sd-" apps/web/index.html` пусто
- `.claude/skills/idiomatic-nanotags/` не существует
- `bun --cwd apps/web run dev` запускается без ошибок

---

### U9. Final validation

**Goal:** убедиться что вся миграция корректна — lint, format, tests, ручное SPA-тестирование. Закрыть R5, R6.

**Requirements:** R5, R6.

**Dependencies:** U8.

**Files:** нет правок (если только не найдём баг при ручном тестировании, тогда возврат в соответствующий U).

**Approach:**
1. `bun run lint` — чисто
2. `bun run format:check` — чисто
3. `bun run test` — все workspaces зелёные
4. `bun run dev:spa` — engine + Vite. Пройти руками сценарии R6:
   - Paste 1 scribd URL → queue получает item → переходит в Downloading → Downloaded
   - Paste 1 unsupported URL → queue получает item → Failed non-retryable → click Remove → исчезает
   - Симулировать Failed retryable (через `devFixtures.ts`) → click Retry → переходит в Queued → Downloading
   - Click Change folder → modal открыт → ввести путь → Save → folder обновлён
   - Click Change folder → Escape → modal закрылся
   - Остановить engine → Disconnect banner появился → click Reconnect → переподключение

**Test scenarios:** см. approach.

**Verification:** Все 6 сценариев из ручного теста проходят без regression'ов. Все CI команды зелёные.

---

## Scope Boundaries

### In scope

См. Implementation Units U1-U9 выше.

### Deferred to Follow-Up Work

- **Замена project skill `idiomatic-nanotags` на `idiomatic-uhtml-islands`** — отдельный заход после миграции. В U8 skill удаляется, потому что устарел. Новый skill — отдельный PR.
- **Локальный `$draftFolder` atom для input state в folder modal** — текущее решение (`.value=${folder ?? ""}`) рабочее; чище — отдельный atom; пересмотреть если UX поломается.
- **Гранулярная производительность** — measure-on-demand. Если в браузере с 100+ items станет заметно — добавим per-item subscriptions через signal-based view per item.

### Out of scope

- Изменения в `packages/engine`, `apps/tui`, `@scribd-dl/shared`
- Изменения в `apps/web/src/store.ts`, `engineClient.ts`, `devFixtures.ts`
- Новые фичи / изменения поведения SPA
- Visual/CSS changes beyond selector renaming
- Введение Alpine.js, React, Lit, и т.д.

---

## Risks & Dependencies

### R1 — Регрессия поведения без safety net

Тесты переписываются вместе с кодом — старые тесты на момент середины миграции **не работают**. Mitigation: U2-U7 идут в порядке нарастания сложности; после каждого unit'а полноценный SPA-тест в браузере. U9 — финальный проход по всем сценариям.

### R2 — uhtml — новая dep, кривая обучения

API минимальный (`html`, `render`, special attrs), но первый раз. Mitigation: U2 (statusbar) — самый простой view, любые сюрпризы API всплывут на нём; если паттерн оказывается другим — корректируем подход в U2 до начала U3-U7.

### R3 — Input state management в folder modal неочевиден

В nanotags был controlled input через ref. В uhtml uncontrolled с `.value` re-set при render — может вызвать sub-issue (cursor jumping, потеря draft на side re-render). Mitigation: KTD7 в test scenarios покрывает базовый случай; если найдётся проблема — реализовать `$draftFolder` atom (deferred work).

### R4 — Global keydown listener для Escape

Текущая реализация слушает `document.keydown`. В функциональном подходе глобальные listeners неестественны. Mitigation: либо subscribe в `main.ts` на `$modal`, добавлять/убирать listener, либо использовать focus-trap pattern. Решение — implementation-time, не блокирует план.

### R5 — `bun.lock` не очистится автоматически

После удаления `nanotags` из package.json и `bun install` — `bun.lock` может оставить ghost entry. Mitigation: проверить руками в U8; если остался — `rm bun.lock && bun install` (известный workaround).

---

## Open Questions (resolved during execution)

- **Q1** — Точное имя `views/icons.ts` helper'а (`statusIcon(status)`, `iconUse(name)`, или просто экспорт map'ы). Решить в U5.
- **Q2** — `$modalError` живёт в `store.ts` или в самом `folder-modal.ts` файле (как module-level atom). Решить в U7.
- **Q3** — `Hole` тип импортируется из `uhtml` или alias через workspace? `Hole` — internal uhtml type, не всегда экспортирован. Решить в U2.

---

## Success Criteria

См. R1-R7 в Requirements + U9 verification.

Дополнительно:

- Diff в PR читается линейно — каждый unit = атомарный commit, по нарастанию сложности
- Никаких "while we're here" правок в `engineClient.ts`, `store.ts`, тестах не-целевых компонентов
- В описании PR явно сказано: "Supersedes #X (idiomatic nanotags Phase A approach). See `docs/brainstorms/2026-06-11-uhtml-islands-rewrite-requirements.md` for context."

---

## Patterns to Follow

- **uhtml API** — `node_modules/uhtml/` после `bun install`; docs `https://github.com/WebReflection/uhtml`
- **nanostores vanilla API** — `https://github.com/nanostores/nanostores#vanilla-js`
- **Existing idiomatic effects** в `apps/web/src/components/sd-folder-modal.ts` и `sd-header.ts` — образец того какие сценарии должны быть покрыты в views (state transitions, conditional rendering)
- **Existing vitest patterns** в `apps/web/test/queue-item.test.ts` — для shape тест-фикстур, mock'ов engineClient

---

## Sources & Research

- Origin: `docs/brainstorms/2026-06-11-uhtml-islands-rewrite-requirements.md`
- Superseded artefact: `docs/plans/2026-06-11-001-refactor-nanotags-idiomatic-phase-a-plan.md`
- uhtml v4 docs: Context7 `/webreflection/uhtml` — verified `html`, `render`, `@event`, `?attr`, `.prop`, `key`, `unsafe`
- nanostores `listen()` API — already used in `apps/web/src/store.ts`, no migration needed
- Discovery context: hard инвариант nanotags (`withRefs` резолв до `setup`) — `node_modules/nanotags/dist/index.mjs` `connectedCallback`
