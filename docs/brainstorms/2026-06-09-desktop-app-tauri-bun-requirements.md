# Desktop app (Tauri + Bun sidecar): requirements

**Дата:** 2026-06-09
**Updated:** 2026-06-11 — переписано под фактическое состояние репо (monorepo, uhtml/nanostores SPA, engine как HTTP/WS sidecar). F0 и F1 старого плана уже сделаны и из scope этого документа выведены.
**Статус:** Brainstorm → готово к `/ce-plan`
**Связано:** `packages/engine/engine.ts`, `packages/engine/src/service/DownloadEngine.ts`, `packages/shared/src/{http,jobs}.ts`, `apps/web/`, `apps/desktop/`
**Supersedes:** `docs/brainstorms/2026-06-09-tauri-app-requirements.md` (устарел: до Effect-refactor и Ink-TUI)

## Проблема и цель

Сейчас у `DownloadEngine` три клиента: CLI-вход `bun run engine` (HTTP/WS sidecar), Ink-TUI (`bun run tui`) и веб-SPA `apps/web` (Vite). UX интерактивных клиентов устраивает, не устраивает обязательность терминала: «открой Terminal → набери команду → потом уже Cmd+V». Цель — десктоп-приложение, запускаемое из Spotlight/Dock, всё остальное поведение — копия web-SPA плюс native folder picker и system notifications.

**Метрика успеха:** от Spotlight до файла на диске — два жеста (запустить + `Cmd+V`), без терминала. Никакого регресса по сравнению с web-SPA.

## Пользователь и сценарий

Автор репо + узкий круг знакомых на macOS. Сценарий: наткнулся на Scribd-ссылку → Spotlight → `scribd-dl.app` → `Cmd+V` → файл в выбранной папке. Иногда — серия из нескольких ссылок подряд.

## In scope (v1)

**UX-паритет с `apps/web`** (он уже реализует тот же набор):
- Окно — список задач. Колонки: title (или URL до известного title), статус, действие.
- Статусы: `Queued`, `Downloading`, `Downloaded`, `Failed` (с причиной).
- `Cmd+V` в окне → текст буфера передаётся в `engine.enqueue` через `POST /enqueue` (engine сам извлекает URL, классифицирует scribd/unsupported).
- Если в буфере не найдено валидных URL → транзиентная плашка `No links found in clipboard` ~2с.
- `Remove` — только на `Queued`. `Retry` — только на `Failed` с `retryable=true` (unsupported-domain — без Retry).
- Quit-guard: при попытке закрыть окно с активными `Queued`/`Downloading` задачами — confirm dialog `Идёт скачивание / задачи в очереди. Закрыть?`. `Close anyway` → cancel engine scope, exit.
- Session-only state UI: `apps/web` уже умеет показывать сохранённую очередь из `JobStore` engine'а — desktop наследует это поведение «как есть».

**Дополнительно в v1 (поверх web-SPA):**
- **Native folder picker.** В `apps/web/src/views/folder-modal.ts` добавляется кнопка `Browse…`, видимая только при `window.__TAURI__`. Native dialog возвращает path → пишется в `$draftFolder` → дальше существующий save-flow (`saveFolder(path)` → `POST /folder`). Текстовый input остаётся редактируемым руками — apps/web остаётся shared bundle.
- **macOS system notifications** на `Downloaded` и `Failed` (когда окно не в фокусе). Click по нотификации фокусирует окно.

**Распределение:**
- DMG-бандл `scribd-dl.dmg`, при первом запуске пользователь увидит Gatekeeper-предупреждение (приемлемо для текущего круга).

## Out of scope (v1)

- **Per-job progress** (page N/M прогресс-бар). Engine сейчас не эмитит `JobProgress` events — отдельный трек, не блокирует v1. UI рисует только дискретный статус.
- **Drag-and-drop файлов** со списком URL.
- **Global hotkey, tray app, auto-watch буфера.**
- **Параллельные скачивания** (engine — один воркер-фибер).
- **UI для filename strategy / rendertime.** В v1 эти параметры фиксируются дефолтами из `DEFAULT_CONFIG` (`filename=title`, `rendertime` как в текущем CLI). Кнопок в UI нет.
- **Code signing / notarization.** Можно добавить отдельной фазой когда круг распространения вырастет — это разовая настройка Apple Developer аккаунта + CI, не код.
- **Windows / Linux билды.** Код пишется cross-platform-ready (без macOS-only API в фронте/Rust-shim), сборка и тест только под macOS.
- **Auto-update.**

## Готовый baseline (F0 + F1 — уже в репо)

Эти куски старого плана сделаны и в этом брейншторме фигурируют только как зависимости.

### Engine HTTP/WS sidecar — `packages/engine`

`packages/engine/engine.ts` — единственный entrypoint. `@effect/cli` парсит `--port` (дефолт 4747), `BunRuntime.runMain` поднимает Layer-стек (`ConfigLoaderLive`, `ConfigStoreLive`, `JobStoreLive`, `DirectoryIoLive`, `PdfGeneratorLive`, `PuppeteerSgLive`, `ScribdDownloaderLive`, `DownloadEngineLive`) + Bun.serve HTTP/WS поверх `DownloadEngine`.

**Endpoints (источник правды — `packages/shared/src/http.ts`):**

| HTTP                           | Engine method                                |
| ------------------------------ | -------------------------------------------- |
| `GET    /snapshot`             | `engine.snapshot`                            |
| `POST   /enqueue` `{text}`     | `engine.enqueue(text)`                       |
| `DELETE /jobs/:id`             | `engine.remove(id)`                          |
| `POST   /jobs/:id/retry`       | `engine.retry(id)`                           |
| `POST   /folder` `{path}`      | `engine.setOutputFolder(path)`               |
| `WS     /events`               | подписка на `engine.events` Stream           |

Сериализация — JSON, errors → HTTP 4xx с `{error, status?}`. WS-фреймы = event-объекты из `engine.events`.

### Web SPA — `apps/web`

Vite + **uhtml v4 + vanilla nanostores islands** (без React, без shadcn, без Custom Elements). Views: `header`, `queue`, `queueItem`, `statusbar`, `disconnect-banner`, `folder-modal`. Engine-клиент в `apps/web/src/engineClient.ts` (`fetch` + `WebSocket('/events')`). Snapshot-then-subscribe ordering уже реализован: open WS → wait open → `GET /snapshot` → setState → re-fetch на каждый event. Paste handler, queue ops, folder-modal — рабочие.

### Persistence

`outputFolder` персистится **на стороне engine** через `ConfigStore` (`~/.config/scribd-dl/settings.json`, атомарная запись). Очередь — `JobStore` (`~/.config/scribd-dl/jobs.jsonl`, `Downloading` нормализуется в `Queued` при рестарте). Tauri-side store для folder **не нужен** — это упрощение vs первый драфт плана.

## Архитектура desktop-обёртки

Намеренно фиксируем — это технический брейншторм.

### Топология процессов внутри `.app` бандла

```
scribd-dl.app
│
├─ Tauri wrapper (Rust binary)              ←── тонкий фронт (launcher)
│    ├─ WebView (WKWebView on macOS)
│    │    └─ apps/web build (статические Vite-assets)
│    │         │  fetch + WebSocket → localhost:NNNN
│    │         ▼
│    └─ Tauri sidecar API: spawn/manage engine binary
│
└─ scribd-dl-engine (Bun --compile binary)  ←── бэк (engine host)
     └─ тот же Layer stack из packages/engine
```

**Engine не дублируется.** Тот же `DownloadEngine`, тот же `ScribdDownloader`, тот же `PuppeteerSg`. Desktop — **третий клиент** того же HTTP/WS API после `apps/tui` и `apps/web`.

### Wire contract

`packages/shared/src/{http.ts, jobs.ts}` — единственный источник правды. Frontend в Tauri-окне импортирует те же типы, что и `apps/web` и `apps/tui`. Дублировать `Job`, `JobStatus`, `EnqueueRequest` где-либо ещё запрещено по `CLAUDE.md`.

### Port discovery

- Tauri sidecar API запускает bun-бинарь с `--port 0` (или без аргументов — engine читает `--port` через `@effect/cli` с дефолтом 4747; для desktop предпочтительнее random free port).
- engine биндится на свободный порт, пишет в stdout **одну строку** `READY port=NNNN` и продолжает работать.
- Rust shim парсит stdout до этой строки, читает port, прокидывает в webview через Tauri command `get_backend_url()` (или global `window.__BACKEND_URL__`).
- После `READY` stdout/stderr engine пишутся в logfile внутри `~/Library/Logs/scribd-dl/` для отладки.

**Open:** сейчас `engine.ts` имеет фиксированный default port 4747 и не печатает `READY`-строку. Добавление режима «эфемерный порт + handshake» — небольшая правка в `engine.ts` и `HttpServerLive`, делается в F2.

### Lifecycle engine-сайдкара

- Spawn — на `app.on('ready')` Tauri.
- Kill — на `app.on('window-all-closed')`. Clean shutdown (SIGTERM → wait → SIGKILL fallback). `PuppeteerSg` уже `Layer.scoped` поверх `Effect.acquireRelease` — Scope гарантирует закрытие Chromium при interrupt.
- Если sidecar упал между запросами — webview видит fetch-failure → показывает плашку `Backend disconnected` + кнопку `Restart` (это уже умеет `apps/web/src/views/disconnect-banner.ts`). Авто-respawn в v1 НЕТ.

### Frontend stack

Тот же `apps/web` без форка. `apps/desktop/tauri.conf.json`:
- `build.beforeDevCommand = "bun --filter @scribd-dl/web dev"`
- `build.devUrl = "http://localhost:5173"`
- `build.beforeBuildCommand = "bun --filter @scribd-dl/web build"`
- `build.frontendDist = "../web/dist"` (относительно `apps/desktop/`)

Tauri-aware ветки кода:
- `folder-modal.ts` — кнопка `Browse…` показывается при `window.__TAURI__`.
- `useEngineState` (или его аналог в `apps/web/src/main.ts`) — при `JobCompleted/JobFailed` && `document.visibilityState === 'hidden'` && `window.__TAURI__` → invoke `notify`.
- Origin backend URL — `window.__BACKEND_URL__` если задан, иначе текущий дефолт (`http://localhost:4747`).

Browser-сборка `apps/web` остаётся идентичной — все Tauri-ветки no-op при отсутствии `window.__TAURI__`.

### Native bridge (Tauri commands)

Минимальный набор после упрощения с engine-side persistence:
- `pick_folder()` → системный folder picker (`tauri-plugin-dialog`), возвращает path.
- `notify(title, body, jobId)` → macOS notification (`tauri-plugin-notification`). Click handler фокусирует окно через `window.show()`.
- `get_backend_url()` → строка `http://127.0.0.1:NNNN` после handshake.
- Всё остальное (queue ops, folder save, snapshot) — через HTTP/WS, не через Tauri commands.

`read_persisted_folder` / `write_persisted_folder` из первого драфта **выпилены** — persistence на стороне engine.

### Engine sidecar packaging

`bun build --compile --target=bun-darwin-arm64 packages/engine/engine.ts --outfile scribd-dl-engine` → self-contained binary (~50MB). Объявляется как Tauri sidecar в `tauri.conf.json` (`bundle.externalBin`).

Puppeteer Chromium — отдельный артефакт. См. Outstanding.

### Dev workflow

Сейчас уже работает `bun run dev:spa` (engine + Vite через `scripts/dev-spa.ts`) — открывается `http://localhost:5173` в Chrome. Это и есть «browser-first» режим.

После F2 добавляется `bun --filter @scribd-dl/desktop tauri dev` — то же самое, но в Tauri-окне.

Прототип = финальный код. Никакого выкидного html-мокапа.

## Фазы реализации

Каждая фаза — независимо проверяемый кусок. Не двигаемся к N+1, пока N не сдан. F0 и F1 закрыты до начала работ по этому брейншторму.

### F0 — engine HTTP/WS sidecar (✅ done)

`packages/engine/engine.ts` поднимает Bun.serve, endpoints живут, WS работает, wire contract в `packages/shared`. `apps/web` и `apps/tui` уже пользуются.

**Что добавить в F2 поверх готового:**
- Поддержка `--port 0` (или пустого port-аргумента) → bind на свободный порт.
- Печать `READY port=NNNN` в stdout одной строкой после успешного bind.

### F1 — SPA в браузере (✅ done)

`apps/web` на uhtml/nanostores закрывает полный UX-паритет. Все приёмочные критерии исходного F1 (paste, queue, remove/retry, folder modal, reconnect via disconnect-banner) — выполнены.

### F2 — Tauri scaffold + bun sidecar handshake

**Делаем:**
- `apps/desktop/` — `bun tauri init` внутри workspace-слота. Rust crate, `tauri.conf.json`, иконки.
- `tauri.conf.json` указывает `beforeDevCommand`/`devUrl`/`frontendDist` на `apps/web` (см. выше).
- Engine: добавить `--port 0` mode + печать `READY port=NNNN`.
- Rust shim: spawn sidecar, парсит stdout до `READY`, отдаёт port в webview через Tauri command `get_backend_url()` (фронт читает его на mount вместо хардкода `localhost:4747`).
- В `apps/web/src/engineClient.ts` — резолв базового URL: `window.__TAURI__` → вызвать `get_backend_url()`, иначе остаться на текущем дефолте.

**Приёмка:**
- `bun --filter @scribd-dl/desktop tauri dev` поднимает окно, в нём — тот же SPA что в browser dev, всё работает.
- React-конкретики нет — это uhtml.
- Vite HMR продолжает работать внутри Tauri-окна (правка `.ts` в `apps/web/src/` → webview обновляется).
- Закрытие окна → bun-процесс убит (`ps aux | grep scribd-dl-engine` пусто), Chromium Puppeteer тоже умер (Scope cleanup).
- `bun test`, `bun run lint`, `bun run format:check` — зелёные.

### F3 — Native bridge: folder picker + notifications

**Делаем:**
- Tauri plugins: `tauri-plugin-dialog`, `tauri-plugin-notification`.
- Tauri commands: `pick_folder` (открывает native dialog, возвращает path), `notify(title, body, jobId)`.
- `apps/web/src/views/folder-modal.ts` — `Browse…`-кнопка, видимая при `window.__TAURI__`. По клику: `invoke('pick_folder')` → если path вернулся → `$draftFolder.set(path)`. Дальше — существующий `trySave` (`POST /folder`).
- `apps/web/src/main.ts` (или соответствующий слой) — подписка на WS-события `JobCompleted`/`JobFailed`: если окно не в фокусе **и** `window.__TAURI__` → `invoke('notify', ...)`. Click handler фокусирует окно.

**Приёмка:**
- Browse в folder-modal под Tauri → native dialog → выбор → input заполняется path'ом → Save → `POST /folder` → engine персистит, snapshot отражает новый folder. Перезапуск engine → folder тот же (это уже свойство `ConfigStore`).
- В browser-режиме (`bun run dev:spa`) кнопки Browse нет, поведение модалки прежнее.
- Свернуть окно → дождаться Downloaded → видна macOS notification.
- Click на notification → окно поднимается в фокус.
- В фокусе → notification не показывается (только UI меняется).
- Failed → notification с reason в body.

### F4 — Quit guard

**Делаем:** перехват `tauri::WindowEvent::CloseRequested` в Rust. Rust делает `fetch GET /snapshot` (или вызывает Tauri command-обёртку над HTTP-клиентом) → если есть active jobs (`status in {Queued, Downloading}`) → native confirm dialog `Cancel` / `Close anyway`. `Close anyway` → kill sidecar → exit.

**Приёмка:**
- Пустая очередь → закрывается без диалога.
- `Downloading` → диалог. Cancel → окно остаётся.
- `Close anyway` → sidecar убит, нет zombie Chromium.

### F5 — Packaging + smoke test на чистой macOS

**Делаем:**
- `bun build --compile --target=bun-darwin-arm64 packages/engine/engine.ts --outfile apps/desktop/src-tauri/binaries/scribd-dl-engine-aarch64-apple-darwin` (имя по Tauri sidecar convention).
- `bun --filter @scribd-dl/desktop tauri build` → `.app` + `.dmg`.
- Puppeteer Chromium — bundled или auto-download (решить по факту размера, см. Outstanding).
- Проверяем на чистой macOS-машине без dev-окружения.

**Приёмка:**
- DMG ставится на чистую macOS.
- Launchpad → окно открывается → backend connect успешен (handshake отработал).
- Полный сценарий paste → Downloaded работает.
- Folder picker, notifications, quit guard работают.
- Размер DMG зафиксирован в README — входной сигнал для решения «нужен ли Rust-rewrite engine».

## Зависимости и предположения

- **Bun 1.3.14+** — runtime для engine. `bun build --compile --target=bun-darwin-arm64` создаёт self-contained binary для sidecar.
- **Tauri 2.x** — wrapper. Использует system WebView (WKWebView на macOS), не Chromium → wrapper-часть бандла малая (~5-10MB).
- **Puppeteer + Chromium** — engine продолжает использовать существующий `PuppeteerSg`. Chromium либо bundled в DMG (~150MB), либо auto-download при первом запуске. Решение откладываем до F5.
- **Engine `DownloadEngine.events` PubSub** буферизует события подписавшимся клиентам — свойство существующего engine (snapshot-then-subscribe уже реализован в `apps/web`).
- **CORS** — production-бандл: webview всегда same-origin (`tauri://localhost`), engine разрешает только этот origin. Dev — открыт для `localhost:*`.
- **Один пользователь на сессию** — нет multi-user / multi-tab concurrent scenarios. Если открыто два окна (теоретически) — они делят одну engine-инстанцию, поведение «оба видят одну очередь» приемлемо.
- **Persistence на engine-стороне.** Folder и очередь хранятся в `~/.config/scribd-dl/`. Tauri-store не используется.

## Outstanding questions (решить в `/ce-plan` или позже)

- **Chromium bundling vs auto-download.** Bundled → +~150MB DMG, но zero first-run friction. Auto-download → маленький DMG, но первый запуск качает Chromium несколько минут с прогресс-баром. Решение зависит от размера DMG после F5 — мерим, решаем.
- **Folder change во время Downloading.** Block кнопку (disabled state) или confirm dialog с отменой текущей задачи. Уточнить в F3.
- **Display title до известного заголовка.** Сейчас `displayTitle` в engine = URL до scrape. Передавать title во время scrape (требует `JobTitleResolved` event) или оставить URL — отдельный трек engine, не desktop.
- **WS reconnect / backend crash recovery.** В v1 — простая плашка `Backend disconnected` (уже есть в `apps/web`) + manual Restart. Auto-respawn — если будет реально мешать.
- **Idempotency retry.** Если задача упала на середине (часть страниц скачана), retry начинает с нуля — поведение engine, не desktop-only.
- **Dedup URL.** Engine не дедуплицирует — два paste одного URL = две задачи. Менять — отдельный трек engine.
- **CSP в webview.** Tauri 2.x требует явный CSP. Для prod — `default-src 'self' tauri:; connect-src 'self' http://localhost:* ws://localhost:*` (примерно). Уточнить в F2.
- **Quit-guard snapshot source.** Rust shim делает HTTP-запрос к sidecar или фронт сообщает Rust'у статус через event. HTTP проще, делается в F4.

## Ссылки

- Engine entrypoint: `packages/engine/engine.ts`
- Engine core: `packages/engine/src/service/DownloadEngine.ts`
- Wire contract: `packages/shared/src/http.ts`, `packages/shared/src/jobs.ts`
- Web SPA: `apps/web/` (uhtml v4 + nanostores islands)
- Desktop slot: `apps/desktop/` (README + placeholder package.json)
- Старый desktop план (готов к ревизии): `docs/plans/2026-06-09-007-feat-desktop-app-tauri-bun-plan.md`
- Старый Tauri бриф (superseded): `docs/brainstorms/2026-06-09-tauri-app-requirements.md`
- Tauri 2.x sidecar guide: https://v2.tauri.app/develop/sidecar/
