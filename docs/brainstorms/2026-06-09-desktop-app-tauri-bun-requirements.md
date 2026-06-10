# Desktop app (Tauri + Bun sidecar): requirements

**Дата:** 2026-06-09
**Статус:** Brainstorm → готово к `/ce-plan`
**Связано:** `tui.ts`, `run.ts`, `src/service/DownloadEngine.ts`, `src/tui/`
**Supersedes:** `docs/brainstorms/2026-06-09-tauri-app-requirements.md` (устарел: до Effect-refactor и Ink-TUI)

## Проблема и цель

Сейчас два клиента у `DownloadEngine`: CLI (`bun start <url>`) и Ink-TUI (`bun run tui`). UX интерактивного TUI устраивает, не устраивает обязательность терминала: «открой Terminal → набери команду → потом уже Cmd+V». Цель — десктоп-приложение, запускаемое из Spotlight/Dock, всё остальное поведение — копия Ink-TUI плюс native folder picker и system notifications.

**Метрика успеха:** от Spotlight до файла на диске — два жеста (запустить + `Cmd+V`), без терминала. Никакого регресса по сравнению с Ink-TUI.

## Пользователь и сценарий

Автор репо + узкий круг знакомых на macOS. Сценарий: наткнулся на Scribd-ссылку → Spotlight → `scribd-dl.app` → `Cmd+V` → файл в выбранной папке. Иногда — серия из нескольких ссылок подряд.

## In scope (v1)

**UX-паритет с Ink-TUI** (см. `docs/plans/2026-06-09-004-feat-ink-tui-client-plan.md` R3–R12):
- Окно — список задач. Колонки: title (или URL до известного title), статус, действие.
- Статусы: `Queued`, `Downloading`, `Downloaded`, `Failed` (с причиной).
- `Cmd+V` в окне → текст буфера передаётся в `engine.enqueue` (engine сам извлекает URL, классифицирует scribd/unsupported).
- Если в буфере не найдено валидных URL → транзиентная плашка `No links found in clipboard` ~2с.
- `Remove` — только на `Queued`. `Retry` — только на `Failed` с `retryable=true` (unsupported-domain — без Retry).
- Quit-guard: при попытке закрыть окно с активными `Queued`/`Downloading` задачами — confirm dialog `Идёт скачивание / задачи в очереди. Закрыть?`. `Close anyway` → cancel engine scope, exit.
- Session-only state: при закрытии очередь чистится.

**Дополнительно в v1 (поверх Ink-TUI):**
- **Native folder picker** в шапке окна. Текущий output folder виден, кнопка `Change` → системный диалог. Выбор персистится между запусками через Tauri app data store.
- **macOS system notifications** на `Downloaded` и `Failed` (когда окно не в фокусе). Click по нотификации фокусирует окно.

**Распределение:**
- DMG-бандл `scribd-dl.dmg`, при первом запуске пользователь увидит Gatekeeper-предупреждение (приемлемо для текущего круга).

## Out of scope (v1)

- **Per-job progress** (page N/M прогресс-бар). Engine сейчас не эмитит `JobProgress` events — отдельный трек в `DownloadEngine`, не блокирует v1. UI рисует только дискретный статус.
- **Drag-and-drop файлов** со списком URL.
- **Global hotkey, tray app, auto-watch буфера.**
- **Параллельные скачивания** (engine — один воркер-фибер).
- **История между сессиями.**
- **UI для filename strategy / rendertime.** В v1 эти параметры фиксируются дефолтами из `DEFAULT_CONFIG` (`filename=title`, `rendertime` как в текущем CLI). Кнопок в UI нет.
- **Code signing / notarization.** Можно добавить отдельной фазой когда круг распространения вырастет — это разовая настройка Apple Developer аккаунта + CI, не код.
- **Windows / Linux билды.** Код пишется cross-platform-ready (без macOS-only API в фронте/Rust-shim), сборка и тест только под macOS.
- **Auto-update.**

## Архитектура

Намеренно фиксируем — это технический брейншторм.

### Топология процессов внутри `.app` бандла

```
scribd-dl.app
│
├─ Tauri wrapper (Rust binary)             ←── тонкий фронт (launcher)
│    ├─ WebView (WKWebView on macOS)
│    │    └─ React SPA (Vite build, static assets)
│    │         │  fetch + WebSocket → localhost:NNNN
│    │         ▼
│    └─ Tauri sidecar API: spawn/manage bun-engine
│
└─ bun-engine (Bun binary + bundled JS)    ←── бэк (engine host)
     └─ Effect Layer stack:
         ConfigLoaderLive (from launch args)
         DirectoryIoLive
         PdfGeneratorLive
         PuppeteerSgLive (scoped)
         ScribdDownloaderLive
         DownloadEngineLive
         + HttpServerLive (NEW)
```

**Engine не дублируется.** Тот же `DownloadEngine` Layer, тот же `ScribdDownloader`, тот же `PuppeteerSg`. Desktop — **третий клиент** того же сервиса (после `run.ts` и `tui.ts`).

### HTTP/WS контракт между webview и engine

REST commands + WebSocket events, мап 1:1 на методы `DownloadEngine`:

| HTTP                          | Engine method                  |
| ----------------------------- | ------------------------------ |
| `GET  /snapshot`              | `engine.snapshot`              |
| `POST /enqueue` body: `{text}`| `engine.enqueue(text)`         |
| `DELETE /jobs/:id`            | `engine.remove(id)`            |
| `POST /jobs/:id/retry`        | `engine.retry(id)`             |
| `WS   /events`                | subscribe to `engine.events` Stream, push frame per event |

Сериализация: JSON. Errors → HTTP 4xx с `{error, reason}`. WS-фреймы — те же event-объекты, что и в `engine.events`.

**Почему REST + WS, а не один JSON-RPC канал:** для curl/Postman-debug нужен plain HTTP, WS отвечает только за push-нотификации, не за RPC.

### Port discovery

- Tauri sidecar API запускает bun-бинарь с CLI-аргументами (output folder из persistence, filename/rendertime — дефолты).
- bun-engine биндится на **random free port**, пишет в stdout одну строку `READY port=NNNN` и продолжает работать.
- Rust shim парсит stdout до этой строки, читает port, передаёт в webview через Tauri command (или window global `window.__BACKEND_URL__`).
- После `READY` stdout/stderr engine пишутся в Console-logfile внутри `~/Library/Logs/scribd-dl/` для отладки. Webview больше с stdout не общается.

### Lifecycle bun-сайдкара

- Spawn — на `app.on('ready')` Tauri.
- Kill — на `app.on('window-all-closed')`. Tauri sidecar API делает clean shutdown (SIGTERM → wait → SIGKILL fallback).
- Если sidecar упал между запросами — webview видит fetch-failure → показывает плашку «Backend disconnected» + кнопку `Restart`. Авто-respawn в v1 НЕТ (упростим, фиксим если будет реально мешать).

### Frontend stack

- **Vite + React 19 + TypeScript** — стандартный Tauri 2.x шаблон.
- **shadcn/ui + Tailwind CSS** — UI-кит. Web-app look, не претендуем на «native Mac feel».
- **State:** `useState`/`useReducer` + WebSocket-хук на `/events`. Без TanStack Query / zustand — состояние полностью производное от server-side snapshot, нет client-side cache invalidation проблемы.
- **Engine state bridge — тот же паттерн что `useEngineState` в Ink-TUI**, только источник — WS вместо in-process Stream:
  1. На mount: `GET /snapshot` → `setState(snapshot)`.
  2. Open WS `/events`.
  3. На каждое event: либо merge in-place (если в event достаточно данных), либо re-fetch `GET /snapshot` (проще на старте, заменим если будет дорого).
  4. На unmount: close WS.
  - Snapshot-then-subscribe ordering: открыть WS, дождаться `open`-события, потом fetch snapshot. Engine PubSub буферизует события подписавшимся клиентам (как в `engine.events` Stream).

### Native bridge (Tauri commands)

Минимальный набор:
- `pick_folder()` → системный folder picker, возвращает path.
- `read_persisted_folder()` / `write_persisted_folder(path)` → Tauri app data store.
- `notify(title, body, jobId)` → macOS notification. Click handler фокусирует окно через `window.show()`.
- Всё остальное (queue ops) — через HTTP/WS к engine, не через Tauri commands.

### Bun-engine как новый entrypoint

- Новый файл `engine.ts` рядом с `run.ts` и `tui.ts`. Парсит CLI-флаги (`--output`, `--filename`, `--rendertime`, `--port` опционально для dev), строит тот же Layer stack что `run.ts`, плюс **новый** `HttpServerLive` Layer.
- `HttpServerLive` использует `Bun.serve` (нативный, без deps), реализует роуты выше, мапит на injected `DownloadEngine`.
- `bun run engine` для dev-режима (фронт-Vite в браузере на `localhost:5173`, бэк-bun на любом порту → CORS открыт для `localhost:*` в dev, закрыт в production-бандле — webview всегда same-origin не нужен CORS).

### Dev workflow: браузер первый, Tauri вторым

Архитектура `Bun HTTP server + SPA + REST/WS` идентична в dev и prod — Tauri это **только** webview-host и native-bridge поверх готового SPA. Это даёт принципиальный dev-режим:

1. **Фаза разработки UI (F1):** `bun run engine` в одном терминале, `vite dev` в другом, открываем `http://localhost:5173` в Chrome. Полный DevTools, Vite HMR, ноль Rust-сборок, ноль Tauri-зависимостей. Здесь итерируем UI до зелёного.
2. **Фаза упаковки (F2+):** `bun tauri init` оборачивает уже стабильный SPA. В `bun tauri dev` Vite + webview работают так же, HMR сохраняется внутри окна. Native bits (folder picker, notifications, quit guard) дописываются на готовый UI.

Прототип = финальный код. Никакого выкидного html-мокапа.

## Фазы реализации

Каждая фаза — независимо проверяемый кусок. Не двигаемся к N+1, пока N не сдан.

### F0 — `engine.ts` HTTP server + WS events

**Делаем:** новый entrypoint `engine.ts`, новый `src/service/HttpServerLive.ts` (или `src/server/`). Bun.serve рутит запросы в `DownloadEngine`. WS `/events` подписывается на `engine.events` Stream. Тесты: запустить engine, через `fetch` сделать `POST /enqueue` со scribd URL, через WS поймать `JobStarted`/`JobCompleted`.

**Приёмка:**
- `bun run engine --port 4747 --output /tmp/test` поднимает сервер, пишет `READY port=4747` в stdout.
- `curl -X POST localhost:4747/enqueue -d '{"text":"https://www.scribd.com/document/.../X"}'` возвращает `{jobs: [{id, url, status: "Queued"}]}`.
- `websocat ws://localhost:4747/events` после enqueue видит поток событий.
- `bun test` — новые тесты HTTP/WS зелёные, существующие 56/56 не сломаны.
- `bun run lint` чистый.

### F1 — SPA в браузере: весь UI кончается здесь

**Делаем:** Vite + React 19 + Tailwind + shadcn/ui setup в директории `app/` (или подобной). Все компоненты: `App`, `Header` (folder text + disabled `Change folder` stub-кнопка), `Queue`, `QueueItem`, transient `StatusBar`, `ExitConfirm` (модалка, но не привязана к window-close — пока просто кнопка для тестирования). `useEngineState()` хук: на mount открывает WS `/events` → ждёт `open` → `GET /snapshot` → setState; на каждое event re-fetch snapshot. Paste handler на `window`. Click handlers на Remove/Retry → `fetch DELETE/POST` на endpoint. Запуск: `bun run engine --port 4747` + `vite dev`, открыть `http://localhost:5173` в Chrome.

**Приёмка:**
- `vite dev` поднимает SPA, Vite HMR работает (правка `.tsx` → мгновенное обновление в Chrome).
- Paste валидного scribd URL в окне → задача появляется, проходит `Queued → Downloading → Downloaded`, файл на диске.
- Paste blob'а с тремя URL → три строки.
- Paste junk → плашка `No links found in clipboard`, через 2с убирается.
- Paste unsupported → строка Failed без Retry-кнопки.
- Remove на Queued → строка исчезает.
- Retry на Failed (offline→online сценарий) → проходит до Downloaded.
- Перезагрузка страницы (Cmd+R) → snapshot восстанавливается, активные задачи продолжают скачиваться.
- Vitest + Testing Library: компонентные тесты на `QueueItem`, `useEngineState` (с mocked WS), paste handler.
- `bun test` и `bun run lint` зелёные.
- `bun run format` чистый.

**На выходе F1 — полностью рабочий desktop UX, доступный по `localhost:5173`. Можно идти на F2 уверенно.**

### F2 — Tauri scaffold + bun sidecar handshake

**Делаем:** `bun tauri init` в корне (или в подпапке). Конфиг `tauri.conf.json`: `build.beforeDevCommand = "vite dev"`, `build.devUrl = "http://localhost:5173"`, `build.beforeBuildCommand = "vite build"`, `build.frontendDist = "../app/dist"`. Объявляем bun-engine как sidecar. Rust shim: spawn sidecar на app-ready, парсит `READY port=NNNN`, прокидывает port в webview через Tauri command `get_backend_url()` (которую React вызывает на mount вместо хардкода).

**Приёмка:**
- `bun tauri dev` поднимает окно, в нём — тот же SPA что в F1, всё работает.
- React в окне получает port от Tauri command, подключается к sidecar engine.
- Vite HMR продолжает работать внутри Tauri-окна (правка `.tsx` → webview обновляется).
- Закрытие окна → bun-процесс убит (`ps aux | grep bun` пусто), Chromium Puppeteer тоже умер.
- Никаких регрессов UX по сравнению с F1.

### F3 — Native bridge: folder picker + persistence + notifications

**Делаем:** Tauri commands `pick_folder`, `read_persisted_folder`, `write_persisted_folder` (через tauri-plugin-store или tauri-plugin-fs + tauri-plugin-dialog), `notify`. В шапке React — кнопка `Change folder` живая: invoke `pick_folder` → если выбрано → write to store + рестарт engine sidecar с новым `--output`. В `useEngineState` — слушаем `JobCompleted`/`JobFailed`, если `document.visibilityState === 'hidden'` → invoke `notify`.

**Приёмка:**
- Первый запуск: folder = `~/Downloads`.
- Change → системный folder picker → выбор → store updated → следующий paste идёт в новую папку.
- Закрыть/открыть app → выбранная папка та же.
- Folder change во время `Downloading`: блокируется (disabled state на кнопке) — решено в пользу простоты (см. Outstanding).
- Свернуть окно → дождаться Downloaded → видна macOS notification.
- Click на notification → окно поднимается в фокус.
- В фокусе → notification не показывается (только UI меняется).
- Failed → notification с reason в body.

### F4 — Quit guard

**Делаем:** перехват `tauri::WindowEvent::CloseRequested` в Rust. Если `GET /snapshot` через Tauri command возвращает active jobs → native confirm dialog `Cancel` / `Close anyway`. `Close anyway` → kill sidecar → exit.

**Приёмка:**
- Пустая очередь → закрывается без диалога.
- `Downloading` → диалог. Cancel → окно остаётся.
- `Close anyway` → sidecar убит, нет zombie Chromium.

### F5 — Packaging + smoke test на чистой macOS

**Делаем:** `bun build --compile --target=bun-darwin-arm64` engine → бинарь. `bun tauri build` → `.app` + `.dmg`. Puppeteer Chromium — bundled или auto-download (решить по факту размера, см. Outstanding). Проверяем на чистой macOS-машине без dev-окружения.

**Приёмка:**
- DMG ставится на чистую macOS.
- Launchpad → окно открывается → backend connect успешен.
- Полный сценарий paste → Downloaded работает.
- Folder picker, notifications, quit guard работают.
- Размер DMG зафиксирован в README — входной сигнал для решения «нужен ли Rust-rewrite engine».

## Зависимости и предположения

- **Bun 1.3.14+** — runtime для engine. `bun build --compile --target=bun-darwin-arm64` создаёт self-contained binary для sidecar (~50MB).
- **Tauri 2.x** — wrapper. Использует system WebView (WKWebView на macOS), не Chromium → wrapper-часть бандла малая (~5-10MB).
- **Puppeteer + Chromium** — engine продолжает использовать существующий `PuppeteerSg`. Chromium либо bundled в DMG (~150MB), либо auto-download при первом запуске (текущее поведение `puppeteer` package). Решение откладываем до F8.
- **Engine `DownloadEngine.events` PubSub буферизует события подписавшимся клиентам** — это уже свойство существующего engine (R7 plan: snapshot-then-subscribe ordering), не новое.
- **CORS** — production-бандл: webview всегда same-origin (`tauri://localhost`), engine разрешает только этот origin. Dev — открыт для `localhost:*`.
- **Один пользователь на сессию** — нет multi-user / multi-tab concurrent scenarios. Если открыто два окна (теоретически) — они делят одну engine-инстанцию, поведение «оба видят одну очередь» приемлемо.

## Outstanding questions (решить в `/ce-plan` или позже)

- **Chromium bundling vs auto-download.** Bundled → +~150MB DMG, но zero first-run friction. Auto-download → маленький DMG, но первый запуск качает Chromium несколько минут с прогресс-баром. Решение зависит от размера DMG после F8 — мерим, решаем.
- **Folder change во время Downloading.** Block кнопку или confirm dialog с отменой текущей задачи. Уточнить в F5.
- **Display title до известного заголовка.** Сейчас `displayTitle` в engine = URL до scrape. Передавать title во время scrape (требует `JobTitleResolved` event в engine) или оставить URL — отдельный трек.
- **WS reconnect / backend crash recovery.** В v1 — простая плашка «Backend disconnected» + manual Restart. Auto-respawn — если будет реально мешать.
- **Idempotency retry.** Если задача упала на середине (часть страниц скачана), retry начинает с нуля — это поведение engine, не desktop-only. Зафиксировано.
- **Dedup URL.** Engine на сегодня не дедуплицирует (R7 deferred в Ink-TUI плане). Desktop унаследует то же поведение — два paste одного URL = две задачи. Менять — отдельный трек engine.
- **CSP в webview.** Tauri 2.x требует явный CSP. Для prod — `default-src 'self' tauri:; connect-src 'self' http://localhost:* ws://localhost:*` (примерно). Уточнить в F2.

## Ссылки

- Текущий engine: `src/service/DownloadEngine.ts`
- Текущий TUI plan: `docs/plans/2026-06-09-004-feat-ink-tui-client-plan.md` (источник UX-паритета)
- Старый Tauri бриф (superseded): `docs/brainstorms/2026-06-09-tauri-app-requirements.md`
- Tauri 2.x sidecar guide: https://v2.tauri.app/develop/sidecar/
- shadcn/ui: https://ui.shadcn.com/
