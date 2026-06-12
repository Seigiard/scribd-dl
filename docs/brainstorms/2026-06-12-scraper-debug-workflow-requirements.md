---
date: 2026-06-12
topic: scraper-debug-workflow
---

# Scraper Debug Workflow

## Summary

Ввести минимальный, переиспользуемый debug-workflow для скрапперов: тонкий `Scraper` контракт, через который проходит единственный сигнал `debug: boolean`, и отдельный entry-point `bun run debug <url>`, который не поднимает HTTP/WS/persist слой. Каждый scraper сам решает, что именно `debug=true` означает в его пайплайне. Цель — снять текущую боль (правка констант и пересборка для дебага Scribd-багов вроде Pathfinder/Shadowdark) и подготовить почву под второй scraper без изобретения общего debug-фреймворка.

---

## Problem Frame

Сейчас, чтобы отдебажить парсинг конкретного Scribd-документа, нужно вручную поменять `headless: true` в `packages/engine/src/utils/request/PuppeteerSg.ts`, поднять `rendertime` в `packages/engine/src/utils/io/ConfigLoader.ts`, закомментировать `dirRemove` в `ScribdDownloader.ts` и перезапустить engine. Это медленно, не повторяемо и теряется при любом коммите.

Unit-тесты в `packages/engine/test/ScribdDownloader.test.ts` мокают `page.evaluate` целиком — реальная scraping-логика (то, что в браузере) ими не покрыта by design. Smoke-тест `test/smoke/title.smoke.test.ts` единственное место, где код ходит в сеть, но это про title, не про render.

Архитектурно `DownloadEngine.classify` уже отделяет supported (Scribd) от unsupported по домену — точка расширения под multi-source есть, но `ScribdDownloader` не имеет общего контракта, через который мог бы пройти новый scraper. Любой будущий scraper (другой сайт, другая механика — например регистрация через временный email и скачивание по ссылке из письма) будет иметь свой набор debug-точек: общий debug-фреймворк бессмыслен.

Универсальный артефакт у всех один — итоговый файл в `output/`. Общий контракт работает только на уровне «вход URL + папка → файл», debug — opaque сигнал.

---

## Actors

- A1. Разработчик-владелец (self-use): сейчас единственный пользователь debug-режима. Хочет посмотреть глазами что рендерится для конкретного URL и получить артефакты для разбора без перекомпиляции.
- A2. ScribdDownloader: первый имплементор `Scraper` контракта. Под `debug=true` показывает headful окно, поднимает rendertime, оставляет `_temp/` с промежуточными PDF, дампит финальный HTML.
- A3. Будущий scraper (гипотетический): подключается к тому же runner-у и контракту, со своим прочтением `debug=true`.

---

## Goals

- G1. Отдебажить Pathfinder bug (`https://www.scribd.com/document/443989372/...`) и Shadowdark bug (`docs/brainstorms/2026-06-11-render-artifacts-shadowdark-bug.md`) через одну команду, без правки констант.
- G2. Ввести тонкий `Scraper` контракт, под который `ScribdDownloader` встаёт как первый имплементор без изменения внешнего поведения engine.
- G3. Добавить `bun run debug <url>` — изолированный entry-point: без HTTP/WS, без `JobStore`, без `ConfigStore` persist. Только классификация URL → выбор scraper → `execute(url, folder, onEvent, debug=true)`.
- G4. Сохранить идиомы проекта: Effect + Layer DI, типизация в `@scribd-dl/shared` для всего что кросс-пакетное, `bun:test` + Layer mocks для тестов.

---

## Non-Goals

- NG1. Не вводить `DebugConfig` / `ArtifactSink` Layer-сервис. Каждый scraper сам владеет своими debug-побочками.
- NG2. Не вводить типизированную схему debug-флагов (`Scraper.debugSchema`). Сигнал — `debug: boolean`. Когда задач станет реально несколько и понадобятся под-флаги — пересмотрим контракт.
- NG3. Не строить fixture-based replay (записанный HTML → прогон парсера без сети). Полезно, но отдельная задача — таймингов и lazy-load на fixture не словишь.
- NG4. Не возвращать в продакт второй source (Slideshare/Everand). Они out-of-scope per `CLAUDE.md`. Контракт готовим под расширение, но реализовывать не будем.
- NG5. Не добавлять debug-сигнал в основной HTTP-API engine. Debug — только через runner.

---

## Approach

**Контракт `Scraper` (тонкий, в `@scribd-dl/shared` или engine-internal — решит plan):**

```
execute(url: string, folder: string, onEvent: JobEventHandler, debug?: boolean) → Effect<void, DomainError>
canHandle(url: string) → boolean
```

`ScribdDownloader` имплементирует. Существующая сигнатура `execute(url, folder, onEvent)` уже близка — добавляется опциональный `debug`.

**Registry** (внутри engine): простой массив `Scrapers: Scraper[]`. `DownloadEngine.classify` использует `canHandle` вместо хардкода Scribd-домена. Под текущий продукт `Scrapers = [ScribdDownloader]`, добавление второго — append в массив.

**Runner** `apps/debug-runner` (или `packages/engine/debug.ts` — finalize в plan):
- `@effect/cli` парсит позиционный `<url>`
- классифицирует URL через `Scrapers`
- провайдит **минимальный Layer**: `PuppeteerSgLive`, `PdfGeneratorLive`, `DirectoryIoLive`, `ConfigLoader` с `DEFAULT_CONFIG`. Без `JobStore`, без `ConfigStore`, без HTTP/WS.
- зовёт `scraper.execute(url, "./output", noopOnEvent, true)`
- логирует прогресс в stdout

**`debug=true` для ScribdDownloader:**
- Puppeteer запускается headful (`headless: false`) — видно глазами
- `rendertime` поднимается с 100ms до 5000ms (или больше — конкретику в plan)
- `_temp/` не удаляется по итогу — остаётся для разбора
- финальный HTML страницы дампится в `output/<title>.debug.html`
- (опционально, в plan) скриншоты puppeteer в `_temp/`

Все эти решения — внутри `ScribdDownloader`. Контракт не знает про headful/rendertime/HTML-дамп.

**Скорость дебага Pathfinder/Shadowdark:** `bun run debug <url>` → headful окно → видно что рендерится → артефакты остаются → можно сравнить.

---

## Outstanding Questions

- OQ1. Где живёт `Scraper` контракт — `@scribd-dl/shared` или `packages/engine/src/service/Scraper.ts`? Если шарится с клиентами (нет, клиенты не знают про scrapers — общаются с engine через HTTP/WS) — engine-internal достаточно. Решение в plan.
- OQ2. Конкретное значение `rendertime` в debug-режиме (5s? 10s? envvar?) — определить эмпирически на Pathfinder при ce-work.
- OQ3. Должен ли `DownloadEngine` тоже принимать `debug` (для запуска через основной HTTP `POST /enqueue`)? Текущая позиция: нет, debug — только через runner. Подтвердить в plan.
- OQ4. Расположение runner-а: новый workspace `apps/debug` или просто `packages/engine/debug.ts`? Самый дешёвый вариант — второй; первый — если runner вырастет (вряд ли).
- OQ5. Запись HTML-дампа: `await page.content()` через `Bun.write()` напрямую внутри scraper, или вынести `DirectoryIo.writeFile`? Скорее inline.

---

## Касается

- `packages/engine/src/service/ScribdDownloader.ts` — имплементация контракта, debug-поведение
- `packages/engine/src/service/DownloadEngine.ts` — `classify` через `canHandle`, registry
- `packages/engine/src/utils/request/PuppeteerSg.ts` — параметр `headless` пробрасывается через Layer config (а не хардкод)
- `packages/engine/src/utils/io/ConfigLoader.ts` — `rendertime` остаётся константой, debug override живёт в scraper
- (новое) entry-point для runner + `package.json` script `"debug"`

---

## Связанные документы

- `docs/brainstorms/2026-06-11-render-artifacts-shadowdark-bug.md` — Shadowdark bug-репорт
- Pathfinder URL: <https://www.scribd.com/document/443989372/Улучшенный-лист-персонажа-Pathfinder-RPG> — отдельный bug-репорт не создан; будет верифицирован при дебаг-сессии runner-ом
