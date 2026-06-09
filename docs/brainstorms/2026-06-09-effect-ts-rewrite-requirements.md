# Effect.ts structural rewrite downloader-слоя: requirements

**Дата:** 2026-06-09
**Статус:** Brainstorm → готово к `/ce-plan`
**Связано:** `run.js`, `src/App.js`, `src/service/ScribdDownloader.js`, `src/utils/**`, `docs/brainstorms/2026-06-09-tauri-app-requirements.md`, `docs/plans/2026-06-09-002-feat-bun-executable-with-chromium-installer-plan.md`

## Контекст и проблема

`scribd-dl` сейчас — JS+ESM на Bun с паттерном singleton-инстансов (`if (!Class.instance) Class.instance = this`, lowercase-экспорт). Архитектура работает, **реальных инцидентов нет**. В очереди два user-facing трека (Tauri-GUI и Bun-exe для распространения), оба расширяют поверхность downloader-слоя.

Эта работа — упреждающий structural refactor "на вырост", не реакция на боль. Цель — переписать downloader-слой на TypeScript + Effect, чтобы будущие треки (Tauri sidecar, ChromiumInstaller, Bun-exec config layering) интегрировались как Layer-зависимости вместо singleton-обёрток.

Это **первый** трек в очереди. Tauri и Bun-exec ждут — оба плана пересматриваются после landing этой работы.

## Цели и метрика успеха

**Готово, когда:**
- `bun start <url-or-file>` ведёт себя бит-в-бит как сегодня для всех трёх доменов (scribd, slideshare, everand), включая batch-режим, exit codes и прогресс-бары.
- `bun test` зелёный (тесты переписаны на `Layer.test`).
- `bun run lint` и `bun run format:check` зелёные на TS.
- Первая вертикаль (Scribd + все utils) живёт целиком на Effect; slideshare/everand вызываются через тонкую `Effect.tryPromise` обёртку, импортирующую старые `.js` файлы.
- Форма Layer/error/Schema валидирована и переносима: ревью первой вертикали даёт уверенность копировать паттерн на оставшиеся два downloader'а отдельной фазой.

**Не метрика:** "Effect везде", "ноль `.js` файлов в репо", "100% type coverage". Эти цели косвенно следуют, но не являются целью этой итерации.

## Решения зафиксированы

| Решение | Выбор | Источник |
|---|---|---|
| Очерёдность с Tauri и Bun-exec | Effect-rewrite первым, остальные ждут | self-use, нет urgency |
| Язык | TypeScript, полный переход | ценность Effect в типах |
| Глубина rewrite | Минимальный structural | felt pain отсутствует |
| Reliability hardening | Не делаем сейчас | YAGNI без инцидентов |
| Подход к миграции | One vertical first (Scribd) | валидация паттерна до массового применения |
| Граница первой вертикали | Широкая: Scribd + все utils как Layer-сервисы | utils переписываются один раз, не дважды |
| Slideshare / Everand | Остаются `.js`, вызываются через `Effect.tryPromise` | минимизация скоупа первой фазы |

## Скоуп

### В скоупе
- Полный переход репо на TypeScript: `.js` → `.ts`, strict `tsconfig.json` (`strict: true`, `exactOptionalPropertyTypes: true`).
- Первая вертикаль на Effect-TS целиком:
  - `run.ts` — entry с Effect-CLI или ручным argv parsing (см. Outstanding).
  - `src/App.ts` — роутер. Для scribd-URL — Effect-цепочка через новый Layer; для slideshare/everand — `Effect.tryPromise(() => import('./service/SlideshareDownloader.js').then(m => m.execute(url)))`.
  - `src/service/ScribdDownloader.ts` — единственный downloader, переписанный на Effect в этой фазе.
- Все utils как Layer-сервисы, переписаны разом:
  - `PuppeteerSg` — `Scope`-based, гарантированный `close()` через `Effect.acquireRelease`.
  - `PdfGenerator` — Layer-сервис.
  - `ConfigLoader` — через Effect `Config` + `Schema`. Форма принимает layered lookup (`defaults` ← `~/.config/scribd-dl/config.ini` ← execPath-adjacent `config.ini`) **без переписки** позже. На этой фазе используется только текущий `config.ini` next to `cwd` — остальные источники добавляет Bun-exec U4.
  - `DirectoryIo` — Layer-сервис.
  - `UrlListReader` — Layer-сервис, парсинг остаётся tolerance-режимным (skip empty/comments, regex-first-URL).
- Базовые tagged errors на доменных границах: `DownloadFailed`, `PdfGenerationFailed`, `ConfigInvalid`, `BrowserLaunchFailed`, `UrlListUnreadable`. Точный набор уточняется при переписке.
- Тесты переписаны с `spyOn`-синглтонов на `Layer.test`: mock-Layer для unit-тестов, live-Layer для smoke. Паттерн `test/App.test.js` со `spyOn(app, "execute")` заменяется на `Layer.merge(MockScribdDownloader, MockSlideshare, …)`.
- `cli-progress` сохраняется как есть — внутри Effect-кода используется как side-effect через `Effect.sync`.
- README обновляется: упоминание TS в "Conventions", обновлённая структура `src/`.

### Вне скоупа этой фазы
- **Reliability hardening:** `Schedule.retry`, exponential backoff, явные таймауты на сетевые операции. Без felt pain — это carrying cost без обратной связи.
- **Глубокие иерархии ошибок:** только один уровень tagged errors на доменных границах, без вложенных дискриминированных union.
- **Изменения CLI surface:** новые флаги, новые команды, structured-progress JSON output — это Tauri F3 trigger, не этот трек.
- **Миграция slideshare/everand на Effect:** отдельная вторая фаза после валидации паттерна. Старые `.js` файлы и `.js`-utils, которые они тянут, не удаляются.
- **Удаление `cli-progress`:** оборачивается, не выбрасывается.
- **`Schema` для всех границ:** Schema используется для `ConfigLoader` (где её ценность очевидна). Для остального — стандартные TS-типы. Можно добавить позже точечно.
- **Изменения output формата PDF, sanitize-filename логики, имени файла:** поведение фиксируется как есть.

### Отложено до появления felt pain
- Retry/timeout/backoff policies.
- Метрики, логи в structured формате.
- Параллелизм в batch-режиме.

### Outside this work's identity
- **Tauri-обёртка** — `docs/brainstorms/2026-06-09-tauri-app-requirements.md`, отдельный трек после этой работы.
- **Bun-executable + ChromiumInstaller** — `docs/plans/2026-06-09-002-feat-bun-executable-with-chromium-installer-plan.md`, отдельный трек. Эта работа закладывает форму `ConfigLoader`, совместимую с U4, но **не реализует** layered lookup и не вводит `ChromiumInstaller`.
- **Возможный Rust-rewrite downloader'а** — упомянут в Tauri-брейнштормe как далёкий future track, решение по нему откладывается до появления реальных сигналов (размер DMG, боль с Bun-sidecar).

## Архитектурная форма

Намеренно фиксируем направление, конкретика — в `/ce-plan`.

**Layer-сервисы вместо singleton-инстансов:**
```text
PuppeteerSgLive : Layer<PuppeteerSg, never, never>
PdfGeneratorLive : Layer<PdfGenerator, never, never>
ConfigLoaderLive : Layer<ConfigLoader, ConfigInvalid, never>
DirectoryIoLive : Layer<DirectoryIo, never, never>
UrlListReaderLive : Layer<UrlListReader, never, never>
ScribdDownloaderLive : Layer<ScribdDownloader, never, PuppeteerSg | PdfGenerator | ConfigLoader | DirectoryIo>
AppLive : Layer<App, never, ScribdDownloader | UrlListReader>
```

Main effect в `run.ts` собирает корневой Layer и запускает `App.execute(url) | App.executeBatch(file)`.

**Cleanup через Scope:**
`PuppeteerSg.getBrowser` оборачивается в `Effect.acquireRelease(launch, browser => Effect.promise(() => browser.close()))`. Текущий ручной `puppeteerSg.close()` в конце каждого downloader'а уходит — Scope сам закрывает браузер по выходу из use.

**Interop с legacy downloader'ами:**
В `App.ts` ветка для slideshare/everand:
```ts
Effect.tryPromise({
  try: () => import('./service/SlideshareDownloader.js').then(m => m.execute(url)),
  catch: (cause) => new DownloadFailed({ domain: 'slideshare', cause }),
})
```
Никакой Effect-обёртки над utils для них — старые downloader'ы продолжают использовать свои старые `.js` импорты utils. Старые `.js` utils-файлы **сохраняются параллельно новым `.ts`** до второй фазы.

**Coexistence двух `PuppeteerSg`-реализаций:**
Каждый downloader сам launches/closes браузер (CLAUDE.md: "each downloader calls puppeteerSg.close() when done"). Когда активен ScribdDownloader-Effect — живёт Layer-PuppeteerSg. Когда активен Slideshare/Everand-legacy — живёт singleton. В пределах одного URL — одна реализация. Конфликта нет.

## Фазы реализации (high-level)

Детали — в `/ce-plan`. Здесь только последовательность для проверки разумности.

1. **Setup TS.** Добавить `typescript`, `@types/bun`, `tsconfig.json`. Переименовать тестовые файлы как trial. Убедиться что `bun test`, `bun run lint`, `bun run format` работают на смешанном `.js`/`.ts`.
2. **Effect dependencies.** Добавить `effect` (+ опционально `@effect/cli`, `@effect/schema` если идут отдельным пакетом). Пин-версии на каретные диапазоны актуальной major.
3. **Layer-сервисы utils.** Переписать каждый из пяти utils-модулей как `.ts` Layer-сервис рядом со старым `.js`. Юнит-тесты пишутся параллельно через `Layer.test`. Старые `.js` остаются нетронутыми.
4. **ScribdDownloader.ts.** Переписать через Effect, потребляя новые Layer-сервисы. Тесты переписаны на `Layer.test`.
5. **App.ts роутер с interop.** Effect-цепочка для scribd, `Effect.tryPromise` для slideshare/everand.
6. **run.ts entry.** Собрать корневой Layer, запустить main effect. Принять решение `@effect/cli` vs ручной argv parsing.
7. **Smoke validation.** Ручной прогон на 2–3 реальных Scribd URL + 1 batch-файл с миксом доменов. CLI-поведение бит-в-бит как было.
8. **Cleanup .js-utils одиночек.** Если какой-то `.js`-util больше никем не используется (всё перешло на Effect) — удалить. Файлы, которые ещё нужны slideshare/everand — оставить до второй фазы.

Вторая фаза (миграция slideshare/everand) — отдельный трек, **не часть этой работы**. К ней возвращаемся после landing.

## Критерий "паттерн валидирован → можно копировать"

Перед открытием второй фазы (миграция slideshare/everand) должны быть верны все три:
- Зелёные `bun test` после переписки ScribdDownloader и всех utils.
- Ручной smoke на минимум 2 разных Scribd URL завершается с тем же PDF, что и текущая версия.
- Ревью Layer-определений (`*Live`) показывает, что форма читаема и копируется на slideshare/everand механически — без новых архитектурных решений.

Если третий критерий не выполнен — это сигнал переделать форму первой вертикали до начала второй фазы, не пытаться "потянуть как есть".

## Зависимости и предположения

- **Effect.ts** — актуальная major на 2026-06-09. API формы Layer/Effect/Scope в этой работе используется в рамках стабильного публичного API.
- **Bun 1.3.14** — TS-нативное исполнение через Bun, без `tsc`-build шага. Если в процессе оказывается, что Bun не справляется с какой-то TS-фичей — откатываем эту фичу, не строим build-pipeline.
- **`@puppeteer/browsers` и `puppeteer-core` swap (Bun-exec U1)** — НЕ происходит в этой работе. `PuppeteerSg.ts` использует тот же `puppeteer` пакет с bundled Chromium, что и сегодня. Swap делает Bun-exec фаза.
- **`oxlint` и `oxfmt`** — поддерживают TypeScript из коробки (oxc-stack). Если оказывается, что какое-то правило не работает на `.ts` — фиксируем в issue, не блокер.
- **Тесты на Puppeteer-зависимых слоях** — предположение: используем `Layer.test` с mock-Puppeteer (без реального Chromium). Если выяснится, что mock невозможен из-за сложности API — переключаем эти тесты в "integration" категорию, не блокер.
- **Slideshare/Everand остаются работоспособными во время фазы** — постоянно проверяется ручным smoke. Если interop через `Effect.tryPromise` ломает их (например, потеря progress output) — фиксим interop, не сдаваясь до полной миграции.

## Outstanding questions (решить в `/ce-plan` или по ходу)

- **`@effect/cli` или ручной argv parsing в `run.ts`?** Текущий entry — два аргумента (URL или путь к файлу), `existsSync(arg)` дискриминирует. `@effect/cli` даёт subcommands и help "из коробки", но имеет cost изучения. Решение — на этапе step 6 фаз.
- **Точный набор tagged errors.** Родится при переписке. Стартовый список (`DownloadFailed`, `PdfGenerationFailed`, `ConfigInvalid`, `BrowserLaunchFailed`, `UrlListUnreadable`) — гипотеза.
- **Уровень изоляции в `Layer.test`.** `Effect.runPromise` с mock-`PuppeteerSg` vs реальный Chromium в test-only Layer. Выбор зависит от того, насколько просто поднимать mock-страницу с детерминированным контентом.
- **Что делать с `page_html.txt` debug-артефактом.** Сейчас он работающий output PuppeteerSg. В Effect-версии — оставить, вынести под debug-flag, или удалить.
- **Структура папок `src/`.** Сохраняем текущую (`service/`, `utils/io/`, `utils/request/`) или переходим на feature-based (`scribd/`, `core/`)? Решение должно учитывать вторую фазу — если slideshare/everand тоже получат свои папки, текущая структура устаревает.
- **Где живут типы общих сущностей** (например, `DocumentMeta { title, id, pages }`). Один общий файл vs co-located с downloader'ом.

## Ссылки

- Effect.ts: https://effect.website
- `@effect/cli`: https://effect.website/docs/cli/introduction
- Текущий entry: `run.js`
- Текущий роутер: `src/App.js`
- Текущий ScribdDownloader: `src/service/ScribdDownloader.js`
- Текущие utils: `src/utils/io/*.js`, `src/utils/request/*.js`
- Текущие тесты и паттерн моков: `test/App.test.js`
- Tauri-трек: `docs/brainstorms/2026-06-09-tauri-app-requirements.md`
- Bun-exec трек: `docs/plans/2026-06-09-002-feat-bun-executable-with-chromium-installer-plan.md`
- Проектные конвенции: `CLAUDE.md`
