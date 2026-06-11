---
title: "refactor: Idiomatic nanotags for apps/web (Phase A)"
status: active
created: 2026-06-11
origin: docs/brainstorms/2026-06-11-nanotags-idiomatic-refactor-requirements.md
type: refactor
depth: standard
---

# refactor: Idiomatic nanotags for `apps/web` (Phase A)

## Summary

Привести 7 компонентов в `apps/web/src/components/` к идиоматичному стилю nanotags v0.15.2 без введения новых зависимостей. Заменить ручные `ctx.getElement(...)` на `.withRefs()`, `ctx.host.getAttribute(...)` на `.withProps()`, `listenKeys + ctx.onCleanup` на `ctx.effect()`, и ручной diff `Set<JobId>` в `sd-queue` на `renderList()`. Существующие vitest-тесты — safety net; их API мы не меняем. Phase B (uhtml templates) остаётся explicit gate после ревью живого кода, в этом плане не реализуется.

---

## Problem Frame

См. origin: `docs/brainstorms/2026-06-11-nanotags-idiomatic-refactor-requirements.md`.

Кратко: текущий `apps/web` использует nanotags императивно — `ctx.host.innerHTML = ...`, селекторные refs, ручные подписки. Это работает, но скрывает API библиотеки, теряет статическую типизацию refs/props и заставляет `sd-queue` руками вести diff списка.

---

## Requirements (from origin)

- **R1** — Ни одного `ctx.getElement(...)` в компонентах `apps/web/src/components/`
- **R2** — Ни одного `ctx.host.getAttribute(...)` для атрибутов, имеющих смысл как prop (минимум `job-id`)
- **R3** — Ни одного `listenKeys(...) + ctx.onCleanup(unsubscribe)` для подписок на nanostores
- **R4** — `sd-queue` не держит `Set<JobId>` и не создаёт/удаляет узлы вручную; список через `renderList()`
- **R5** — `bun run lint`, `bun run format:check`, `bun run test` зелёные
- **R6** — Визуально и поведенчески SPA не меняется (queue / retry / remove / folder modal / disconnect banner)
- **R7** — Принято и записано решение по Phase B на основе живого кода

---

## Key Technical Decisions

### KTD1. `renderList` template — как ref внутри `<sd-queue>`

`renderList` API (`packages: nanotags/render`) требует `HTMLTemplateElement` как второй аргумент. Согласовано с проектным skill `idiomatic-nanotags` (cookbook pattern): template живёт **внутри `<sd-queue>` как ref** — `.withRefs((r) => ({ itemTpl: r.one<HTMLTemplateElement>(), list: r.one<HTMLDivElement>() }))`. Markup `<sd-queue>` содержит `<template data-ref="item-tpl"><sd-queue-item></sd-queue-item></template>` и контейнер для списка `<div data-ref="list"></div>`. Преимущества:

- Template живёт со своим consumer'ом, нет global ID в `index.html`
- Vitest-тесты работают автоматически (`document.body.innerHTML = "<sd-queue>..."` — template приходит с markup'ом)
- `renderList` берёт `ctx.refs.list` как контейнер, а не `ctx.host` — изоляция от `<template>`-узла

Markup для `<sd-queue>` создаётся через `ctx.host.innerHTML = ...` в `setup()` — это explicit boundary до Phase B. Для других компонентов внутренний `innerHTML` тоже остаётся.

### KTD2. Подписка на одну запись из `$jobs` — простой `ctx.effect`, без derived store

В `sd-queue-item` использовать `ctx.effect($jobs, (jobs) => render(jobs[id]))`. Альтернатива — фабрика `$jobById(id)` через `computed` из nanostores — была отвергнута. Reasoning: `effect` дёргается на любой апдейт любого job, но `render` дешёвый (textContent / setAttribute), а сам SPA self-use с ~10 items. Преждевременная оптимизация. Решение можно пересмотреть, если Phase B потянет за собой более тонкое управление.

### KTD3. `job-id` через `.withProps()` как string-атрибут

`sd-queue` сетит `job-id` через `setAttribute`, не property. `.withProps((p) => ({ jobId: p.string() }))` читает атрибут и даёт типизированный `ctx.props.$jobId` (atom). В `sd-queue-item` подписку строим через `ctx.effect([$jobs, ctx.props.$jobId], (jobs, id) => render(jobs[id as JobId]))` — массив-форма `effect`, оба сигнала reactive. Это снимает необходимость захватывать `id` в замыкание и автоматически реагирует на смену атрибута (хотя `sd-queue` атрибут не меняет — это инвариант, не требование плана).

### KTD4. SVG refs через кастомный селектор в `.withRefs()`

`sd-queue-item` имеет `statusUse` и `actionUse` как `SVGUseElement`. По типам nanotags `r.one<T>(selector?)` принимает опциональный селектор. Используем `r.one<SVGUseElement>('[data-ref="status-use"]')` для явности — селектор остаётся data-ref, чтобы не плодить новые conventions внутри одного refactor.

### KTD5. `ctx.bind()` для form inputs рассмотрен и отвергнут

Skill `idiomatic-nanotags` rule 6 рекомендует `ctx.bind($atom, ctx.refs.input)` для прямого байндинга input ↔ atom. В `sd-folder-modal` это **не применимо**: input хранит draft значение до явного `save`, не synced с `$folder` напрямую. Текущая ручная установка `input.value = $folder.get()` в эффекте `$modal` — правильное поведение. `ctx.bind` не добавлять в Phase A; пересмотреть только если появится поле с прямым live-байндингом.

### KTD6. Vitest-тесты не трогаем

Все 7 тестов в `apps/web/test/` опираются на DOM-структуру и публичное поведение (`document.body.innerHTML = ...`, `$jobs.setKey(...)`, `querySelector`, `click`). Они должны остаться зелёными как safety net. Если тест ломается — баг в рефакторинге, а не в тесте.

---

## Setup() convention

Согласовано со skill `idiomatic-nanotags`, все `setup()` после рефакторинга следуют порядку:

1. Constants / computed stores
2. Named methods (`render`, `close`, `trySave`, …)
3. `ctx.on(...)` для всех event listeners
4. `ctx.effect(...)` для всех store-driven DOM updates

Initial render внутри effect — не отдельным вызовом до подписки; `ctx.effect` сам вызывает callback с текущим значением при подписке.

## High-Level Technical Design

Маппинг "до → после" по сущностям:

| Текущее | Идиоматичное | Где применяется |
|---|---|---|
| `ctx.getElement<T>('[data-ref="x"]')` | `.withRefs((r) => ({ x: r.one<T>() }))` → `ctx.refs.x` | все 6 компонентов с refs |
| `ctx.host.querySelector('[data-ref="x"]') as T` | `.withRefs((r) => ({ x: r.one<T>('[data-ref="x"]') }))` | SVG `<use>` в `sd-queue-item` |
| `ctx.host.getAttribute("job-id")` | `.withProps((p) => ({ jobId: p.string() }))` → `ctx.props.$jobId` | `sd-queue-item` |
| `listenKeys($jobs, [id], cb) + ctx.onCleanup(unsub)` | `ctx.effect([$jobs, $jobId], cb)` | `sd-queue-item` |
| ручной `Set<JobId>` + create/remove узлов | `renderList(host, template, { data, key, update })` | `sd-queue` |

Поток данных в `sd-queue` после рефакторинга:

```text
$jobs ──ctx.effect──► renderList(host, #sd-queue-item-tpl, {
                        data: Object.keys(jobs).filter(...),
                        key: id => id,
                        update: (el, id) => el.setAttribute("job-id", id),
                      })
                      │
                      ▼
              <sd-queue-item job-id="..."> создаётся/удаляется/переиспользуется библиотекой
                      │
                      ▼
              ctx.props.$jobId atom реагирует на смену job-id
                      │
                      ▼
              ctx.effect([$jobs, $jobId], ...) перерендерит item
```

---

## Output Structure

Все изменения в существующих файлах, новых директорий нет. Затрагиваемые пути:

```text
apps/web/
  index.html                         # +1 <template id="sd-queue-item-tpl">
  src/components/
    sd-app.ts                        # без изменений (заглушка)
    sd-disconnect-banner.ts          # withRefs
    sd-folder-modal.ts               # withRefs (effect уже идиоматичный)
    sd-header.ts                     # withRefs (effect уже идиоматичный)
    sd-queue.ts                      # renderList вместо ручного Set
    sd-queue-item.ts                 # withRefs + withProps + effect-array
    sd-statusbar.ts                  # без изменений (нет refs, effect идиоматичный)
  test/                              # БЕЗ ИЗМЕНЕНИЙ (safety net)
```

---

## Implementation Units

### U1. `sd-disconnect-banner` — refs через `.withRefs()`

**Goal:** самый простой компонент, разминка на паттерн `.withRefs()`.

**Requirements:** R1, R5, R6.

**Dependencies:** none.

**Files:** `apps/web/src/components/sd-disconnect-banner.ts`.

**Approach:**
- Заменить `ctx.getElement<HTMLButtonElement>('[data-ref="reconnect"]')` на `.withRefs((r) => ({ reconnect: r.one<HTMLButtonElement>() }))`.
- `innerHTML` остаётся (Phase A не трогает шаблоны).
- `ctx.effect($connected, ...)` уже идиоматичный.

**Patterns to follow:** API из `node_modules/nanotags/dist/index.d.mts` — `ComponentBuilder.withRefs(factory)`. Дефолтный селектор для `r.one()` — `[data-ref="<key>"]`.

**Test scenarios:**
- `apps/web/test/disconnect.test.ts` остаётся зелёным как есть. Не модифицируется.

**Verification:** `bun --cwd apps/web test test/disconnect.test.ts` зелёный; визуально баннер появляется при дисконнекте, кнопка Reconnect работает.

---

### U2. `sd-header` — refs через `.withRefs()`

**Goal:** второй простой компонент с двумя refs.

**Requirements:** R1, R5, R6.

**Dependencies:** U1 (закрепить паттерн).

**Files:** `apps/web/src/components/sd-header.ts`.

**Approach:**
- `.withRefs((r) => ({ display: r.one<HTMLSpanElement>(), change: r.one<HTMLButtonElement>() }))`.
- `ctx.effect($folder, ...)` уже идиоматичный.
- `ctx.on(ctx.refs.change, "click", ...)`.

**Test scenarios:**
- Existing tests (если есть для header — проверить); smoke.test.ts покрывает рендеринг.

**Verification:** `bun --cwd apps/web test` зелёный; кнопка Change открывает `$modal=folder`.

---

### U3. `sd-folder-modal` — refs через `.withRefs()`

**Goal:** компонент с 4 refs (input/error/cancel/save) и сложной логикой; шаблон через `.withRefs()` упрощает чтение `setup()`.

**Requirements:** R1, R5, R6.

**Dependencies:** U1.

**Files:** `apps/web/src/components/sd-folder-modal.ts`.

**Approach:**
- `.withRefs((r) => ({ input: r.one<HTMLInputElement>(), error: r.one<HTMLDivElement>(), cancel: r.one<HTMLButtonElement>(), save: r.one<HTMLButtonElement>() }))`.
- `innerHTML` остаётся.
- `ctx.effect($modal, ...)` уже идиоматичный.
- Обработчики `ctx.on(...)` переключаются на `ctx.refs.*`.

**Test scenarios:**
- `apps/web/test/folder-modal.test.ts` остаётся зелёным. Покрывает Escape, Enter, click Save с пустым input, успешный save.

**Verification:** все тесты folder-modal зелёные; визуально модалка открывается/закрывается, ошибка показывается при пустом инпуте.

---

### U4. `sd-queue-item` — `.withRefs()` + `.withProps()` + `ctx.effect`-array

**Goal:** центральный компонент рефакторинга. Все три идиоматичных API сразу.

**Requirements:** R1, R2, R3, R5, R6.

**Dependencies:** U1, U3 (паттерны refs/props должны быть закреплены).

**Files:** `apps/web/src/components/sd-queue-item.ts`, `apps/web/test/queue-item.test.ts` (только если ломается — модификация под номер задачи U7).

**Approach:**
- `.withProps((p) => ({ jobId: p.string() }))` — `ctx.props.$jobId` atom со значением атрибута `job-id`.
- `.withRefs((r) => ({ title: r.one<HTMLSpanElement>(), url: r.one<HTMLDivElement>(), action: r.one<HTMLButtonElement>(), progress: r.one<HTMLDivElement>(), reason: r.one<HTMLDivElement>(), statusUse: r.one<SVGUseElement>('[data-ref="status-use"]'), actionUse: r.one<SVGUseElement>('[data-ref="action-use"]') }))`.
- `innerHTML` остаётся (Phase A).
- Подписка: `ctx.effect([$jobs, ctx.props.$jobId], (jobs, id) => render(jobs[id as JobId]))`. Это заменяет ручной `listenKeys + onCleanup`.
- Обработчик click: `ctx.on(ctx.host, "click", ...)` использует `ctx.props.$jobId.get()` для current id.
- Локальная функция `render(job)` использует `ctx.refs.*` вместо локальных переменных-кешей.
- Особый случай: `render(undefined) → ctx.host.remove()` — после `renderList` в U5 это поведение перестанет быть нужным (renderList сам удаляет узел), но в Phase A оставляем как есть, чтобы U4 был коммитом-самим-по-себе.

**Test scenarios** (existing `apps/web/test/queue-item.test.ts`):
- Все существующие тесты остаются зелёными:
  - Mount + initial render: title, url, status icon, action button hidden/shown
  - Status transition Queued → Downloading: progress показан с `done/total/stage`
  - Status Failed retryable: action иконка retry, click → `retryJobByIdMock`
  - Status Failed non-retryable: action иконка delete, click → `removeJobByIdMock`
  - Status Queued: action иконка delete
  - Job removed (`$jobs.setKey(id, undefined)`): элемент удаляется из DOM

**Verification:** `bun --cwd apps/web test test/queue-item.test.ts` зелёный без изменений тестов; визуально статусы и кнопки работают как раньше.

---

### U5. `sd-queue` — `renderList()` вместо ручного `Set`

**Goal:** заменить ручной diff на nanotags/render API. Самое нестандартное изменение в плане.

**Requirements:** R4, R5, R6.

**Dependencies:** U4 (item должен корректно работать как managed-узел перед тем, как мы доверим его renderList).

**Files:** `apps/web/src/components/sd-queue.ts` (markup + logic). `index.html` **не трогаем** (template живёт внутри `<sd-queue>`).

**Approach:**

1. В `sd-queue.ts` markup через `innerHTML` в `setup()`:
   ```ts
   ctx.host.innerHTML = `
     <template data-ref="item-tpl"><sd-queue-item></sd-queue-item></template>
     <div data-ref="list"></div>
   `;
   ```
   Это контейнер для списка + template для item'а, оба доступны через `.withRefs()`.

2. `.withRefs((r) => ({ itemTpl: r.one<HTMLTemplateElement>(), list: r.one<HTMLDivElement>() }))`.

3. Импорт: `import { renderList } from "nanotags/render";`

4. В `ctx.effect($jobs, (jobs) => { ... })`:
   ```ts
   const ids = (Object.keys(jobs) as JobId[]).filter((id) => jobs[id] !== undefined);
   renderList<JobId, HTMLElement>(ctx.refs.list, ctx.refs.itemTpl, {
     data: ids,
     key: (id) => id,
     update: (el, id) => { if (el.getAttribute("job-id") !== id) el.setAttribute("job-id", id); },
   });
   ```
   `renderList` владеет содержимым `ctx.refs.list`, а не `ctx.host` — это важно, иначе `<template>` тоже попадёт под управление `renderList`.

5. Убрать `present: Set<JobId>`, ручные create/remove, `CSS.escape` query.

6. После этого изменения `sd-queue-item`'s `if (!job) ctx.host.remove()` становится избыточным (renderList сам удаляет узел), но оставляем как defensive — удаление в отдельном follow-up если захочется.

**Patterns to follow:** `node_modules/nanotags/dist/render.d.mts` — `renderList<T, E>(container, template, { data, key, update })`.

**Test scenarios** (existing `apps/web/test/queue.test.ts`):
- Все существующие тесты остаются зелёными:
  - Mount: пустой queue без items
  - Add job: появляется `<sd-queue-item job-id="...">`
  - Remove job (`$jobs.setKey(id, undefined)`): item удаляется
  - Multiple jobs: порядок и количество соответствуют `$jobs`
- **Дополнить** если существующие тесты не покрывают: смена `job-id` атрибута на существующем узле не должна терять состояние компонента (renderList переиспользует узлы по `key`).

**Verification:** `bun --cwd apps/web test test/queue.test.ts` зелёный; визуально add/remove jobs работает; в DevTools видно, что узлы переиспользуются (а не пересоздаются) при изменении значений в `$jobs` без смены id.

---

### U6. Финальная проверка `sd-statusbar` и `sd-app`

**Goal:** убедиться, что эти два компонента уже идиоматичны и не требуют изменений; формально закрыть R1-R3 для них.

**Requirements:** R1, R2, R3, R5.

**Dependencies:** none.

**Files:** `apps/web/src/components/sd-statusbar.ts`, `apps/web/src/components/sd-app.ts`.

**Approach:**
- `sd-statusbar`: refs нет, props нет, `ctx.effect($transient, ...)` уже идиоматичный. Никаких изменений.
- `sd-app`: пустой `setup()`. Никаких изменений.
- Этот unit существует для documentation completeness — чтобы любой следующий читатель плана видел, что все 7 компонентов учтены.

**Test scenarios:** existing `statusbar.test.ts` и `smoke.test.ts` зелёные без изменений.

**Verification:** `bun --cwd apps/web test` зелёный полностью.

---

### U7. Финальная валидация + Phase B gate decision

**Goal:** закрыть R5, R7 и принять решение по Phase B.

**Requirements:** R5, R7.

**Dependencies:** U1-U6.

**Files:** нет правок кода; результат — apend в этот план или новый файл `docs/brainstorms/...-phase-b-decision.md` если решено идти в B.

**Approach:**

1. Запустить полный набор проверок:
   - `bun run lint` — чисто
   - `bun run format:check` — чисто
   - `bun run test` — все workspaces зелёные
2. Запустить SPA локально (`bun run dev:spa`), пройти основные сценарии вручную:
   - Paste ссылок → queue добавляется
   - Скачивание идёт → progress апдейтится
   - Failed retryable → retry работает
   - Failed non-retryable → remove работает
   - Folder modal → save folder работает
   - Disconnect banner → появляется при остановке engine
3. **Phase B gate** — ревью `sd-queue-item.ts` и `sd-folder-modal.ts` после рефакторинга. Вопрос: `ctx.host.innerHTML = ...` всё ещё ощутимо раздражает?
   - **Нет** → дописать в этот план секцию "Phase B decision: не реализуется" с одной фразой почему. Закрыть плановый трек.
   - **Да** → создать `docs/brainstorms/YYYY-MM-DD-uhtml-templates-requirements.md` с конкретными примерами "до/после" и оценкой стоимости uhtml. Не стартовать Phase B без него.

**Test scenarios:** см. approach.

**Verification:** все команды из шага 1 зелёные; ручная проверка пройдена; gate decision записан.

---

## Scope Boundaries

### In scope (Phase A)

См. Implementation Units U1-U7 выше.

### Deferred to Follow-Up Work

- **Phase B (uhtml templates)** — отдельный requirements doc + план, гейт описан в U7.
- **Удаление `if (!job) ctx.host.remove()` из `sd-queue-item`** после U5 (избыточно с renderList) — defensive cleanup, не блокирует.
- **Производительность через derived store `$jobById(id)`** — пересмотреть только если Phase B потянет за собой более тонкое управление подписками.

### Out of scope

- Любые изменения в `@scribd-dl/shared` — wire contract не меняется.
- Любые изменения в `packages/engine`, `apps/tui`.
- Любые изменения в `apps/web/src/store.ts`, `engineClient.ts`, `devFixtures.ts`.
- Любые CSS/`terminal.css` правки.
- Новые фичи, изменения поведения.
- Введение Alpine.js или другого UI-фреймворка (отвергнуто на брейншторме).
- Шаблонизация через uhtml в Phase A.

---

## Risks & Dependencies

### R1 — `renderList` ломает идентичность узлов при смене `job-id`

`renderList` использует `key` для переиспользования узлов. Если key совпадает — узел переиспользуется, update вызывается. Риск: `sd-queue-item`'s `ctx.props.$jobId` atom может не среагировать на `setAttribute("job-id", newId)`, если nanotags подписывается на attribute change через `MutationObserver` лениво. **Mitigation:** в U5 включён проверочный сценарий "смена job-id на существующем узле"; если поведение неожиданное — fallback на recreate (передать `key: (id, idx) => \`${id}:${idx}\`` или просто `(id) => id` с гарантией стабильности id'ов из $jobs — что и так выполняется).

### R2 — ~~`<template>` в `index.html`~~ устранён архитектурно

После KTD1-апдейта template живёт внутри `<sd-queue>` как ref. Vitest-тесты получают template автоматически вместе с `document.body.innerHTML = "<sd-queue></sd-queue>"`. Риск снят.

### R3 — `ctx.props.$jobId` имя ключа

API: `.withProps((p) => ({ jobId: p.string() }))` — kebab-case атрибут `job-id` маппится в camelCase `jobId`. Это конвенция nanotags. Проверить в `node_modules/nanotags/dist/index.d.mts` `propBuilders` поведение при первой имплементации; если поведение другое — использовать `.string({ attribute: "job-id" })` или эквивалент.

---

## Open Questions

- **Q1** — `r.one<T>()` без селектора берёт `[data-ref="<key>"]` или другой дефолт? Проверить при U1 чтением `node_modules/nanotags/dist/types-BplJSBOW.d.mts`. Если дефолт другой — явно передавать селектор.
- **Q2** — Поведение `renderList` при первом вызове, когда `ctx.host` уже содержит дочерние элементы. Скорее всего — replace, но проверить на U5.

---

## Success Criteria

См. R1-R7 в Requirements. Дополнительно:

- Diff в PR читается линейно — каждый коммит соответствует одному unit'у U1-U6.
- Никаких "while we're here" правок в `store.ts`, `engineClient.ts`, тестах.
- В описании PR явно сказано: "Phase A. Phase B gate — см. U7 в плане".

---

## Patterns to Follow

- API surface — `node_modules/nanotags/dist/index.d.mts` и `node_modules/nanotags/dist/render.d.mts`.
- Доки — `https://nanotags.psdcoder.dev/` (cookbook, api).
- Существующий идиоматичный `ctx.effect` в `sd-folder-modal.ts:53` и `sd-header.ts:15` — образец того, как должны выглядеть подписки в остальных компонентах.

---

## Sources & Research

- Origin: `docs/brainstorms/2026-06-11-nanotags-idiomatic-refactor-requirements.md`
- `node_modules/nanotags/package.json` — v0.15.2
- `node_modules/nanotags/dist/index.d.mts` — `withRefs`, `withProps`, `effect` signatures verified
- `node_modules/nanotags/dist/render.d.mts` — `renderList<T, E>(container, template: HTMLTemplateElement, options)` verified
- `apps/web/index.html` — текущая разметка SPA
- `apps/web/src/components/*.ts` — текущая реализация всех 7 компонентов
- `apps/web/test/*.test.ts` — safety net
