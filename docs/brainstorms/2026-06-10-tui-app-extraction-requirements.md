# TUI App Extraction

Date: 2026-06-10
Status: Ready for planning

## Problem

`packages/engine` сейчас совмещает три роли: core download engine, CLI (`run.ts`), HTTP/WS sidecar (`engine.ts`) и Ink/React TUI (`tui.ts` + `src/tui/**`). Из-за этого engine package тащит `ink`, `react`, `@types/react`, `ink-testing-library` — лишние зависимости для headless контекстов (CLI batch, sidecar, будущий desktop). Workspace layout уже подразумевает `apps/*` как клиентов engine: `apps/web` живёт как HTTP/WS клиент. TUI — естественный второй клиент, но физически до сих пор внутри engine.

## Outcome

TUI становится отдельным workspace-приложением `@scribd-dl/tui` (`apps/tui/`), которое подключается к запущенному engine sidecar по HTTP/WS — той же модели, что и `apps/web`. Engine больше не зависит от Ink/React. Wire-клиент (HTTP + WS подписка) живёт в `@scribd-dl/shared` и переиспользуется обоими клиентами.

## Scope

### In scope

- Новый workspace `apps/tui/` с `package.json` (`@scribd-dl/tui`), `tsconfig.json`, `tui.ts` entry, и перенесёнными файлами из `packages/engine/src/tui/**`.
- TUI принимает CLI-флаг `--engine-url` (дефолт `http://localhost:4747`). Флаги `--output`, `--filename`, `--rendertime` из TUI убираются — конфиг живёт на engine sidecar.
- Если engine sidecar недоступен (connection refused / health-check fail) — TUI печатает короткую подсказку `run \`bun run engine\` first` и завершается с ненулевым кодом. Никакого auto-spawn.
- `@scribd-dl/shared` получает плоский `packages/shared/src/client.ts` с HTTP-обвязкой (enqueue/remove/retry/snapshot/folder) и WS-подпиской на `JobEvent`. Использует глобальные `fetch` и `WebSocket`. **API на plain `Promise`/callbacks — без Effect.** Это удерживает `effect` вне зависимостей `@scribd-dl/shared` и `apps/web`.
- `apps/web` мигрирует на `@scribd-dl/shared` client — `apps/web/src/lib/api.ts` и WS-логика из `apps/web/src/hooks/useEngineState.ts` заменяются на импорты из shared. Локальный `backendUrl.ts` остаётся, т.к. это web-специфичная резолюция URL.
- `apps/tui/src/hooks/useEngineState.ts` использует тот же shared client (вместо текущей Effect.Stream подписки).
- `packages/engine/package.json`: удалить `ink`, `react`, `@types/react`, `ink-testing-library`, скрипт `tui`. Удалить `packages/engine/tui.ts` и `packages/engine/src/tui/`.
- Корневой `package.json`: скрипт `bun run tui` указывает на `bun --cwd apps/tui tui.ts` (или эквивалент, сохраняющий `process.cwd()` в корне для `output/`).
- Обновить `CLAUDE.md` (Repository layout, команды) и `README.md` если упоминают TUI пути.

### Out of scope

- Любые изменения wire-контракта в `@scribd-dl/shared/jobs.ts` и `http.ts`.
- Auto-spawn engine sidecar из TUI.
- Remote-mode конфиг (передача `--output/--filename/--rendertime` с клиента на engine через HTTP).
- Аутентификация / TLS для HTTP/WS.
- Альтернативные transport (gRPC, Unix-socket, SSE).
- `apps/desktop` — не трогается этим изменением.

## Success criteria

- `bun run tui` (с запущенным `bun run engine` в соседнем терминале) показывает тот же UX, что и сегодня: список задач, enqueue по paste, remove, retry, exit.
- `cd packages/engine && cat package.json` не содержит `ink`, `react`, `@types/react`, `ink-testing-library`.
- `apps/web` собирается и работает без локального `api.ts` / WS-кода — всё импортируется из `@scribd-dl/shared`.
- `bun run test` зелёный во всех workspaces. Smoke-тесты engine не сломаны.
- Запуск TUI без sidecar выдаёт одну строку подсказки и exit code ≠ 0, без stack trace.

## Dependencies / Assumptions

- `fetch` и `WebSocket` доступны как глобалы в Bun 1.3.14 (подтверждено — Bun реализует обе Web API).
- `@scribd-dl/shared` сейчас содержит только типы; добавление runtime-кода (client) допустимо и не нарушает существующих импортов — это явное расширение роли shared с "wire contract" на "wire contract + thin client".
- Engine sidecar уже экспонирует все нужные методы (`enqueue`, `remove`, `retry`, `snapshot`, WS-канал `events`). Проверить в плане перед миграцией.

## Outstanding questions

Нет. Все развилки закрыты.

## Next step

`/ce-plan` — разложить миграцию на атомарные шаги (вытащить client в shared → мигрировать apps/web → создать apps/tui → удалить TUI из engine → обновить root скрипты и docs), с проверкой что каждый шаг оставляет репо в зелёном состоянии.
