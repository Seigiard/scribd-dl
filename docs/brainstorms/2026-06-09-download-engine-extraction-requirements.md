---
title: "Extract DownloadEngine from CLI into a reusable Effect service"
status: completed
date: 2026-06-09
completed: 2026-06-09
type: feat
depth: standard
---

# Extract DownloadEngine from CLI into a reusable Effect service

## Summary

Сегодня `run.ts` → `App.execute(url)` это синхронный one-shot роутер: один CLI-аргумент → одно скачивание, дальше exit. Любой будущий UI (Ink-TUI, браузер через Tauri webview) требует, чтобы то же самое ядро умело принимать произвольные URL-ы по одному, держать очередь, эмитить события состояния, поддерживать remove/retry.

Этот документ описывает извлечение download-engine из CLI-роутинга в самостоятельный Effect-сервис `DownloadEngine` (`Context.Tag` + Layer) с явным контрактом. `run.ts` переписывается как первый и единственный (пока) клиент этого engine'а. Поведение CLI снаружи не меняется.

Цель — зафиксировать API, к которому потом без переписывания ядра подключаются другие UI и (когда они появятся) out-of-process клиенты через HTTP-адаптер.

---

## Problem Frame

Текущая архитектура — следствие исходной CLI-only задачи:

- `App.execute(url)` принимает один URL, роутит scribd → `ScribdDownloader.execute`, остальное → `UnsupportedUrl` tagged error.
- `App.executeBatch(urls)` — обвязка вокруг `execute` для file-mode.
- Состояние процесса = "ждём пока эта пачка скачается, потом exit". Нет понятия очереди, нет понятия job-а как состояния, нет потока событий.

Эта форма блокирует любой интерактивный UI:

- TUI должен показывать "Queued / Downloading / Downloaded / Failed" по каждой job-е — нужна Ref-модель состояния.
- TUI должен принимать новые URL-ы во время работы — нужен enqueue API.
- TUI должен показывать прогресс — нужен event stream.
- Retry упавшей job-ы — сегодняшний tagged error не retryable.

Перетряхивать `App` под каждый новый UI — это либо растущий запутанный класс, либо дублирование между entrypoint-ами. Чистое решение — один контракт, много клиентов.

---

## Requirements

- **R1.** `DownloadEngine` — это новый `Context.Tag` + `Layer.scoped`-Live с пятью методами: `enqueue`, `remove`, `retry`, `snapshot`, `events`.
- **R2.** `enqueue(text: string)` принимает сырой текст (single URL, paste-blob с мусором, содержимое batch-файла). Сама извлекает URL-ы tolerant-логикой `UrlListReader`, классифицирует scribd vs остальное, создаёт Job-и, кладёт supported в очередь, unsupported — сразу в Failed.
- **R3.** Возвращаемое значение `enqueue` — массив созданных Job-ей, чтобы UI мог отобразить их мгновенно, не дожидаясь первого события.
- **R4.** `remove(id)` удаляет Job только в статусе Queued. Для Downloading/Downloaded/Failed — `NotRemovable` tagged error.
- **R5.** `retry(id)` доступен только для Failed Job-ов с `retryable: true`. Переносит Job в конец очереди со статусом Queued. Для Failed с `retryable: false` (unsupported domain) — `NotRetryable` tagged error.
- **R6.** `snapshot: Effect<EngineSnapshot>` отдаёт текущее состояние всей очереди (массив Job-ей в порядке добавления). UI читает snapshot при подключении.
- **R7.** `events: Stream<JobEvent>` — поток событий через `PubSub.subscribe`. Снэпшот + подписка вместе не дают race-condition (сначала snapshot, потом subscribe из того же scope).
- **R8.** Внутри: `Queue<JobId>` + один воркер-fiber тащит по одной job-е, делегирует исполнение существующему `ScribdDownloader`. Concurrency фиксированно = 1.
- **R9.** `run.ts` переписан как клиент engine'а. Внешнее поведение CLI не меняется: те же argv, exit-коды, прогресс в stderr/stdout.
- **R10.** `UrlListReader` растворяется. Его tolerant per-line логика переезжает в `enqueue`. `run.ts` больше не различает "URL vs path-to-file" логикой engine'а — он различает на уровне CLI (это его job), а потом подаёт текст в `enqueue`.
- **R11.** Все существующие тесты остаются зелёными. Поведение CLI идентично сегодняшнему для всех текущих сценариев (single URL, batch file, unsupported URL).

---

## Key Decisions

### KD1. One-shot in-process, без daemon, без HTTP

Engine — это Layer, провайдится внутри того процесса, который его использует. Сегодня — CLI. Завтра — Ink-TUI (другой entrypoint, тот же Layer). Послезавтра — Tauri через тонкий HTTP-адаптер, который пишется отдельно.

Почему не daemon: lifecycle (autostart, single-instance lock, socket path, recovery) — значительный объём работы, которая сегодня не нужна. Очередь не делится между процессами — это приемлемо.

Почему не HTTP сразу: YAGNI. Никакого out-of-process клиента сегодня нет. HTTP добавляется когда появляется первый.

### KD2. Concurrency = 1, фиксированно

Один воркер-fiber тащит из `Queue<JobId>`. Соответствует и спеке TUI ("only one fake download runs at a time"), и текущему ограничению (один Puppeteer-браузер на процесс).

Не делаем настраиваемым. Если когда-нибудь понадобится — добавляется отдельной работой.

### KD3. Unsupported URL = Failed Job, не throw

Сегодня `App.execute` фейлит `UnsupportedUrl` tagged error. В event-driven модели это становится Job со статусом Failed, `reason: "Unsupported domain"`, `retryable: false`. CLI exit-code = 1 если в финальном snapshot есть хоть одна Failed-job (без разделения "это был unsupported или реальная ошибка" — наружу одинаково).

Это меняет семантику ошибок, но не наблюдаемое поведение CLI: сегодня тоже unsupported URL = non-zero exit.

### KD4. `enqueue` принимает текст, не URL

Каждый клиент даёт engine'у тот формат входа, который у него есть:
- CLI с argv-URL: `enqueue(argv[2])`
- CLI с batch-файлом: читает файл целиком, `enqueue(fileContents)`
- Будущий TUI с Ctrl+V: `enqueue(clipboardText)`

URL-extraction — обязанность engine'а. UI не пытается быть парсером. Это снижает риск дрейфа между UI (один TUI извлекает иначе чем другой).

### KD5. Snapshot + Stream вместо одного канала

Свежеподключившийся клиент сначала читает `snapshot` (получает полное текущее состояние), затем подписывается на `events`. Это решает классическую "missed updates" проблему чище, чем replay-stream.

Внутри: одновременно держим `Ref<Map<JobId, Job>>` (источник истины) и `PubSub<JobEvent>` (трансляция). Каждое внутреннее изменение обновляет Ref и публикует событие — одной helper-функцией, чтобы они не разъезжались.

### KD6. ScribdDownloader перестаёт быть оркестратором

Сегодня `ScribdDownloader.execute(url)` — full pipeline для одной URL-ы. После рефакторинга он остаётся, но вызывается **воркером engine'а** в цикле "взять job → execute → опубликовать результат". Никаких изменений в его scraping-логике не предполагается.

### KD7. App растворяется, либо становится thin CLI orchestrator

`App` сегодня — роутер `url → executor`. После переезда роутинга в `enqueue`, его обязанности сводятся к "взять argv, подать в engine, дождаться окончания". Это уже больше похоже на содержимое `run.ts`, чем на отдельный сервис.

Решение по итогу: `App.ts` удаляется, его остатки переезжают в `run.ts`. Если в имплементации обнаружится что `App` нужен (например, чтобы держать "I'm done" логику отдельно от Effect.cli обвязки) — оставляем, но в роли CLI-orchestrator-а, не роутера.

---

## High-Level Shape (directional, not the spec)

```
DownloadEngine (Context.Tag)
├─ Methods
│   ├─ enqueue(text)  →  Effect<readonly Job[]>
│   ├─ remove(id)     →  Effect<void, JobNotFound | NotRemovable>
│   ├─ retry(id)      →  Effect<void, JobNotFound | NotRetryable>
│   ├─ snapshot       →  Effect<EngineSnapshot>
│   └─ events         →  Stream<JobEvent>
│
├─ Internal state
│   ├─ Ref<Map<JobId, Job>>   — source of truth
│   ├─ Queue<JobId>            — pending work
│   ├─ PubSub<JobEvent>        — fan-out to subscribers
│   └─ worker fiber            — pulls from Queue, runs ScribdDownloader, publishes events
│
└─ Domain
    ├─ Job { id, url, domain, displayTitle, status, failure? }
    ├─ Status: Queued | Downloading | Downloaded | Failed
    └─ JobEvent: JobAdded | JobStarted | JobProgress | JobCompleted | JobFailed | JobRemoved
```

Точный shape `JobEvent` (один union vs несколько подтипов), модель прогресса (bytes? pages? фаза?), и форма `EngineSnapshot` — defer до имплементации.

---

## Out of Scope

### Deferred — отдельные треки, не блокеры

- **Ink-TUI как клиент engine'а** — следующий шаг после того как контракт зафиксирован. Отдельный entrypoint, тот же Layer.
- **HTTP/WebSocket адаптер** — добавляется когда появляется первый out-of-process клиент (браузер или Tauri webview). Повторяет ту же сигнатуру.
- **Tauri shell** — `docs/brainstorms/2026-06-09-tauri-app-requirements.md`, независимый track.
- **Bun executable + Chromium installer** — `docs/plans/2026-06-09-002-feat-bun-executable-with-chromium-installer-plan.md`, независимый track, может делаться параллельно. Engine extraction и executable distribution не пересекаются — один не нужен для другого.

### Outside this work's identity

- **Persistence очереди между запусками** — TUI-спека явно session-only, и текущий CLI тоже session-only по определению. Если когда-нибудь захочется — добавляется как `JobStore` Layer.
- **Concurrency > 1** — Puppeteer всё равно один браузер.
- **Cancel запущенной job-ы** — не нужно ни одному из планируемых клиентов. (CLI ждёт окончания. TUI на exit-time убивает весь процесс — "cancel active download" из TUI-спеки решается на уровне выхода из приложения, не через engine API.)
- **Pause/resume job-ы** — то же самое.

---

## Dependencies & Assumptions

- Effect.ts уже на месте (`@effect/cli`, `Layer`, `Context.Tag`, `Stream`, `PubSub`, `Queue`, `Ref`, `Fiber`). Никаких новых runtime-зависимостей не требуется.
- `ScribdDownloader` остаётся как есть в части scraping/PDF — рефакторинг touches только его call-site (вызывается из воркера, а не из `App`).
- Тесты используют `bun:test` + `Layer.succeed` моки. Engine тестируется через подмену `ScribdDownloader` Layer-ом, который эмулирует success/failure без браузера.
- Текущий tolerant URL-extraction из `UrlListReader.read` остаётся правильным поведением — просто переезжает в `enqueue`. Никаких изменений в правилах извлечения.

---

## Open Questions (defer to implementation)

- Точная форма `JobEvent`: один tagged union или несколько узких типов? Решается при реализации `PubSub`-публикации.
- `displayTitle` сразу после `enqueue`: derive из URL ("Scribd document 123") до того как scraper достанет настоящий, или пустой пока не появится? Лёгкий выбор, можно отложить.
- `App.ts` удаляется полностью или остаётся как thin CLI orchestrator? Решается по факту при переписывании `run.ts` — будет видно, есть ли что в нём держать отдельно.
- Поведение CLI когда argv пуст и stdin не tty: оставляем сегодняшнюю usage-error, или открываем interactive-paste режим? Скорее оставляем — paste это территория будущего TUI.
- Что `enqueue` делает с дубликатами в рамках одного вызова? (`enqueue("url1\nurl1")` — одна job или две?) TUI-спека говорит про дедуп между paste-операциями ("ignore if Queued/Downloading/Downloaded"). Здесь — решается в имплементации, дефолт "одна job на уникальный URL в текущем snapshot".

---

## Risks & Mitigations

- **Race между `snapshot` и `events`.** Если клиент сначала вызвал `snapshot`, а событие случилось до его `Stream.subscribe`, он его пропустит. Митигация: оба вызова — внутри одного `Effect.scoped` блока, причём `subscribe` берётся **до** `snapshot` (subscriber присоединяется к PubSub, потом читается Ref). Стандартный Effect-pattern; явно прописать в имплементации.
- **Воркер-fiber + interrupt.** При завершении CLI (`Ctrl+C`, нормальный exit) воркер должен корректно прерваться. Митигация: `Layer.scoped` Live с `Effect.acquireRelease` для воркера, как уже сделано в `PuppeteerSg`.
- **`ScribdDownloader` сегодня требует браузер через DI.** Engine при тестах должен мочь крутиться без браузера. Митигация: тесты engine'а провайдят `Layer.succeed(ScribdDownloader, mock)` — стандартный паттерн `bun:test`-а в репо.
- **Поведение CLI изменится незаметно.** Любой рефакторинг с риском дрейфа. Митигация: golden-tests на argv-сценариях (single URL success, single unsupported, batch file mixed) — снаружи поведение должно остаться байт-в-байт.

---

## Verification

Документ считается выполненным, когда:

- `DownloadEngine` Tag + `DownloadEngineLive` Layer существуют и покрыты unit-тестами (enqueue, remove, retry, snapshot, events stream).
- `bun start <url>` — успешный single-URL сценарий идентичен сегодняшнему.
- `bun start <batch-file>` — то же самое для batch.
- `bun start <unsupported-url>` — exit-code 1, читаемое сообщение об unsupported domain.
- `bun test` зелёный.
- `App.ts` либо удалён, либо явно зафиксирован как thin CLI orchestrator.
- `UrlListReader.ts` удалён (его логика внутри engine'а).

---

## Sources & Related

- `docs/brainstorms/tui-explanation.md` — клиентская спека-мотивация (источник требований по statuses, retry, remove, дедупу).
- `docs/brainstorms/2026-06-09-tauri-app-requirements.md` — параллельный future-UI track, потребитель будущего HTTP-адаптера.
- `docs/plans/2026-06-09-002-feat-bun-executable-with-chromium-installer-plan.md` — независимый distribution track.
- `docs/brainstorms/2026-06-09-effect-ts-rewrite-requirements.md` — Effect-rewrite, на котором этот шаг строится.
- `src/App.ts`, `src/service/ScribdDownloader.ts`, `src/utils/io/UrlListReader.ts`, `run.ts` — текущие файлы, затрагиваемые рефакторингом.
- `CLAUDE.md` — Effect/Layer DI конвенции, отсутствие singleton-ов в новом коде.
