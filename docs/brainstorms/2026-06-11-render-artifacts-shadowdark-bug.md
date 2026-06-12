---
title: "Bug: render artifacts in Shadowdark PDF"
status: fixed
created: 2026-06-11
fixed: 2026-06-12
fixed_in: "#23"
type: bug
---

# Bug: render artifacts in Shadowdark PDF

## Resolution

Fixed in [#23](https://github.com/Seigiard/scribd-dl/pull/23) (merged 2026-06-12).

Root cause — injected CSS в `processPage` (ScribdDownloader.ts:80) форсил `color: #000000 !important` на всех `.text_layer` спанах, перекрывая инлайновые `style="color:..."` на обложках с цветным дизайном в text_layer. Конкретно на Shadowdark двухцветный логотип "ShadowDark" (`#231f20` + `#70487e` со сдвигом) коллапсировал в сплошной чёрный — позиции сохранялись, фиолетовая половина дизайна терялась.

Fix — удалена строка `color: #000000 !important`. `opacity: 1` + `text-shadow: none` + font-smoothing остались, они и решают изначальный Blur/Fade.

## Repro
URL: <https://www.scribd.com/document/976321603/Shadowdark-%D0%91%D1%8B%D1%81%D1%82%D1%80%D1%8B%D0%B9-%D0%A1%D1%82%D0%B0%D1%80%D1%82-%D0%98%D0%B3%D1%80%D0%BE%D0%BA%D0%B0>
(«Shadowdark — Быстрый Старт Игрока»)

Файл скачивается, но с визуальными артефактами в рендере.

## What to dig into

- Что именно за артефакты — какие страницы, какой тип (cut-off текст, дубли страниц, missing fonts, неверные dimensions, чёрные/белые квадраты, watermark остался в неожиданном месте)? Зафиксировать скриншоты до debug-сессии.
- `packages/engine/src/service/ScribdDownloader.ts` — pipeline scrape → render → PDF merge. Где-то по пути теряется качество или mis-aligned.
- `packages/engine/src/utils/io/PdfGenerator.ts` — `merge` flow (pdf-lib). Возможно проблема в merge'е страниц с нестандартными размерами.
- `packages/engine/src/utils/request/PuppeteerSg.ts` — `rendertime` из `DEFAULT_CONFIG` (currently constant). Может на тяжёлых страницах не успевает дорисовать → артефакт. Попробовать поднять `rendertime` локально для этого URL.
- Page HTML дамп: `page_html.txt` в output/ — посмотреть структуру конкретно у этого документа. Возможно Scribd на этом документе использует другой layout/тариф (e.g., promotional preview vs full doc).

## Гипотезы

1. **rendertime недостаточный** — Puppeteer снимает скрин до того как fonts/images догружаются. Простой тест: бамп `rendertime` (5s → 10s → 15s) и сравнить.
2. **Specific layout у документа** — Shadowdark возможно multi-column / нестандартные dimensions, и наша scrape логика рассчитана на стандартный single-column.
3. **Unicode/Cyrillic в URL** — `%D0%91%D1%8B%D1%81%D1%82%D1%80%D1%8B%D0%B9` декодируется в "Быстрый". Возможно где-то по пути теряется при scrape (фильтрация URL? передача в Puppeteer?). Проверить что page HTML вообще fetched корректно.
4. **PDF merge mismatch** — отдельные страницы рендерятся ОК, но при сборке через pdf-lib дают артефакт. Сравнить промежуточные .png/jpeg (если есть) с финальным PDF постранично.

## Где начать

1. Скачать с текущим кодом, открыть PDF, **записать что конкретно сломано** (страницы, тип артефакта).
2. Включить headful-режим Puppeteer (если есть флаг) и посмотреть глазами как страница рендерится в момент screenshot.
3. Сохранить `page_html.txt` для этого документа и сравнить с любым другим работающим Scribd URL (структурный diff).

## Касается

- `packages/engine/src/service/ScribdDownloader.ts`
- `packages/engine/src/utils/io/PdfGenerator.ts`
- `packages/engine/src/utils/request/PuppeteerSg.ts`
- `packages/engine/src/utils/io/ConfigLoader.ts` — `rendertime` constant
