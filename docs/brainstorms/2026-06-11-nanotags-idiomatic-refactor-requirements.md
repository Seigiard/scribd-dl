# Idiomatic nanotags refactor for `apps/web`

**Date:** 2026-06-11
**Status:** Requirements draft
**Scope:** Standard (refactor, single workspace)

## Problem

Текущие компоненты `apps/web` используют nanotags императивно — ближе к "vanilla custom elements + helper", чем к idiomatic style из доков:

- Внутренняя разметка через `ctx.host.innerHTML = ...` в `setup()`
- Refs через `ctx.getElement<T>('[data-ref="..."]')` вместо `.withRefs()`
- Атрибуты через `ctx.host.getAttribute("job-id")` вместо `.withProps()`
- Подписки через ручной `listenKeys(...) + ctx.onCleanup(unsubscribe)` вместо `ctx.effect()`
- `sd-queue` сам ведёт `Set<JobId>` и руками создаёт/удаляет узлы вместо `renderList()`

Главная боль: `innerHTML` + refs + ручные обновления через `textContent`/`hidden`/`setAttribute`. Шаблоны не видны и не типизируются.

## Decision

**Двухфазный подход.** Сначала Phase A — привести код к idiomatic nanotags без введения новых зависимостей. После Phase A — гейт: оценить читабельность на живом коде. Если `innerHTML` всё ещё раздражает — отдельный заход Phase B (uhtml для шаблонов) с собственным requirements.

Этот документ описывает **только Phase A**.

### Почему не Alpine.js

Рассматривали как третий вариант. Отвергли:
- Ломает "TypeScript everywhere" из проектного `CLAUDE.md` — выражения в `x-text`/`@click` не типизируются
- ~17KB gzip vs ~2KB у nanotags (8x)
- Свежая миграция React → nanotags (`9c5627e`) — вторая миграция UI-стека подряд создаёт впечатление нестабильности выбора
- HTML-first подход не выигрывает в проекте, где `index.html` это `<div id="app">`, а UI собирается из TS

### Почему не uhtml сразу

uhtml даёт декларативный templating, но:
- Тратить решение на новую зависимость до того, как стало больно после идиоматичного nanotags — преждевременно
- Phase A сам по себе уменьшает боль (refs/effects/renderList)
- После Phase A решение по B принимается на основе живого кода, а не предположений

## Scope (Phase A)

### In scope

Привести все компоненты в `apps/web/src/components/` к idiomatic nanotags:

1. **`.withRefs()`** — заменить все `ctx.getElement<T>('[data-ref="..."]')` на декларацию refs через `.withRefs((r) => ({ ... }))`. Доступ через `ctx.refs.<name>`.

2. **`.withProps()`** — заменить `ctx.host.getAttribute("...")` на `.withProps((p) => ({ ... }))`. Применимо как минимум к `job-id` в `sd-queue-item`.

3. **`ctx.effect()`** — заменить ручные `listenKeys(store, keys, cb) + ctx.onCleanup(unsubscribe)` на `ctx.effect(store, cb)`. Где нужна реакция на под-срез — derived store через `computed` из nanostores.

4. **`renderList()`** — `sd-queue` переписать через `renderList(container, template, { data, key, update })`. Убрать ручной `Set<JobId>` и явные create/remove.

### Out of scope

- **uhtml, lit-html, любой declarative templating** — отложено в Phase B
- **Alpine.js, любая смена UI-фреймворка** — отвергнуто (см. Decision)
- **Изменения в `@scribd-dl/shared`** — wire-контракт не меняется
- **Изменения в `engine`, `tui`, `nanostores`** — за пределами `apps/web`
- **Изменения в CSS / `terminal.css`** — визуально не должно ничего меняться
- **Новые фичи, рефакторинг engineClient или store.ts** — только компоненты

## Affected files

Все в `apps/web/src/components/`:
- `sd-app.ts`
- `sd-disconnect-banner.ts`
- `sd-folder-modal.ts`
- `sd-header.ts`
- `sd-queue.ts` — главный кандидат на `renderList`
- `sd-queue-item.ts` — главный кандидат на `withRefs` + `withProps` + `ctx.effect`
- `sd-statusbar.ts`

`apps/web/src/store.ts` — возможно появится derived store `$job(jobId)` или helper, если он окажется естественным способом подписаться на одну запись из `$jobs` через `ctx.effect`.

## Success criteria

Phase A считается завершённой, когда **все** пункты выполнены:

1. В компонентах `apps/web/src/components/` нет ни одного вызова `ctx.getElement(...)` — все статические refs декларированы через `.withRefs()`.
2. В компонентах нет ни одного `ctx.host.getAttribute(...)` для атрибутов, которые есть смысл оформить как prop (минимум `job-id`).
3. В компонентах нет ручных `listenKeys(...) + ctx.onCleanup(unsubscribe)` для подписок на nanostores — все через `ctx.effect()`.
4. `sd-queue` не держит `Set<JobId>` и не создаёт/удаляет узлы вручную — список рендерится через `renderList`.
5. `bun run lint`, `bun run format:check`, `bun run test` — все зелёные.
6. Поведение SPA не изменилось: визуально ничего не сдвинулось, queue/retry/remove/folder modal/disconnect banner работают как раньше.
7. Принято и записано решение по Phase B — на основе ревью живого кода после Phase A, а не догадок.

## Gate decision (between Phase A and B)

После выполнения Phase A — короткое ревью:

**Вопрос:** остался ли `ctx.host.innerHTML = ...` (или эквивалент) заметным раздражителем после того, как refs/props/effects/renderList уже идиоматичны?

**Если нет** — стоп. Phase B не делаем. Этот документ закрыт.

**Если да** — отдельный requirements (`docs/brainstorms/YYYY-MM-DD-uhtml-templates-requirements.md`) с конкретными примерами компонентов "до/после" и оценкой стоимости новой зависимости. Phase B не стартует без него.

## Open questions

- В `sd-queue-item` есть SVG refs (`statusUse`, `actionUse`) с явными селекторами. `.withRefs()` поддерживает кастомные селекторы — проверить API при имплементации, явных проблем не ожидается.
- Нужен ли derived store `$job(jobId)` (через `computed`/`atom`-фабрику) или достаточно `ctx.effect($jobs, (jobs) => render(jobs[id]))`. Решается при работе над `sd-queue-item`.

## Non-goals / explicit deferrals

- Покрытие компонентов unit-тестами — отдельная инициатива
- Storybook / визуальный регресс — out of scope для self-use SPA
- Доступность (a11y) ревью — отдельный заход

## Handoff

Следующий шаг — `/ce-plan` для Phase A с этим документом как входом. План должен пройтись по 7 компонентам и `sd-queue` отдельно, потому что `renderList` — самое нестандартное изменение.
