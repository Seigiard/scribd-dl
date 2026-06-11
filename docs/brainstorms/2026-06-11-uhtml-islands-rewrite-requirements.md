# apps/web rewrite to uhtml + islands

**Date:** 2026-06-11
**Status:** Requirements draft
**Scope:** Standard (architectural rewrite of one workspace)
**Supersedes:** `docs/brainstorms/2026-06-11-nanotags-idiomatic-refactor-requirements.md`

## Problem

Текущий `apps/web` использует nanotags + Custom Elements для оживления статичной разметки. Главная боль — markup собирается через `ctx.host.innerHTML = ...` в `setup()`, refs через ручные `ctx.getElement(...)`, DOM-апдейты руками через `textContent`/`hidden`/`setAttribute`. Шаблоны не декларативны и не типизируются.

Первая попытка ("idiomatic nanotags Phase A", см. superseded brainstorm) разбилась о hard инвариант nanotags: `withRefs` резолвится в `connectedCallback()` **до** `setup()`. Это значит markup обязан существовать когда компонент подключается. "innerHTML в setup() + withRefs" — технически невозможно. Idiomatic nanotags = hydration-first, markup в HTML. Если markup всё равно живёт в TS — nanotags даёт трение без пользы.

## Decision

**Полностью переписать `apps/web` на uhtml + vanilla nanostores по паттерну islands.** Убрать nanotags и Custom Elements целиком. Layout остаётся в `index.html` как пустые mount-контейнеры; контент рендерится через uhtml в каждый mount-point из функций, которые возвращают `html\`...\`` template. Реактивность — per-island подписки на nanostores.

### Почему islands, а не один global render

- `$jobs` меняется часто (download progress). Глобальный re-render дёргает modal/header/banner на каждый tick — uhtml diff'ит, но это лишняя работа.
- Islands дают естественное разделение зависимостей: каждый mount-point подписан только на свои сторы.
- Тесты становятся функциями от данных: `render(div, queue(jobs))` без mock'ов глобального state.
- `index.html` остаётся читаемым layout-документом, а не пустой `<body>`.

### Почему без Custom Elements

CE в текущем коде давали три удобства: auto-mount через HTML-теги, CSS-селекторы по тегу, lifecycle hooks. Все три становятся ненужными без nanotags:
- Auto-mount → один раз вызвать `render(mountEl, view())` в `main.ts`.
- CSS — селекторы по классу (`.queue-item` вместо `sd-queue-item`).
- Lifecycle — его больше нет, uhtml сам diff'ит при пере-рендере.

CE без nanotags = пустой ритуал.

### Почему не uhtml + nanotags гибрид

Этот гибрид (вариант B первого брейншторма) предполагал nanotags как "lifecycle helper". Узнали: nanotags lifecycle намертво связан с hydration-first резолвом refs. Если markup в TS — обёртка вокруг CE даёт инвариант hydration-first и ничего за это не получаем.

### Почему не Alpine.js

Отвергнут в первом брейншторме. Причины те же: ломает "TypeScript everywhere" (выражения в `x-text`/`@click` строки), ~17KB gzip vs ~3KB у uhtml, HTML-attr логика плохо ляжет на этот проект.

## Scope

### In scope

1. **Переписать все компоненты `apps/web/src/components/`** как функции-views в новой структуре (`apps/web/src/views/` или эквивалент — решит план).
2. **`main.ts`** — найти mount-контейнеры в `index.html` и подписать каждый на свои сторы.
3. **`index.html`** — содержит layout с пустыми mount-контейнерами:
   - `.mount-header` внутри `.terminal-header`
   - `.mount-content` для queue + disconnect banner
   - `.mount-footer` для statusbar (с подписью на `$transient`)
   - `.mount-modal` для folder modal
4. **`styles.css`** — заменить селекторы по тегу (`sd-queue-item`, `sd-header`, …) на классы (`.queue-item`, `.header`, …).
5. **Удалить `nanotags`** из `apps/web/package.json` и `bun.lock`.
6. **Переписать vitest-тесты** под функциональный рендер: `render(container, view(props))`. Старые тесты `document.body.innerHTML = "<sd-x></sd-x>"` уходят.
7. **`store.ts` не трогаем** — API уже vanilla nanostores, ничего менять не нужно.

### Reactivity contract (islands)

Каждый mount-point подписан на минимально необходимый набор сторов:

| Mount point | Подписан на | View функция |
|---|---|---|
| `.mount-header` | `$folder` | `header({ folder })` |
| `.mount-content` | `$jobs`, `$connected` | один render с queue + banner, **или** два соседних mount-point'а |
| `.mount-footer` | `$transient` | `statusbar({ transient })` |
| `.mount-modal` | `$modal`, `$folder` | `folderModal({ mode, folder })` |

Внутри `.mount-content` — открытый вопрос (см. Open questions): один или два mount-point.

### Out of scope

- Изменения в `packages/engine`, `apps/tui`, `@scribd-dl/shared`
- Изменения в `apps/web/src/store.ts`, `engineClient.ts`, `devFixtures.ts`
- Новые фичи / изменения поведения SPA
- Visual/CSS changes за пределами замены селекторов
- Интродьюс новых фич dependency (Alpine, React, Lit, и т.д.)
- Производительность beyond islands — измеряем по факту, не оптимизируем превентивно
- Переписывание проектного skill `idiomatic-nanotags` под uhtml — отдельный заход после миграции

## Success criteria

1. **`nanotags` удалён** из всех package.json в `apps/web` и не появляется в `bun.lock`.
2. **Ни одного `customElements.define`** в `apps/web/src/`.
3. **`index.html` `<body>`** содержит layout-структуру с пустыми mount-контейнерами; нет `<sd-*>` тегов.
4. **Каждый mount-point подписан** только на минимально необходимые сторы (см. таблицу выше).
5. **`bun run lint`, `bun run format:check`, `bun run test`** — зелёные.
6. **Поведение SPA** не изменилось при ручном тестировании: paste → queue → download → folder modal → disconnect banner.
7. **Старый brainstorm и plan** помечены `status: superseded` со ссылкой на этот документ. Старая ветка `refactor/nanotags-idiomatic-phase-a` брошена без merge.

## Affected files (high-level)

- `apps/web/index.html` — layout с mount-контейнерами
- `apps/web/src/main.ts` — bootstrap + per-island подписки
- `apps/web/src/components/sd-*.ts` — **удаляются**
- `apps/web/src/views/*.ts` (или эквивалент) — **новые**, функции-views
- `apps/web/src/styles.css` — селекторы по классу вместо тега
- `apps/web/test/*.test.ts` — переписаны под `render(container, view(props))`
- `apps/web/package.json` — `nanotags` удалён, `uhtml` добавлен

Финальную структуру каталогов и имена решит план — это не product-decision.

## Open questions

- **`.mount-content` — один или два mount-point** для queue + disconnect banner? Один проще (subscribe на оба стора, render обоих в один контейнер); два — чище разделение. Решить при имплементации.
- **CSS prefix для классов** — `.queue-item` или `.sd-queue-item` (сохранить `sd-` как namespace для project-specific классов)? Косметика, решить при имплементации.
- **Где живёт каждая view-функция** — один файл на view, по файлу на сторовую группу, всё в одном файле? Зависит от объёма после переписывания. Решить при имплементации.

## Risks

- **R1 — ручное тестирование как safety net.** Тесты переписываются вместе с кодом, значит до завершения миграции у нас нет работающего теста-net'а. Mitigation: после каждой view-функции запускать SPA локально (`bun run dev:spa`) и проверять её сценарий. Финальное приёмочное тестирование по чек-листу из Success criteria #6.
- **R2 — uhtml для нас новая dep.** Документация меньше чем у Lit, но API минимальный (`html`, `render`, что почти всё). Mitigation: первая view-функция (любая короткая, e.g. statusbar) — proof-of-concept в плане; если паттерн не лёг, корректируем подход до писания остальных.
- **R3 — проектный skill `idiomatic-nanotags` устаревает.** После миграции его триггер ("editing apps/web components that use nanotags") не сработает, но содержимое потенциально вводит в заблуждение, если кто-то/что-то его прочитает. Mitigation: удалить skill в том же PR где удаляется nanotags. Перезапись под uhtml — отдельный заход.

## Migration strategy

**Big-bang в одном PR из новой ветки от main.** Причины:
- Scope маленький (~7 файлов компонентов, тесты, styles)
- Incremental через адаптер привёл бы к гибриду nanotags+uhtml, который мы уже отвергли как лишнюю прослойку
- Branch с docs-коммитом уже есть, но architecturally это другой подход — честнее новая ветка от main

## Sources & Context

- Superseded: `docs/brainstorms/2026-06-11-nanotags-idiomatic-refactor-requirements.md`
- Superseded plan: `docs/plans/2026-06-11-001-refactor-nanotags-idiomatic-phase-a-plan.md`
- Discovery: hard инвариант nanotags `withRefs` (резолв в `connectedCallback` до `setup`) — `node_modules/nanotags/dist/index.mjs` lines around `connectedCallback`
- uhtml: https://github.com/WebReflection/uhtml
- nanostores vanilla JS: https://github.com/nanostores/nanostores#vanilla-js
- Pattern reference: "islands architecture" — per-mount-point hydration, no global re-render

## Handoff

Следующий шаг — `/ce-plan` для этого документа. План должен разобрать:
- Структуру каталогов под views (`src/views/` vs `src/components/`)
- Точные имена view-функций и mount-классов
- Порядок имплементации (например: bootstrap → simplest view → queue → modal)
- Стратегию для тестов: писать новый тест сразу после view-функции, не откладывать
- Cleanup-шаги: удаление старых файлов, nanotags из package.json, skill `idiomatic-nanotags`, пометка superseded на старых артефактах
