---
title: "refactor: Extract TUI into apps/tui workspace with shared HTTP/WS client"
status: active
date: 2026-06-10
origin: docs/brainstorms/2026-06-10-tui-app-extraction-requirements.md
---

# refactor: Extract TUI into apps/tui workspace with shared HTTP/WS client

## Summary

Вынести Ink/React TUI из `packages/engine` в новый workspace `apps/tui` и подключить его к engine sidecar по HTTP/WS, по той же модели, что и `apps/web`. Извлечь тонкий plain-async HTTP+WS клиент в `@scribd-dl/shared`, мигрировать на него `apps/web`, удалить `ink`/`react` из зависимостей `packages/engine`.

## Problem Frame

`packages/engine` сейчас совмещает core engine, CLI (`run.ts`), HTTP/WS sidecar (`engine.ts`) и Ink/React TUI (`tui.ts` + `src/tui/**`). Это тащит `ink`, `react`, `@types/react`, `ink-testing-library` в headless-контексты (CLI batch, sidecar). Workspace layout уже подразумевает `apps/*` как клиентов engine — `apps/web` живёт как HTTP/WS клиент. TUI логически такой же клиент, физически — внутри engine. После переезда engine становится headless по зависимостям, а TUI разделяет тот же wire-клиент с web.

## Requirements

Из origin (`docs/brainstorms/2026-06-10-tui-app-extraction-requirements.md`):

- R1. Новый workspace `apps/tui` (`@scribd-dl/tui`) — Ink/React клиент engine sidecar.
- R2. TUI подключается по HTTP/WS, флаг `--engine-url` (дефолт `http://localhost:4747`).
- R3. Флаги `--output`, `--filename`, `--rendertime` из TUI убраны — конфиг живёт на engine.
- R4. Sidecar недоступен → одна строка подсказки `run \`bun run engine\` first` + non-zero exit. Без auto-spawn.
- R5. `@scribd-dl/shared/client.ts` — плоский plain-`Promise` HTTP-клиент + WS-подписка на `JobEvent`, использует глобальные `fetch`/`WebSocket`. Без `effect` в зависимостях shared.
- R6. `apps/web` мигрирует на `@scribd-dl/shared` client — `apps/web/src/lib/api.ts` удалён, импорты заменены.
- R7. `packages/engine` теряет `ink`, `react`, `@types/react`, `ink-testing-library` из `package.json` и весь TUI-код.
- R8. Корневой `bun run tui` запускает новый app, сохраняя `process.cwd()` в корне репо (чтобы `output/` оставался корневым).
- R9. `CLAUDE.md` и (при упоминаниях TUI) `README.md` обновлены под новый layout.

## Key Technical Decisions

### KTD1. Plain-Promise клиент, не Effect

`@scribd-dl/shared/client.ts` экспортирует `Promise`-возвращающие функции и callback-based WS-подписку (см. origin §"Outcome"). Reason: web уже на Promise, TUI React-хук не выигрывает от Effect в transport-слое, и shared остаётся без runtime-зависимости от `effect`.

### KTD2. Плоский `client.ts`, без вложенной структуры

Один файл `packages/shared/src/client.ts` (~80 строк). Не `client/http.ts` + `client/ws.ts`. Reason: объём не оправдывает разбиение; current `packages/shared/src/http.ts` (типы) и новый `client.ts` (runtime) семантически разделены именами.

### KTD3. Fail-fast при недоступном sidecar, без auto-spawn

TUI делает один `GET /snapshot` health-check при старте. Connection refused / timeout → `console.error("run \`bun run engine\` first")` + `process.exit(1)`. Никакого retry-loop. Reason: auto-spawn умножает edge cases (порт занят, zombie process, передача флагов) без реальной пользы для single-user dev tool.

### KTD4. Миграция engine остаётся неизменной, web мигрирует первой

Порядок: shared client → web migration → apps/tui создание → engine cleanup. Каждый коммит зелёный. Reason: позволяет тестировать shared client против работающего web до создания второго consumer; engine deps удаляются последним шагом, когда оба клиента уже на новой модели.

### KTD5. Root-level `bun run tui` запускает entry без `--cwd`

Скрипт: `"tui": "bun apps/tui/tui.ts"`, не `"bun --cwd apps/tui tui.ts"`. Reason: соответствует существующему правилу из CLAUDE.md — `process.cwd()` остаётся в корне репо, `output/` лендится в корне независимо от entry point.

---

## Implementation Units

### U1. Add HTTP+WS client to @scribd-dl/shared

**Goal:** Создать `packages/shared/src/client.ts` с plain-Promise обвязкой над текущим HTTP API engine и WS-подпиской на `/events`.

**Requirements:** R5, KTD1, KTD2.

**Dependencies:** none.

**Files:**
- `packages/shared/src/client.ts` (new)
- `packages/shared/src/index.ts` (modify — re-export from `client.ts`)
- `packages/shared/test/client.test.ts` (new)

**Approach:**
- Перенести 6 функций из текущего `apps/web/src/lib/api.ts` в `client.ts` дословно: `fetchSnapshot`, `enqueueText`, `removeJob`, `retryJob`, `fetchFolder`, `setFolder`. Сигнатуры неизменны — `(baseUrl, ...) => Promise<...>`.
- Добавить `subscribeEvents(baseUrl, handlers): { close: () => void }` где `handlers` — `{ onOpen?, onMessage: (event: JobEvent) => void, onClose?, onError? }`. Сообщения парсятся как JSON и проверяются как `JobEvent`. URL-склейка: `toWsUrl(baseUrl) + '/events'` (вытащить `toWsUrl` из `apps/web/src/lib/backendUrl.ts` тоже в `client.ts` как exported helper).
- Реэкспортировать всё из `packages/shared/src/index.ts`.

**Patterns to follow:** существующий стиль `apps/web/src/lib/api.ts` — `const json = { "Content-Type": "application/json" }`, `if (!res.ok) throw new Error(...)`.

**Test scenarios:**
- `fetchSnapshot` возвращает распарсенный `EngineSnapshot` при HTTP 200.
- `fetchSnapshot` бросает `Error` при HTTP 500, текст ошибки включает статус.
- `enqueueText` отправляет `POST /enqueue` с правильным body и заголовками.
- `removeJob` игнорирует 404 и 409, но бросает на 500.
- `retryJob` — то же поведение что `removeJob`.
- `subscribeEvents` открывает WebSocket к `<wsBase>/events`, вызывает `onOpen` при `open`, `onMessage` с распарсенным `JobEvent` при сообщении, `onClose` при `close`.
- `subscribeEvents().close()` закрывает WebSocket и больше не дёргает handlers.
- `toWsUrl` корректно конвертирует `http://` → `ws://` и `https://` → `wss://`.

**Verification:** `bun --filter @scribd-dl/shared test` зелёный. `bun run lint` чист.

---

### U2. Migrate apps/web to shared client

**Goal:** Заменить `apps/web/src/lib/api.ts` импортами из `@scribd-dl/shared`, рефакторить `useEngineState` на `subscribeEvents` из shared.

**Requirements:** R6.

**Dependencies:** U1.

**Files:**
- `apps/web/src/lib/api.ts` (delete)
- `apps/web/src/lib/backendUrl.ts` (modify — убрать `toWsUrl`, импортировать из shared; оставить `getBackendUrl`)
- `apps/web/src/hooks/useEngineState.ts` (modify — заменить inline WebSocket на `subscribeEvents`)
- `apps/web/src/hooks/usePasteHandler.ts` (modify if it imports from `@/lib/api`)
- Все компоненты в `apps/web/src/components/**` импортирующие `@/lib/api` (modify — заменить на `@scribd-dl/shared`)

**Approach:**
- Найти все импорты `@/lib/api` (grep) и заменить путь на `@scribd-dl/shared`. Имена функций сохранены, поэтому ничего больше не меняется в call-sites.
- В `useEngineState.ts` заменить блок `const ws = new WebSocket(...); ws.onopen = ...` на `const sub = subscribeEvents(url, { onOpen, onMessage, onClose, onError })`. `refresh()` и `setSnapshot` остаются неизменными.
- `apps/web/src/lib/backendUrl.ts`: убрать local `toWsUrl`, импортировать из `@scribd-dl/shared`. Оставить web-специфичный `getBackendUrl()`.
- Удалить `apps/web/src/lib/api.ts`.

**Patterns to follow:** существующая структура `useEngineState.ts` — `let alive = true;` + cleanup в return.

**Test scenarios:**
- `Test expectation: none -- behavioral migration, no new behavior. Existing apps/web tests (if any) cover regression.` Если в `apps/web` нет тестов на `useEngineState`, добавлять их в этом плане не нужно — это вне scope refactor'а.

**Verification:** `bun --filter @scribd-dl/web test` зелёный (если тесты есть). `bun run app:dev` + `bun run engine` в соседнем терминале: UI работает, enqueue/remove/retry/snapshot live-обновления функционируют. Type-check `bun run lint` чист.

---

### U3. Create apps/tui workspace skeleton

**Goal:** Создать новый workspace `apps/tui` с `package.json`, `tsconfig.json`, `bunfig.toml`, пустым `tui.ts` placeholder, без переноса логики.

**Requirements:** R1.

**Dependencies:** none (can run parallel to U1/U2 in principle, but easier to land sequentially).

**Files:**
- `apps/tui/package.json` (new)
- `apps/tui/tsconfig.json` (new)
- `apps/tui/bunfig.toml` (new)
- `apps/tui/tui.ts` (new — minimal placeholder logging "TODO" to keep workspace installable)

**Approach:**
- `package.json`: `name: "@scribd-dl/tui"`, `private: true`, `type: "module"`, scripts `{ "tui": "bun tui.ts", "test": "bun test" }`. Dependencies: `@effect/cli`, `@effect/platform-bun`, `effect`, `ink`, `react`, `@scribd-dl/shared: "workspace:*"`. DevDependencies: `@types/bun`, `@types/react`, `ink-testing-library`.
- `tsconfig.json` — копия `packages/engine/tsconfig.json` с релевантными путями.
- `bunfig.toml` — копия `packages/engine/bunfig.toml` если содержательно.
- `tui.ts` — `console.log("scribd-dl-tui placeholder"); process.exit(0);` (заменится в U4).

**Patterns to follow:** `apps/web/package.json` и `packages/engine/package.json` как шаблоны.

**Test scenarios:** `Test expectation: none -- workspace scaffolding, no behavior.`

**Verification:** `bun install` проходит, добавляет workspace в корневой lockfile. `bun --filter @scribd-dl/tui tui` печатает placeholder и выходит с кодом 0.

---

### U4. Move TUI source files to apps/tui and rewire to shared client

**Goal:** Перенести `packages/engine/tui.ts` и `packages/engine/src/tui/**` в `apps/tui/`, переписать `useEngineState` на `subscribeEvents` из shared, заменить in-process engine actions на HTTP-вызовы, добавить `--engine-url` флаг и health-check.

**Requirements:** R1, R2, R3, R4, KTD3.

**Dependencies:** U1, U3.

**Files:**
- `apps/tui/tui.ts` (modify — заменить placeholder на новую CLI-обвязку)
- `apps/tui/src/tui/App.tsx` (new — копия `packages/engine/src/tui/App.tsx` с заменой `engine` prop на `baseUrl`)
- `apps/tui/src/tui/ChangeFolderPopup.tsx`, `ExitConfirm.tsx`, `Header.tsx`, `Queue.tsx`, `QueueItem.tsx`, `StatusBar.tsx` (new — копии из `packages/engine/src/tui/`)
- `apps/tui/src/tui/mouse/**` (new — копии)
- `apps/tui/src/hooks/useEngineState.ts` (new — переписан с Effect.Stream на `subscribeEvents` + Promise)

**Approach:**
- **`apps/tui/tui.ts`:** `@effect/cli` Command с одним опционом `engineUrlOpt` (string, default `http://localhost:4747`). Хендлер: вызвать `fetchSnapshot(engineUrl)` как health-check (`Effect.tryPromise`). При ошибке — `Effect.logError("run \`bun run engine\` first")` + `Effect.die` или явный `process.exit(1)`. При успехе — `render(<App baseUrl={engineUrl} />)` через тот же alternate-screen escape, что и сейчас, с `Effect.acquireRelease` для cleanup.
- **`apps/tui/src/hooks/useEngineState.ts`:** один `useEffect`. На mount: `fetchSnapshot(baseUrl).then(setSnapshot)`, `subscribeEvents(baseUrl, { onOpen, onMessage: () => fetchSnapshot(baseUrl).then(setSnapshot), onClose, onError })`. Cleanup: `sub.close()`. Возвращает `{ snapshot, isConnected }`.
- **`apps/tui/src/tui/App.tsx`:** заменить prop `engine: DownloadEngineService` на `baseUrl: string` и `folder: string` на полученный из `fetchFolder(baseUrl)` (или в дочерних компонентах). Все вызовы `engine.enqueue(...)`, `engine.remove(...)`, `engine.retry(...)` заменить на `enqueueText(baseUrl, ...)`, `removeJob(baseUrl, ...)`, `retryJob(baseUrl, ...)` из shared.
- **`ChangeFolderPopup.tsx`:** использовать `fetchFolder`/`setFolder` из shared вместо in-process.

**Patterns to follow:** `apps/web/src/hooks/useEngineState.ts` для shape хука; `packages/engine/tui.ts` для alternate-screen escape sequence.

**Test scenarios:**
- TUI стартует → health-check на dummy HTTP server возвращает 200 → `render` вызывается с правильным `baseUrl`. (Тест через `ink-testing-library`.)
- TUI стартует → health-check бросает (mock `fetch` reject) → process exits с кодом 1, stderr содержит `run \`bun run engine\` first`.
- `useEngineState` после mount вызывает `fetchSnapshot` один раз, затем при каждом WS-сообщении вызывает `fetchSnapshot` снова и обновляет state.
- Pressing "remove" key вызывает `removeJob(baseUrl, jobId)` (mock shared client).

**Verification:** `bun --filter @scribd-dl/tui test` зелёный. Manual smoke: запустить `bun run engine` в одном терминале, `bun apps/tui/tui.ts` в другом — TUI показывает empty queue, paste URL добавляет job, прогресс live. Без engine — `bun apps/tui/tui.ts` печатает подсказку и exit 1.

---

### U5. Remove TUI from packages/engine

**Goal:** Удалить `packages/engine/tui.ts`, `packages/engine/src/tui/**`, и связанные dependencies из `packages/engine/package.json`.

**Requirements:** R7.

**Dependencies:** U4 (apps/tui должен быть рабочим до удаления старого).

**Files:**
- `packages/engine/tui.ts` (delete)
- `packages/engine/src/tui/` (delete recursively)
- `packages/engine/package.json` (modify — удалить `ink`, `react`, `@types/react`, `ink-testing-library`, скрипт `tui`)
- `packages/engine/test/**` (modify if there are TUI tests in engine — move or delete; verify with grep)

**Approach:**
- Удалить файлы.
- Из `packages/engine/package.json`: убрать `ink` и `react` из `dependencies`; убрать `@types/react` и `ink-testing-library` из `devDependencies`; убрать `"tui": "bun tui.ts"` из `scripts`.
- Grep `packages/engine/test/` на любые импорты Ink/React — если есть, перенести в `apps/tui/test/` или удалить.

**Patterns to follow:** N/A — это deletion pass.

**Test scenarios:** `Test expectation: none -- pure deletion. Existing engine tests must continue to pass.`

**Verification:** `bun install` проходит (lockfile обновляется, ink/react исчезают из engine). `bun --filter @scribd-dl/engine test` зелёный. `grep -r "from.*ink" packages/engine/` — пусто. `grep -r "from.*react" packages/engine/` — пусто.

---

### U6. Update root scripts and docs

**Goal:** Обновить корневой `package.json`, `CLAUDE.md`, и `README.md` (если упоминает TUI) под новый layout.

**Requirements:** R8, R9.

**Dependencies:** U4, U5.

**Files:**
- `package.json` (modify — корневой)
- `CLAUDE.md` (modify)
- `README.md` (modify — только если упоминает `bun run tui` или TUI расположение)

**Approach:**
- Корневой `package.json` script `tui`: заменить текущий (если есть `bun --filter @scribd-dl/engine tui`) на `bun apps/tui/tui.ts`. См. KTD5 — без `--cwd`.
- `CLAUDE.md`:
  - В разделе "Repository layout" добавить `apps/tui/` с описанием.
  - В разделе "Runtime and commands" обновить описание `bun run tui` (был Ink TUI in-process — стал отдельный HTTP/WS клиент, требует запущенный `bun run engine`).
  - В разделе "Architecture" обновить описание `DownloadEngine` consumers — Ink-TUI теперь "из apps/tui по HTTP/WS", не "in-process".
  - Список рантайм-артефактов "output/ location": никаких изменений по сути, но добавить `apps/tui/tui.ts` в список entry points, которые запускаются из корня без `--cwd`.
- `README.md`: проверить упоминания TUI, обновить если есть.

**Patterns to follow:** существующий стиль `CLAUDE.md`.

**Test scenarios:** `Test expectation: none -- docs and config.`

**Verification:** `bun run tui` (без аргументов, с запущенным engine) поднимает TUI. `bun run tui` без engine печатает подсказку и exit 1. Visual review `CLAUDE.md` diff.

---

## Scope Boundaries

### In scope

См. Implementation Units U1–U6.

### Deferred to Follow-Up Work

- Effect-обёртка над shared client в `apps/tui` (если когда-нибудь понадобится Schedule-retry или Resource-safe WS на TUI стороне).
- Перенос web-специфичного `getBackendUrl()` в shared, если desktop-app в будущем переиспользует ту же резолюцию.

### Outside this product's identity

- Auto-spawn engine sidecar из TUI (см. KTD3 и origin §"Out of scope").
- Remote-mode конфиг через HTTP (передача `--output/--filename/--rendertime` клиентом).
- Аутентификация / TLS / multi-tenant — single-user tool.
- Альтернативные transport (gRPC, Unix-socket, SSE).

---

## Risks & Dependencies

- **WS reconnect стратегия.** Текущий `apps/web` хук не делает auto-reconnect — есть только manual `reconnect()`. TUI наследует это поведение через shared client. Если в practice окажется неудобно — отдельный follow-up.
- **`fetch`/`WebSocket` в Bun.** Подтверждено что Bun 1.3.14 реализует обе Web API глобально. Если миграция вскроет несовместимость — fallback на `undici`/`ws` в shared, но это маловероятно.
- **U2 ломает web до U3-U6.** Минимизировано порядком: U2 завершён и web работает на shared client до начала U3+. Engine при этом неизменён.
- **Engine tests с TUI зависимостями.** До U5 нужно проверить grep что `packages/engine/test/` не импортирует ink/react — иначе U5 ломает тесты.

---

## Open Questions

Нет открытых вопросов на planning-time. Implementation-time discovery:
- Точная подпись `subscribeEvents` (нужен ли отдельный `onReconnect` handler) — решится при U1.
- Где именно жить `ProgressStage`-зависимым форматтерам в TUI компонентах (импорт из shared types — да; форматтер — внутри `apps/tui`).
