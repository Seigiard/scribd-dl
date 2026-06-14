# Fix Scribd slideshow scrape

**Status:** draft
**Branch:** `fix-downloading`
**Trigger bug:** `https://www.scribd.com/doc/36487266/Adventure-Deck` — PDF содержит только page 1 из 13.

---

## Problem

Текущий `ScribdDownloader` построен на одной предпосылке: «прокрутить контейнер → все страницы отрендерятся → захватить как один/несколько PDF». Это верно только для **scrollable-режима** embed'а (новые `/document/{id}`).

На **slideshow-режиме** embed'а (старые `/doc/{id}`, e.g. Adventure Deck) контейнер не скроллится в принципе (`scrollHeight === clientHeight`), потому что страницы показываются по одной с навигацией через кнопки `Previous page` / `Next page`. Все 13 `outer_page_*` div'ов присутствуют в DOM сразу, но все, кроме первой, имеют `display: none` и пустой `image_layer`. Scribd рендерит контент следующей страницы только при клике на «Next page».

Текущий код этого не знает: скролл-цикл выходит на первом тике, dimensions всех 13 страниц одинаковы, `allSameDimensions === true` → одна `page.pdf(...)` → захватывается только видимая page 1 → PDF из одной страницы.

Подтверждено диагностикой:
- `[probe] container scrollH=860, clientH=860` (нечего скроллить).
- `[probe] page7 display=none, childCount=8, innerLen=276` (scaffold с декоративными `b_tl/b_tr/...` без image_layer).
- `[probe] layers p1=[newpage, b_tl, ...]` vs `p7=[b_tl, b_tr, ...]` — у page 7 нет `newpage` слоя.
- `[lazyLoad] withSrc=1` стабильно на всех тиках — скролл ничего не подгружает.

## Goal

`ScribdDownloader` корректно скачивает оба типа embed'ов:

1. **Slideshow** (Adventure Deck-подобные) — собирает все N страниц через программный клик «Next page» до тех пор, пока кнопка не пропадёт/задизейблится.
2. **Scrollable** (Smart Money-подобные) — продолжает работать по существующему скролл-флоу.

Минимальный успех = Adventure Deck (13 страниц) скачивается полностью со всеми картинками.

## Non-goals

- Не делаем «Download this PDF» direct-fetch (отложено как future optimization).
- Не делаем manifest-based image fetch (отложено).
- Не трогаем `apps/web`, `apps/tui`, `apps/desktop`, `DownloadEngine`, wire-contract.
- Не меняем поведение для multi-dimension scrollable-документов (текущая ветка `groupPagesByDimensions` остаётся).
- Не добавляем headless-detection trickery (UA spoofing и пр. — 429/403 в логах относятся к sentry/auth, не к контенту).

## Detection

В самом начале `execute`, после загрузки embed-страницы и инициализации helpers, делаем одну браузерную пробу:

```js
const next = document.querySelector('.right_arrow[aria-label="Next page"]');
const kind = next ? 'slideshow' : 'scrollable';
```

`kind` определяет дальнейший flow. Никаких total-page-count, никаких manifest probes. Селектор — единственный источник истины.

## Branching in execute

```
load embed page
init helpers
remove cookie/optin dialogs (как сейчас)
inject style overrides (как сейчас)

detect kind

if kind === 'scrollable':
  → существующий код (lazyLoad → processPage → allSameDimensions → ...)

if kind === 'slideshow':
  → новый flow (см. ниже)
```

## Slideshow flow

Идея: каждая страница рендерится только когда становится «текущей» через клик «Next». Захватываем по одной, мерджим в финальный PDF.

```
nextSelector = '.right_arrow[aria-label="Next page"]'
visiblePageSelector = "div.outer_page_container div[id^='outer_page_']:not([style*='display: none'])"
                       // или querySelector с runtime фильтром по computed display

pages = []
loop:
  visiblePage = querySelector(visiblePageSelector)   // одна, текущая
  
  await waitForImageLoaded(visiblePage)              // <img> внутри есть src && complete
  
  { width, height } = bounding rect видимой страницы
  tempPdfPath = `${tempDir}/${pageIndex}.pdf`
  generatePDF(page, tempPdfPath, { width, height }) // single-page snapshot
  pages.push(tempPdfPath)

  next = querySelector(nextSelector)
  if (!next || next.hasAttribute('disabled') || next офигел и пропал)
    break
  
  prevId = visiblePage.id
  click(next)
  await waitFor(() => current visible outer_page_*.id !== prevId)

merge(pages → finalPdfPath)
cleanup tempDir
```

### Subtleties

- **`page.pdf` захват только видимой страницы.** Чтобы `page.pdf({ width, height })` не печатал пустые отскроленные скелеты под/над текущей страницей: либо `hideSelectorAll` всех остальных `outer_page_*`, либо `body.innerHTML = visiblePage.outerHTML` (как делает текущий код). Лучше — изоляция через клонирование текущей страницы в свежий body перед PDF и восстановление после (или через iframe-снапшот). Стартуем с `hide all → show current → pdf → restore`.
- **Ожидание загрузки картинки.** Внутри `visiblePage` найти `img.absimg`, дождаться `img.complete && img.naturalWidth > 0`. Bounded timeout 15s, по таймауту страница считается «как есть».
- **Ожидание смены страницы после click.** После клика Scribd асинхронно меняет `display: none/block` между страницами. Ждать `outer_page_*` с новым id (не равным prevId).
- **Конец цикла.** Когда «Next page» либо удалена из DOM, либо имеет `aria-disabled` / класс отключения, либо click перестал менять `visiblePage.id`. Минимум 2 из 3 признаков — straight stop. Жёсткий cap = 500 итераций как страховка от вечного цикла.
- **Cookie/optin диалоги.** Уже удаляются перед detection.
- **Размеры страниц.** На каждой итерации берём актуальные `boundingRect` — slideshow может иметь страницы разных размеров (текстовая первая 1000×773, остальные тоже, но не гарантировано).

## Implementation outline

### Файлы

1. `packages/engine/src/utils/request/PuppeteerSg.ts`
   - Добавить helper'ы в `BROWSER_HELPERS_SOURCE`:
     - `getVisibleOuterPage()` — возвращает `{id, width, height}` текущей видимой `outer_page_*`.
     - `waitForVisibleImage(timeoutMs)` — promise, резолвится когда `img.absimg` внутри видимой страницы загружен.
     - `clickNextAndWait(prevId, timeoutMs)` — клик `.right_arrow`, await смены visible page id.
     - `isNextAvailable()` — bool, доступна ли «Next page».
     - `isolateVisiblePage()` / `restorePages()` — пара для подготовки DOM к `page.pdf` одной страницы.

2. `packages/engine/src/service/ScribdDownloader.ts`
   - В `execute`: после `getPage` и инициализации helpers — detection probe (`isSlideshow: bool`).
   - Если slideshow:
     - Прогон цикла click-through через `page.evaluate(...)` + `puppeteerSg.generatePDF(...)` per page.
     - Сборка через `pdfGenerator.merge(...)` (уже используется).
   - Если scrollable: текущая `processPage → ... → groupPagesByDimensions → ...` ветка как есть.
   - `processPage` для scrollable пути не меняем.

3. `packages/engine/src/const/ScribdRegex.ts`
   - Не трогаем. `/doc/` и `/document/` оба ведут на один `/embeds/{id}/content`; detection — runtime.

### Контракт событий (`OnEvent`)

- `TitleResolved` — без изменений.
- `ScrapeProgress({done, total})` — для slideshow `total` неизвестен заранее, ставим `done = total = текущая позиция` (или эмитим только в конце). Решение: эмитим `ScrapeProgress(N, N)` в конце, после прохода всех страниц. Альтернатива — заранее парсить `data-e2e="total-pages-embed"` для UX, но это опциональный nice-to-have, не блокер.
- `RenderProgress({done, total})` — эмитим после каждого захваченного PDF. `total` обновляется каждый раз (растущая правая граница) или ставится в конце прохода.

Финальное решение: на каждой итерации эмитим `RenderProgress({done: i, total: i + (isNextAvailable() ? 1 : 0)})` — пользователь видит «капающий» прогресс.

### Errors

- Существующие `PageProcessFailed` / `PdfGenerationFailed` покрывают новые кейсы.
- Новый кейс: «next-кнопка пропала после 0 итераций» (детектировали slideshow но не смогли проитерироваться) — fail with `PageProcessFailed({ url, cause: "slideshow click loop produced 0 pages" })`. Не молча.

## Testing

### Unit tests (`packages/engine/test/ScribdDownloader.test.ts`)

Существующий mock-стиль (`Layer.succeed(PuppeteerSg, fakeService)`) уже изолирует браузер. Добавляем:

1. **Detection: slideshow path** — `page.evaluate` mock возвращает `{isSlideshow: true}`, проверяем что generatePDF вызван N раз (по числу мокнутых итераций), merge вызван 1 раз.
2. **Detection: scrollable path** — `{isSlideshow: false}`, проверяем что вызывается старый flow (один generatePDF в same-dim ветке).
3. **Slideshow: пустой результат** — first click сразу даёт `isNextAvailable=false` и нет видимой страницы → fail with PageProcessFailed.
4. **Slideshow: страховочный cap** — mock бесконечный «next» → fail после 500 итераций (или explicit cap check).

Существующие тесты для scrollable ветки должны остаться зелёными без правок.

### Manual smoke (debug runner)

1. `bun run debug https://www.scribd.com/doc/36487266/Adventure-Deck` — slideshow.
   - Ожидание: `output/Adventure Deck.pdf` содержит 13 страниц со всеми картинками.
2. `bun run debug https://www.scribd.com/embeds/693471767/content` — scrollable.
   - Ожидание: PDF собран корректно через старый scroll-флоу.
3. `bun run debug https://www.scribd.com/embeds/{какой-нибудь-маленький-2-3-страничный-slideshow}/content` — slideshow edge case.

Smoke-результаты подшить в PR description (screenshots/число страниц).

## Iteration plan

Делаем атомарными батчами по 2–3 шага с гейтом на `bun run fix` (или эквивалент) между батчами:

### Batch 1 — Detection и helpers (без рефакторинга execute)

1. Добавить в `BROWSER_HELPERS_SOURCE`: `getVisibleOuterPage`, `waitForVisibleImage`, `clickNextAndWait`, `isNextAvailable`.
2. Добавить browser-side detection helper (одна строка с проверкой `.right_arrow[aria-label="Next page"]`).
3. Unit-проверка: новые helper'ы загружаются без ошибок (extending PuppeteerSg.test mock).

Gate: `bun --filter @scribd-dl/engine test && bun run lint`.

### Batch 2 — Slideshow flow в execute

1. В `execute`: detection branch.
2. Slideshow ветка: click-through цикл, сборка `pdfPaths`, merge.
3. Unit-тесты: detection slideshow, slideshow happy path, slideshow empty-cycle fail.

Gate: `bun --filter @scribd-dl/engine test && bun run lint`.

### Batch 3 — Manual smoke + regressions

1. Запустить debug runner на Adventure Deck. Подтвердить 13 страниц с картинками.
2. Запустить debug runner на scrollable документе. Подтвердить регрессий нет.
3. (Опционально) Запустить debug на 2–3 произвольных Scribd URL для шумозащиты.

Gate: пользователь подтверждает, что smoke прошёл.

### Batch 4 — Cleanup, commit, PR

1. Прибрать `git stash` (`stash@{0}` с диагностикой) — посмотреть, не нужно ли сохранить какие-то helper'ы для будущего debug. Скорее всего drop.
2. Commit + PR с описанием root cause / fix / smoke-результатами.

## Risks and unknowns

- **Селектор «Next page» может отличаться у других slideshow-документов.** Mitigation: fallback на CSS-класс `.right_arrow` + `aria-label*="next"` (case-insensitive), не строгое сравнение.
- **Размеры страниц.** На каждой итерации читаем bounding rect — если slideshow меняет размер между страницами (титульная + контентные), это обрабатывается естественно.
- **Page.pdf захват с пустыми скелетами вокруг.** Решается через `hide → show → pdf → restore` цикл (как в текущей multi-dim ветке `generatePDFs`).
- **Какой-то slideshow без «Next page» вообще** (1-страничный): detection вернёт `scrollable` → пойдёт по старому пути → 1 страница в PDF, что и ожидается. OK.
- **Производительность.** 100+ страничный slideshow = 100 кликов × (image load wait + pdf snapshot). Может быть медленно. Это приемлемо — лучше медленно и корректно, чем быстро и пусто.

## Open questions

- Стоит ли использовать `data-e2e="total-pages-embed"` для лучшего progress-UX? **Решение: нет в первой итерации, добавим если будет визуально мешать.**
- Cleanup существующего stash с диагностикой — оставить или дропнуть после фикса? **Решение: дропнуть после успешного PR.**
