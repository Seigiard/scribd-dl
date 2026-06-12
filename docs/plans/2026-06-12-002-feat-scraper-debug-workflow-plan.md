---
date: 2026-06-12
type: feat
origin: docs/brainstorms/2026-06-12-scraper-debug-workflow-requirements.md
depth: standard
---

# feat: Scraper Debug Workflow

## Summary

Ввести тонкий `Scraper` контракт (engine-internal Context.Tag + registry), переписать `DownloadEngine.classify` через registry-lookup, параметризовать `PuppeteerSg` factory function для headful-режима, добавить `debug?: boolean` параметр в `Scraper.execute` (закрывает OQ1 из origin: контракт engine-internal, не shared), и собрать отдельный entry-point `bun run debug <url>` поверх минимального Layer-стека без HTTP/WS/persist. ScribdDownloader при `debug=true` дампит HTML страницы и оставляет `_temp/` для разбора; headful + bumped rendertime управляются подменой Layer-ов в runner-е, не параметрами в execute.

---

## Problem Frame

Сейчас дебажить Scribd-парсер на конкретном URL (Pathfinder, Shadowdark — см. `docs/brainstorms/2026-06-11-render-artifacts-shadowdark-bug.md`) можно только правкой констант: `headless: true` в `packages/engine/src/utils/request/PuppeteerSg.ts:76`, `rendertime: 100` в `packages/engine/src/utils/io/ConfigLoader.ts:11`, плюс закомментировать `directoryIo.remove(tempDir)` в `ScribdDownloader.ts:253`. Это медленно, теряется при коммите, и каждый раз поднимает весь engine с HTTP/WS/persist слоями.

`DownloadEngine.classify` (`packages/engine/src/service/DownloadEngine.ts:46`) хардкод через `scribdRegex.DOMAIN.test(url)` — точка расширения под второй scraper отсутствует. ScribdDownloader — singleton-ish зависимость в `DownloadEngineLive`.

Архитектурно ScribdDownloader уже почти соответствует thin Scraper контракту: его `execute(url, folder, onEvent)` принимает URL+папку и возвращает `Effect<void, DomainError>`. Не хватает `canHandle` и registry поверх.

---

## Requirements (origin trace)

- **R1.** Тонкий `Scraper` контракт — добавляется `debug?: boolean` параметр (origin G2, NG2)
- **R2.** ScribdDownloader реализует контракт, при `debug=true` владеет своей debug-механикой (origin A2, NG1)
- **R3.** `bun run debug <url>` запускается изолированно: без HTTP/WS, без JobStore, без ConfigStore persist (origin G3)
- **R4.** Сохранить идиомы: Effect+Layer DI, factory functions для параметризации (как `makeConfigLoader`), `bun:test` + Layer mocks (origin G4)
- **R5.** Не ломать существующее поведение engine — `bun run engine` работает идентично, существующие тесты проходят (origin G2)
- **R6.** Pathfinder и Shadowdark URL дебажатся одной командой `bun run debug <url>` без правки констант (origin G1)

---

## Key Technical Decisions

### KTD1. `Scraper` контракт живёт engine-internal (`packages/engine/src/service/Scraper.ts`)

**Решение:** не выносить в `@scribd-dl/shared`. Клиенты (TUI/Web/Desktop) общаются с engine через HTTP/WS и не имеют доступа к scrapers напрямую. Wire contract (`Job`, `JobDomain`, `JobEvent`) остаётся в shared.

**Закрывает:** origin OQ1.

### KTD2. Registry — массив `Scrapers: ReadonlyArray<Scraper>` через Context.Tag

`Scrapers` — отдельный Tag с `Layer.succeed(Scrapers, [scribd])`. `DownloadEngine.classify` ищет `scrapers.find(s => s.canHandle(url))?.id ?? "unsupported"`. Порядок в массиве — приоритет (первый matching wins).

**Альтернатива:** Map<JobDomain, Scraper>. Отверг — порядок неявный, классификация по URL требует итерации с `canHandle`, не lookup по ключу.

### KTD3. `PuppeteerSg` параметризация через factory function

`makePuppeteerSgLive({ headful: boolean })` — функция, возвращающая `Layer`. Идиома уже используется в `makeConfigLoader` (`packages/engine/src/utils/io/ConfigLoader.ts:15`). Существующий `PuppeteerSgLive` остаётся как `makePuppeteerSgLive({ headful: false })` — обратная совместимость для `engine.ts` и существующих тестов.

**Альтернатива:** новый `DebugConfig` Context.Tag, читаемый внутри `PuppeteerSg`. Отверг per origin NG1 — каждый scraper владеет своими debug-побочками, общий debug-сервис не нужен.

### KTD4. Rendertime override через подмену `ConfigLoader` Layer-а

Runner подаёт `makeConfigLoader({ ...DEFAULT_CONFIG, scribd: { rendertime: 5000 } })`. `ScribdDownloader.execute` читает `config.scribd.rendertime` (`ScribdDownloader.ts:228`) — никаких изменений в самом scraper не нужно.

**Альтернатива:** передавать `rendertime` через `debug`-параметр или новый opts. Отверг — `ConfigLoader` уже отвечает за конфиг, дублировать через параметр некрасиво.

### KTD5. `debug=true` поведение в ScribdDownloader — minimal set

При `debug=true`:
1. После успешного `processPage` дампится HTML страницы (`await page.content()`) в `${folder}/${safeIdentifier}.debug.html` через `Bun.write` (inline — закрывает OQ5).
2. В multi-dimension ветке `directoryIo.remove(tempDir)` пропускается — `_temp/` остаётся для разбора.

Что НЕ делает scraper:
- headful — управляется через `makePuppeteerSgLive({ headful })` извне
- rendertime bump — через подмену `ConfigLoader` извне

Это даёт чистое разделение: scraper владеет своими "побочками" (HTML, temp), окружение (browser mode, config) подменяется через Layer.

### KTD6. Runner расположение — `packages/engine/debug.ts`

Рядом с `engine.ts`, тот же workspace `@scribd-dl/engine`. Не отдельный workspace. Простой entry-point, не растёт в самостоятельную сущность.

**Закрывает:** origin OQ4.

### KTD7. `DownloadEngine` зависит от `Scrapers`, не от конкретного `ScribdDownloader`

Меняем зависимость `DownloadEngineLive` с `ScribdDownloader | ...` на `Scrapers | ...`. Worker (`DownloadEngine.ts:358-395`) находит scraper через registry и зовёт `scraper.execute(url, folder, makeOnEvent(id), false)` (production debug=false). Это закрывает Goal G2 brainstorm-а — второй scraper в будущем добавляется одной строкой в registry.

---

## High-Level Technical Design

### Layer composition

```
                    ┌────────────────────────────────┐
                    │   ConfigLoader (debug)         │  ← makeConfigLoader({rendertime: 5000})
                    │   PuppeteerSg (headful)        │  ← makePuppeteerSgLive({headful: true})
                    │   PdfGeneratorLive             │
                    │   DirectoryIoLive              │
                    │   TitleResolverLive            │
                    └────────────────────────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────────┐
                    │   ScribdDownloaderLive         │
                    │   (implements Scraper)         │
                    └────────────────────────────────┘
                                  │
                                  ▼
              ┌─────────────────────────────────────┐
              │   Scrapers = [scribd]               │
              │   (Layer.succeed)                   │
              └─────────────────────────────────────┘
                       │                  │
        ┌──────────────┘                  └──────────────┐
        ▼                                                 ▼
┌──────────────────┐                              ┌──────────────────┐
│  debug.ts        │                              │  engine.ts       │
│  (runner)        │                              │  (production)    │
│                  │                              │                  │
│  url → registry  │                              │  + ConfigStore   │
│  → scraper       │                              │  + JobStore      │
│    .execute      │                              │  + HttpServerLive│
│    (debug=true)  │                              │  → DownloadEngine│
└──────────────────┘                              └──────────────────┘
```

### Scraper contract shape (directional)

```
interface Scraper {
  readonly id: JobDomain                    // "scribd" | (future: "slideshare" | ...)
  readonly canHandle: (url: string) => boolean
  readonly execute: (
    url: string,
    folder: string,
    onEvent: OnEvent,
    debug?: boolean,
  ) => Effect<void, DomainError>
}
```

Реализация деталей — в Implementation Units.

---

## Implementation Units

### U1. Scraper Tag + Scrapers registry Tag

**Goal:** Завести `Scraper` интерфейс/Context.Tag и `Scrapers` registry Tag в engine-internal слое.

**Requirements:** R1, R4

**Dependencies:** none

**Files:**
- `packages/engine/src/service/Scraper.ts` (new) — `Scraper` interface, Context.Tag, `Scrapers` registry Tag

**Approach:**
- `interface Scraper`: `id: JobDomain`, `canHandle: (url) => boolean`, `execute: (url, folder, onEvent, debug?: boolean) => Effect<void, DomainError>`.
- `class Scraper extends Context.Tag("Scraper")<Scraper, Scraper>()` — для удобства когда нужен один scraper. Опционально, можно не делать.
- `class Scrapers extends Context.Tag("Scrapers")<Scrapers, ReadonlyArray<Scraper>>()` — registry Tag.
- `DomainError` — union существующих tagged errors из `packages/engine/src/errors/DomainErrors.ts` (UnsupportedUrl, PageLoadFailed, PageProcessFailed, PdfGenerationFailed, PdfMergeFailed, DirectoryIoFailed) — переиспользую существующий `ScribdError` (alias) или вынесу общий union. Решить при имплементации, не блокер.

**Patterns to follow:** `ScribdDownloader.ts:31-35` (interface + Context.Tag pattern), `ConfigLoader.ts:8` (Tag declaration).

**Test scenarios:** Test expectation: none — pure type declarations, behavior покрывается в U2/U4.

**Verification:** TypeScript компилируется, `Scraper` и `Scrapers` экспортируются.

---

### U2. ScribdDownloader реализует Scraper контракт + debug behavior

**Goal:** Добавить `canHandle` и `id`, расширить `execute` параметром `debug?: boolean`. Реализовать debug-побочки: dump HTML, keep `_temp/`.

**Requirements:** R1, R2, R5, R6

**Dependencies:** U1

**Files:**
- `packages/engine/src/service/ScribdDownloader.ts` (modify) — расширить `ScribdDownloaderService`, добавить `id`, `canHandle`, `debug` параметр в `execute`
- `packages/engine/test/ScribdDownloader.test.ts` (modify) — добавить сценарии для debug-флага

**Approach:**
- Расширить `ScribdDownloaderService` интерфейс: `id: "scribd"`, `canHandle: (url) => boolean` (использует существующие `scribdRegex.DOMAIN.test`), `execute(url, folder, onEvent, debug?: boolean)`.
- В `ScribdDownloaderLive`:
  - После `processPage` + получения `meta`: if `debug === true`, `Bun.write(\`${folder}/${safeIdentifier}.debug.html\`, await page.content())` — обёрнуто в `Effect.promise`. Файлуем имя через тот же `safeIdentifier` что используется для PDF.
  - В multi-dimension ветке: `if (!debug) yield* directoryIo.remove(tempDir)`. При `debug=true` temp остаётся.
- Существующая сигнатура `execute(url, folder, onEvent)` совместима — `debug` опциональный с дефолтом `undefined` (falsy).
- `ScribdDownloaderLive` зависимости не меняются.

**Patterns to follow:** `ScribdDownloader.ts:217-256` (Effect.scoped + acquireRelease для page), Bun-native I/O без Node-imports.

**Execution note:** Test-first для debug-веток — добавь failing тесты на dump HTML и keep `_temp/` до изменения `execute`.

**Test scenarios:**
- **#given** `debug=true`, single-dim run; **#when** execute; **#then** `Bun.write` (или эквивалентный mock fs.write) вызван с путём `${folder}/${safeIdentifier}.debug.html`. (Покрывает R6: dump HTML)
- **#given** `debug=true`, multi-dim run (разные dimensions); **#when** execute; **#then** `state.dirRemove` НЕ вызван для `tempDir`. (Покрывает R6: keep temp)
- **#given** `debug=false` (default), multi-dim run; **#when** execute; **#then** `state.dirRemove` вызван для `tempDir`. (Регрессия: prod behavior не меняется, покрывает R5)
- **#given** `debug=undefined` (omitted), single-dim run; **#when** execute; **#then** `Bun.write` HTML НЕ вызван. (Регрессия: omitted == false)
- **#given** scribd URL `https://www.scribd.com/document/123/foo`; **#when** `canHandle(url)`; **#then** returns `true`.
- **#given** non-scribd URL `https://example.com/foo`; **#when** `canHandle(url)`; **#then** returns `false`.

**Verification:** Все существующие 11 тестов в `ScribdDownloader.test.ts` проходят без изменения, 4 новых debug-сценария + 2 canHandle-сценария проходят.

---

### U3. PuppeteerSg factory для headful-параметризации

**Goal:** Заменить `PuppeteerSgLive` константу factory-функцией `makePuppeteerSgLive({ headful })`. Сохранить обратную совместимость через экспортируемый дефолт.

**Requirements:** R4, R5

**Dependencies:** none

**Files:**
- `packages/engine/src/utils/request/PuppeteerSg.ts` (modify) — добавить factory, сохранить дефолтный экспорт
- `packages/engine/test/PuppeteerSg.test.ts` (modify) — добавить сценарий проверки `headful` опции

**Approach:**
- Добавить `interface PuppeteerSgOptions { readonly headful: boolean }`.
- `buildLaunchOptions(opts: PuppeteerSgOptions)` — `headless: !opts.headful`. Остальная логика (CI, no-sandbox, executablePath) без изменений.
- `makePuppeteerSgLive = (opts: PuppeteerSgOptions): Layer<PuppeteerSg, never, never> => Layer.scoped(...)` — копия текущего `PuppeteerSgLive` тела, использующая `buildLaunchOptions(opts)`.
- `export const PuppeteerSgLive = makePuppeteerSgLive({ headful: false })` — сохраняет обратную совместимость.
- `engine.ts` не меняется (использует `PuppeteerSgLive`).

**Patterns to follow:** `ConfigLoader.ts:15` (`makeConfigLoader` factory pattern).

**Test scenarios:**
- **#given** `makePuppeteerSgLive({ headful: true })`; **#when** Layer провайдится и launchOptions проверяются; **#then** `headless === false`. (Понадобится либо моk `puppeteer.launch` для capture аргумента, либо unit-тест чистой функции `buildLaunchOptions`.)
- **#given** `makePuppeteerSgLive({ headful: false })`; **#when** launchOptions проверяются; **#then** `headless === true`.
- **#given** `PuppeteerSgLive` (default export); **#when** launchOptions проверяются; **#then** `headless === true`. (Регрессия)

**Verification:** Существующие тесты `PuppeteerSg.test.ts` проходят, 3 новых сценария проходят, `bun run engine` запускается headless как раньше.

---

### U4. DownloadEngine через Scrapers registry

**Goal:** Заменить зависимость `DownloadEngineLive` с `ScribdDownloader` на `Scrapers`. `classify` через registry-lookup. Worker зовёт `scraper.execute(url, folder, onEvent, false)`.

**Requirements:** R2, R5

**Dependencies:** U1, U2

**Files:**
- `packages/engine/src/service/DownloadEngine.ts` (modify) — `classify` через registry, worker через registry
- `packages/engine/test/DownloadEngine.test.ts` (modify) — обновить test setup на `Scrapers` Layer, добавить registry-классификации сценарий
- `packages/engine/engine.ts` (modify) — собрать `Scrapers` Layer и провайдить в `DownloadEngineLive`

**Approach:**
- В `DownloadEngine.ts`:
  - Импорт: `Scraper`, `Scrapers` из `./Scraper` вместо `ScribdDownloader`.
  - В `Layer.scoped`: `const scrapers = yield* Scrapers`.
  - `classify` становится closure: `(url) => scrapers.find(s => s.canHandle(url))?.id ?? "unsupported"`. Поднять выше `enqueue` или сделать функцией внутри `Layer.scoped`.
  - В `enqueue`: использовать `classify(url)` (closure), не глобальный.
  - В `worker` (строка 371): `const scraper = scrapers.find(s => s.id === current.domain)` — должен существовать, fallback на ошибку. Зовём `scraper.execute(current.url, folder, makeOnEvent(id), false)`.
  - Удалить импорт `scribdRegex` если больше не используется в этом файле.
- В `engine.ts`:
  - Заменить `ScribdLayer` на `ScrapersLayer = Layer.provide(Layer.succeed(Scrapers, [scribdImpl]), ScribdDownloaderLive)`. Нужна декомпозиция: получить инстанс scribd сервиса и обернуть в массив. Конкретный способ — через `Layer.effect(Scrapers, Effect.gen(function*(){ const s = yield* ScribdDownloader; return [s] }))`.
  - `EngineDeps` теперь включает `ScrapersLayer` вместо прямой `ScribdLayer`.
- В `DownloadEngine.test.ts`: заменить `Layer.succeed(ScribdDownloader, ...)` на `Layer.succeed(Scrapers, [{ id: "scribd", canHandle: (u) => /scribd.com/.test(u), execute: state.execute }])`.

**Patterns to follow:** `engine.ts:29-36` (Layer composition), `DownloadEngine.ts:88-92` (Layer.scoped с yield* зависимостей).

**Test scenarios:**
- **#given** `Scrapers = [scribdMock]`, scribd URL; **#when** enqueue; **#then** job.domain === "scribd", scraper.execute вызван. (Регрессия)
- **#given** `Scrapers = [scribdMock]`, non-scribd URL; **#when** enqueue; **#then** job.status === "Failed", failure.reason === "Unsupported domain", scraper.execute НЕ вызван. (Регрессия)
- **#given** `Scrapers = [scribdMock, customMock]` где customMock.canHandle вернёт `true` на example.com; **#when** enqueue example.com URL; **#then** job.domain === customMock.id, customMock.execute вызван. (Покрывает registry extensibility)
- **#given** scribd URL и `Scrapers = []` (пустой registry); **#when** enqueue; **#then** classify → "unsupported", job.status === "Failed". (Edge case)
- Все существующие сценарии `DownloadEngine.test.ts` проходят с обновлённым Layer setup.

**Verification:** `bun --filter @scribd-dl/engine test` зелёный. `bun run engine` стартует, `POST /enqueue` со scribd URL ставит job в Queued как раньше.

---

### U5. Debug runner entry-point `packages/engine/debug.ts`

**Goal:** Собрать `bun run debug <url>`: minimal Layer (без ConfigStore/JobStore/HttpServer), headful + bumped rendertime, прогресс в stdout.

**Requirements:** R3, R6

**Dependencies:** U1, U2, U3

**Files:**
- `packages/engine/debug.ts` (new) — entry-point
- `package.json` (modify) — добавить script `"debug": "bun packages/engine/debug.ts"`

**Approach:**
- `@effect/cli` command с одним positional argument `<url>`. Использовать существующий стиль из `engine.ts`.
- Layer композиция:
  - `ConfigLayer = makeConfigLoader({ ...DEFAULT_CONFIG, scribd: { rendertime: 5000 } })` — bump до 5s (OQ2 решён эмпирически: 5s достаточно для большинства Scribd-документов; при необходимости поднимется ce-work-ом до 10s).
  - `PuppeteerLayer = makePuppeteerSgLive({ headful: true })`.
  - `InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerLayer, TitleResolverLive)`.
  - `ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer)`.
  - `ScrapersLayer = Layer.effect(Scrapers, Effect.gen(function*(){ const s = yield* ScribdDownloader; return [s] }))` provided by `ScribdLayer`.
- Effect program:
  - `const scrapers = yield* Scrapers`.
  - `const scraper = scrapers.find(s => s.canHandle(url))` — если нет, `console.error` + exit 1.
  - `const folder = "./output"` — фиксированный, БЕЗ обращения к ConfigStore.
  - `const onEvent: OnEvent = (event) => Effect.sync(() => console.log(\`[\${event._tag}] ...\`))` — простой stdout logger.
  - `yield* scraper.execute(url, folder, onEvent, true)`.
  - Успех → `console.log("Done. Artifacts in", folder)`.
  - Ошибка → handled через `Effect.catchAll` с `console.error` + exit 1.
- `BunRuntime.runMain` как в `engine.ts`.
- В `package.json` добавить `"debug": "bun packages/engine/debug.ts"`.

**Patterns to follow:** `engine.ts:1-52` (CLI + Layer композиция, BunRuntime.runMain).

**Test scenarios:** Test expectation: none — thin orchestration layer над уже покрытым `execute` (U2). Manual verification ниже.

**Verification:**
- `bun run debug https://www.scribd.com/document/443989372/...` (Pathfinder URL): открывается headful Chrome, виден рендер страницы; в `./output/` появляется PDF + `.debug.html` дамп; multi-dim `_temp/` папка остаётся (если документ multi-dim).
- `bun run debug https://example.com/foo`: stderr "no scraper for URL", exit 1.
- `bun run debug` (без URL): @effect/cli печатает usage, exit 1.
- `bun run engine` запускается как раньше — production не сломан.

---

### U6. engine.ts wiring update + smoke prod check

**Goal:** Обновить `engine.ts` так, чтобы `DownloadEngineLive` получал `Scrapers` Layer; убедиться что production behavior не сломан.

**Requirements:** R5

**Dependencies:** U1, U2, U4

**Files:**
- `packages/engine/engine.ts` (modify) — composition

**Approach:**
- В `buildEngineLayer()`:
  - `ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer)` — без изменений.
  - Добавить: `const ScrapersLayer = Layer.provide(Layer.effect(Scrapers, Effect.gen(function*(){ const s = yield* ScribdDownloader; return [s] })), ScribdLayer)`.
  - `EngineDeps = Layer.mergeAll(ScrapersLayer, ConfigLayer, ConfigStoreLayer, JobStoreLive)` — заменили `ScribdLayer` на `ScrapersLayer`.
  - `return Layer.provide(DownloadEngineLive, EngineDeps)` — без изменений.
- `PuppeteerSgLive` используется как раньше (default export = `makePuppeteerSgLive({ headful: false })`).

**Patterns to follow:** существующий `engine.ts:29-36`.

**Test scenarios:** Test expectation: none — Layer wiring. Покрывается smoke-проверкой ниже + интеграционным тестом `HttpServer.test.ts` (если есть запуск enqueue end-to-end).

**Verification:**
- `bun --filter @scribd-dl/engine test` зелёный (включая `test/server/HttpServer.test.ts` если он есть).
- `bun run engine`: стартует, печатает `READY port=4747`, `POST /enqueue` со scribd URL переводит job в Queued → Downloading → Downloaded.
- TUI/SPA подключаются и видят jobs как раньше.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Эмпирическая настройка `rendertime` в debug-режиме (5s vs 10s vs 15s) — определится при дебаг-сессии Pathfinder в ce-work (origin OQ2).
- Опциональные скриншоты Puppeteer в `_temp/` при `debug=true` — упомянуто в origin как опция, не входит в первый проход.
- Pathfinder bug-fix как таковой — этот план даёт инструмент, фикс самого парсинга — отдельная итерация после дебаг-сессии.
- Shadowdark bug-fix — то же.

### Outside this product's identity

- Возврат Slideshare/Everand scrapers (origin NG4) — out-of-scope per `CLAUDE.md`. Контракт готовим под расширение, но второго scraper не пишем.
- Debug-сигнал в основном HTTP API engine (origin NG5) — debug только через runner.
- `DebugConfig` Tag / `ArtifactSink` Layer-сервис (origin NG1) — не вводим; каждый scraper владеет своими debug-побочками.
- Типизированная схема debug-флагов (origin NG2) — единственный сигнал `debug: boolean`.
- Fixture-based replay парсера без сети (origin NG3) — отдельная задача, не в этом проходе.

---

## Open Questions

Закрыты в плане:
- OQ1 (где живёт контракт) → KTD1: engine-internal `packages/engine/src/service/Scraper.ts`.
- OQ3 (debug в `DownloadEngine.execute`) → нет, debug только через runner (origin NG5 подтверждён).
- OQ4 (расположение runner-а) → KTD6: `packages/engine/debug.ts`.
- OQ5 (запись HTML inline vs через DirectoryIo) → KTD5: inline через `Bun.write`.

Остаётся для ce-work:
- OQ2: точное значение `rendertime` в debug-режиме — старт с 5s, корректировать по факту на Pathfinder.

---

## Risks

- **R-1.** Layer composition в `engine.ts` для `Scrapers` через `Layer.effect` + `yield* ScribdDownloader` может оказаться синтаксически непривычным. **Митigation:** есть прецедент в кодовой базе (`DownloadEngine.ts:91-92`), pattern проверенный.
- **R-2.** Существующие тесты `DownloadEngine.test.ts` (51KB, ~основной объём engine-тестов) могут потребовать массового обновления Layer setup. **Mitigation:** изменение точечное — заменить `Layer.succeed(ScribdDownloader, ...)` на `Layer.succeed(Scrapers, [{ ... }])`. Структура моков `state.execute` остаётся.
- **R-3.** `bun:test` mock `Bun.write` — потребует выбора между моком глобального `Bun` или вынесением `writeFile` в `DirectoryIo`. **Mitigation:** для первой версии — inline, замокать через `spyOn(Bun, "write")` или Layer-обёртку. Решить при имплементации.
- **R-4.** Headful Chrome в debug-режиме может потребовать `DISPLAY` на Linux или подходящего env на CI — но runner для self-use, не для CI. **Mitigation:** не митигируем, runner запускается только локально разработчиком.

---

## Касается

- `packages/engine/src/service/Scraper.ts` (new)
- `packages/engine/src/service/ScribdDownloader.ts` (modify — implement contract, debug branches)
- `packages/engine/src/service/DownloadEngine.ts` (modify — Scrapers dependency, registry classify)
- `packages/engine/src/utils/request/PuppeteerSg.ts` (modify — factory function)
- `packages/engine/engine.ts` (modify — Scrapers Layer wiring)
- `packages/engine/debug.ts` (new — runner entry-point)
- `packages/engine/test/ScribdDownloader.test.ts` (modify — debug scenarios + canHandle)
- `packages/engine/test/DownloadEngine.test.ts` (modify — Scrapers Layer setup, registry sanity test)
- `packages/engine/test/PuppeteerSg.test.ts` (modify — factory parameterization)
- `package.json` (modify — `"debug"` script)

---

## Связанные документы

- Origin: `docs/brainstorms/2026-06-12-scraper-debug-workflow-requirements.md`
- Bug repro: `docs/brainstorms/2026-06-11-render-artifacts-shadowdark-bug.md`
- Pathfinder URL для верификации: `https://www.scribd.com/document/443989372/Улучшенный-лист-персонажа-Pathfinder-RPG`
