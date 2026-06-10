# Monorepo Migration — Requirements

**Date:** 2026-06-10
**Status:** Ready for planning

## Problem

Репозиторий уже фактически содержит два пакета — Bun-движок в корне (Effect, Puppeteer, Ink TUI) и Vite SPA в `app/` — со своими `package.json`, `bun.lock` и `node_modules`. Связь между ними идёт через HTTP/WS sidecar.

Конкретные боли:

1. **Дублирование типов.** Контракт джобов (`JobStatus`, `JobEvent`, `Job`, `JobProgress`) задублирован вручную: `src/types/...` в движке и `app/src/lib/types.ts` в SPA. При изменении схемы события приходится править в двух местах, drift ловится только в рантайме.
2. **Скрипты и сборка.** Корневой `package.json` обходится через `cd app && bun run …` для каждой UI-команды. Нет единой команды для прогона тестов/линта по всему проекту.
3. **Задел под Tauri.** Скоро добавится третий пакет (desktop через Tauri). Текущая раскладка не имеет очевидного места под него, и добавление «ещё одного острова» рядом с `app/` усугубит обе боли выше.

Дублирование зависимостей (React 19 стоит дважды) не было названо самостоятельной болью — устраняется как побочный эффект, но не цель.

## Goal

Перевести репозиторий на Bun workspaces с раскладкой `packages/` + `apps/`, чтобы:

- Типы контракта движок↔клиенты жили в одном пакете и импортировались напрямую.
- Скрипты dev/test/lint/format запускались из корня одной командой через `bun --filter`.
- Будущий Tauri-десктоп добавлялся как готовый слот `apps/desktop`, тянущий `apps/web` и `@scribd-dl/shared` без новых архитектурных решений.

Успех = после миграции:
- Один `bun.lock` в корне.
- Удаление поля типа из `JobEvent` ломает TypeScript-сборку обоих потребителей.
- `bun test` из корня прогоняет тесты движка и SPA.
- Tauri-пакет добавляется чисто Cargo + ссылкой на `apps/web/dist` без реорганизации.

## Approach

**Bun workspaces, без orchestrator'а поверх.** Конфигурация в корневом `package.json`:

```json
{ "workspaces": ["packages/*", "apps/*"] }
```

Раскладка:

```
scribd-dl/
├── package.json              # workspaces + корневые scripts
├── bun.lock                  # единственный
├── docs/                     # остаётся в корне
├── output/                   # остаётся в корне (рантайм-артефакты)
├── packages/
│   ├── engine/               # текущий корень: run.ts, tui.ts, engine.ts, src/, test/
│   └── shared/               # JobStatus, JobEvent, Job, JobProgress, HTTP/WS контракт
└── apps/
    ├── web/                  # текущий app/
    └── desktop/              # резерв под Tauri (создаётся пустым или в момент Tauri-старта)
```

Внутренние зависимости через `"@scribd-dl/shared": "workspace:*"`.

Turborepo и любой другой orchestrator вне скоупа — для 3 пакетов и одного разработчика Bun-нативного `--filter` достаточно, добавится потом если действительно понадобится CI-кэш.

Codegen контракта (OpenAPI / typed RPC) тоже вне скоупа — `packages/shared` решает текущую боль с типами, дальнейшая эволюция в сторону single-source-of-truth — отдельный разговор.

## Scope

### In scope

- Создание `packages/engine`, `packages/shared`, `apps/web` и переезд файлов.
- Корневой `package.json` с workspaces, едиными скриптами (`dev`, `test`, `lint`, `format`, `start`, `tui`, `engine`) через `bun --filter`.
- Извлечение типов джобов и HTTP/WS контракта в `packages/shared`, замена ручных копий в `packages/engine` и `apps/web` на импорт из `@scribd-dl/shared`.
- Обновление `tsconfig.json` всех пакетов под новые пути.
- Обновление путей в `oxlint`/`oxfmt` скриптах под workspace-структуру (раскладка как в существующем монорепо-проекте пользователя, паттерн уже проверен).
- Обновление `docker-download.sh` и `scripts/dev-spa.ts` под новые пути.
- Обновление `CLAUDE.md` и `README.md` под новые команды и структуру.
- Удаление `links.md` из репозитория.

### Out of scope

- Tauri-имплементация: только зарезервированное место `apps/desktop` (либо пустая папка с README-стабом, либо создаётся в момент Tauri-старта — на усмотрение планирования).
- Turborepo / Nx / любой другой monorepo orchestrator.
- Codegen контракта.
- Публикация `@scribd-dl/shared` как внешнего npm-пакета (внутренний только).
- Реорганизация `docs/` или `output/` — остаются в корне.
- Любые изменения функционала engine или SPA, не связанные с переездом.

## Decisions

| Развилка | Решение | Почему |
|---|---|---|
| Orchestrator (Turbo/Nx) | Нет | 3 пакета, один разработчик — Bun `--filter` хватает |
| Раскладка | `packages/` + `apps/` | Чёткое разделение библиотек/сервисов и приложений; engine — сервис с CLI/TUI, web — приложение |
| Версионирование внутренних пакетов | `workspace:*` | Идиоматично для Bun workspaces, не требует ручной синхронизации версий |
| `links.md` | Удалить | Не нужен |
| `docs/` | Корень | Документация проекта в целом, не специфична для engine |
| `output/` | Корень | Рантайм-артефакты CLI, путь не должен зависеть от внутренней раскладки |
| Положение engine | `packages/engine` (не корень) | Симметрия с `packages/shared` и `apps/*`, упрощает корневой `package.json` |
| Tauri | `apps/desktop` слот | Готовый путь без переорганизации в момент старта |

## Dependencies / Assumptions

- Bun 1.3.14 workspaces работают стабильно для текущего набора зависимостей (Effect, Puppeteer, Vite, React 19). Если всплывут peer-deps баги — фиксируются точечно, не отменяют миграцию.
- `oxlint`/`oxfmt` корректно обрабатывают workspace-структуру — подтверждено на другом проекте пользователя.
- `puppeteer` после переезда в `packages/engine` сохраняет работоспособность (Chromium кэш не привязан к пути пакета).
- Docker workflow (`docker-download.sh`) должен продолжать работать — это влияет на то, какие пути монтируются в контейнер.

## Outstanding Questions

Эти вопросы остаются для фазы планирования, не блокируют брейншторм:

- **Стратегия миграции:** один большой commit vs пошагово (сначала `packages/shared` + path aliases, потом переезд engine, потом web). Влияет на ревью, не на конечный результат.
- **`apps/desktop` сейчас или потом:** создавать пустой слот с README-стабом сразу или ждать реального Tauri-старта.
- **CI:** есть ли уже GitHub Actions / другой CI? Если да — какие команды обновлять.
- **Naming:** `@scribd-dl/shared` или `@scribd-dl/contract`. Незначительно, на вкус.

## Success Criteria

После миграции:

1. `bun install` в корне ставит всё; присутствует ровно один `bun.lock`.
2. `bun test` из корня прогоняет тесты `packages/engine` и `apps/web`.
3. `bun run lint` и `bun run format` из корня покрывают все пакеты.
4. `apps/web/src/lib/types.ts` удалён; SPA импортирует типы из `@scribd-dl/shared`.
5. Типы джобов определены ровно в одном месте — `packages/shared`.
6. Изменение определения `JobEvent` в `packages/shared` вызывает TS-ошибку в `packages/engine` и `apps/web` до правки потребителей.
7. `bun start <url>`, `bun run tui`, `bun run engine`, `bun run app:dev` (или эквиваленты через `--filter`) продолжают работать из корня.
8. `./docker-download.sh <url>` продолжает работать.
9. `links.md` удалён, `docs/` и `output/` остались в корне.
10. Раскладка `apps/desktop` зарезервирована (даже если пустая) — добавление Tauri не потребует реорганизации других пакетов.

## Next Step

`/ce-plan` от этого документа — нужен пошаговый план миграции с порядком переноса, обновлением скриптов, и стратегией ревью.
