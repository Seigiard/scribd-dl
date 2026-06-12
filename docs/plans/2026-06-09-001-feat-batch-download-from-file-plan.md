---
title: "feat: Batch download from file"
status: superseded
created: 2026-06-09
superseded-by: docs/plans/2026-06-10-002-refactor-persistence-config-and-jobs-plan.md
superseded-reason: CLI-режим `bun start <url>` удалён; единственный entry point теперь engine sidecar, batch enqueue реализован через POST /jobs с многострочным текстом.
type: feat
---

# feat: Batch download from file

## Summary

Расширить CLI scribd-dl так, чтобы можно было передать путь к файлу со списком URL и скачать все документы последовательно, переиспользуя один экземпляр браузера Puppeteer. Поведение для одиночного URL (текущий `bun start <url>`) сохраняется без изменений — режим определяется по тому, существует ли аргумент как файл на диске.

---

## Problem Frame

Сейчас `bun start <url>` принимает строго один URL. У пользователя накопился список из ~20 ссылок (`links.md`), и качать их по одной вручную — кратно дороже по времени и cognitive overhead, чем должно быть. Браузер заново стартует на каждый запуск (~1-2с overhead × N), пользователь не видит общего прогресса, и нет агрегированного отчёта об упавших ссылках.

---

## Requirements

- **R1.** CLI принимает один аргумент: либо URL (как сейчас), либо путь к файлу со списком URL.
- **R2.** Режим определяется автоматически: если аргумент существует как файл — batch; иначе trim и трактуется как URL.
- **R3.** Файл парсится построчно. На каждой строке извлекается первая `http(s)://`-ссылка через regex; пустые строки, комментарии (`#…`), markdown-префиксы (`- `, `* `) — обходятся прозрачно. Это сохраняет совместимость с текущим `links.md` (markdown-список), оставаясь по сути plain-text парсингом.
- **R4.** URL'ы скачиваются последовательно (один за одним), переиспользуя единый browser instance из `puppeteerSg`.
- **R5.** При падении одного URL остальные продолжают скачиваться. Ошибка логируется (URL + сообщение).
- **R6.** В конце batch'а печатается сводка: всего N, успешно X, упало Y, со списком упавших URL и причинами.
- **R7.** Браузер корректно закрывается в конце batch'а (включая случай, когда часть URL упала).
- **R8.** Exit code: `0` если все успешно, `1` если хоть один упал (для CI/скриптов).

---

## Scope Boundaries

**In scope**
- Чтение списка URL из локального файла.
- Последовательная загрузка через существующие `scribdDownloader` / `slideshareDownloader` / `everandDownloader`.
- Сводный отчёт в конце.

**Out of scope**
- Параллельная загрузка (concurrency > 1). Текущий `puppeteerSg` рассчитан на один browser; параллельность потребует переработки.
- Retry с backoff'ом на упавших URL.
- Чтение списка URL из stdin или из URL (например, raw GitHub gist).
- Дедупликация URL внутри файла.

### Deferred to Follow-Up Work
- Возможный флаг `--continue-on-error` / `--fail-fast` если когда-то понадобится переключение поведения.
- Resume-режим (пропускать URL, чей output-файл уже существует).

---

## Key Technical Decisions

**KTD1. Авто-определение режима по `existsSync(arg)`.**
Если `fs.existsSync(arg)` возвращает true — batch-режим. Иначе arg трактуется как URL. Это решение пользователя из планирования: минимум изменений в UX, никаких новых флагов. Edge case: если кто-то создаст файл с именем, совпадающим с URL — выберется batch (крайне маловероятно; URL содержит `://`, который недопустим в именах файлов на большинстве платформ).

**KTD2. Парсинг файла — regex на каждую строку, не markdown AST.**
Регулярка `/(https?:\/\/\S+)/` на trimmed строке извлекает первую ссылку. Это покрывает: `- https://…` (markdown bullet), `* https://…`, голый URL, URL после произвольного текста. Пустые строки и `#`-комментарии пропускаются (первое — нет матча, второе — явная проверка `line.startsWith('#')`). Это компромисс между «только plain text» (выбор пользователя) и реальностью существующего `links.md` — без AST, но толерантно к markdown-разметке.

**KTD3. Последовательное `for…of` поверх `app.execute(url)`, обёрнутое в try/catch.**
Не Promise.all и не Promise.allSettled — пользователь явно выбрал «один за другим», и `puppeteerSg` всё равно singleton. `for…of` с `await` + per-iteration try/catch собирает массив `{ url, status, error? }` для финального отчёта.

**KTD4. Закрытие браузера через `puppeteerSg.close()` в `finally`.**
В одиночном режиме сейчас закрытие происходит внутри downloader'ов через `puppeteerSg.close()` после последней страницы. Для batch нужно убедиться, что между URL'ами браузер НЕ закрывается, а закрывается один раз в конце. **Execution-time check (defer):** проверить, кто именно вызывает `puppeteerSg.close()` сегодня и не сломает ли это reuse между итерациями. Если closer'ом является каждый downloader — придётся либо вынести `close()` на уровень App для batch, либо сделать close идемпотентным с ленивым relaunch (`puppeteerSg.getPage` уже релонч-толерантен по строке 40-41).

---

## Implementation Units

### U1. Batch reader: extract URLs from file

**Goal:** Изолированная функция, читающая файл и возвращающая массив валидных URL.

**Requirements:** R3.

**Dependencies:** —

**Files:**
- `src/utils/io/UrlListReader.js` (new) — экспортирует `urlListReader.read(filePath): string[]`.
- `test/utils/io/UrlListReader.test.js` (new).

**Approach:**
- Bun's `Bun.file(path).text()` для чтения (проект уже на Bun runtime).
- Split по `\n`, trim, отфильтровать пустые и строки, начинающиеся с `#`.
- На каждой строке выполнить `/(https?:\/\/\S+)/.exec(line)` и взять `[1]`. Пропустить строки без матча.
- Вернуть массив строк-URL.

**Patterns to follow:** Стиль модулей в `src/utils/io/` — singleton с фабричным экспортом (см. `ConfigLoader.js`, `DirectoryIo.js`).

**Test scenarios:**
- Happy path: файл с тремя URL'ами в формате markdown-bullets (`- https://…`) возвращает массив из трёх строк.
- Plain text: одна ссылка на строку без префиксов — тот же результат.
- Mixed: смесь bullets, голых URL и комментариев — все три URL извлечены, комментарий пропущен.
- Empty lines: пустые строки и whitespace-only — игнорируются.
- Comment lines: `# comment` — пропущена.
- Line without URL: `random text without link` — пропущена без ошибки.
- Markdown header: `# Scribd links from zsh history` (как в текущем `links.md`) — пропущена.
- Empty file: возвращает `[]`.
- File not found: пробрасывает ошибку с понятным сообщением.

**Verification:** `bun test test/utils/io/UrlListReader.test.js` зелёный. Запуск против реального `links.md` репозитория возвращает 20 URL.

---

### U2. App.executeBatch: sequential download with error aggregation

**Goal:** Метод на `App`, который принимает массив URL и последовательно скачивает каждый, собирая отчёт.

**Requirements:** R4, R5, R6, R7.

**Dependencies:** U1.

**Files:**
- `src/App.js` (modify) — добавить `executeBatch(urls): Promise<BatchReport>`.
- `src/utils/request/PuppeteerSg.js` (potentially modify) — см. KTD4: убедиться, что browser переиспользуется между итерациями. Если нужно — добавить флаг `keepAlive` или вынести `close()` из downloader'ов.
- `test/App.test.js` (new или extend) — моки на downloader'ы.

**Approach:**
```
async executeBatch(urls) {
  await directoryIo.create(...)
  const results = []
  for (const url of urls) {
    try {
      await this.execute(url)   // делегирует существующему роутеру
      results.push({ url, status: 'ok' })
    } catch (e) {
      console.error(`[FAIL] ${url}: ${e.message}`)
      results.push({ url, status: 'fail', error: e.message })
    }
  }
  await puppeteerSg.close()   // один раз в самом конце
  return { total, ok, failed, results }
}
```

**Execution note:** Перед написанием U2 — прочитать все три downloader'а и подтвердить, кто сейчас вызывает `puppeteerSg.close()`. Если каждый — после загрузки своей страницы, то reuse уже работает (благодаря lazy `if (!this.browser) launch()` в `getPage`). Если есть `close()` после, который ломает следующую итерацию — решение: либо убрать `close()` из downloader'ов в App-level (потребует чуть-чуть отрефакторить single-URL путь, чтобы App закрывал в обоих режимах), либо сделать `puppeteerSg` полностью идемпотентным к close/relaunch (уже почти такой).

**Patterns to follow:** Existing routing в `App.execute` — делегирование по regex домена. `executeBatch` его переиспользует, не дублирует.

**Test scenarios:**
- Happy path: 3 URL, все мокированные downloader'ы возвращают success — отчёт `{ total: 3, ok: 3, failed: 0 }`.
- All fail: 3 URL, все падают — `{ total: 3, ok: 0, failed: 3 }`, в `results` каждое сообщение об ошибке.
- Partial fail: 2-й URL падает, 1-й и 3-й ок — все три обработаны, упавший залогирован, остальные успешны.
- Empty list: `executeBatch([])` — `{ total: 0, ok: 0, failed: 0 }`, browser не запускается.
- Browser closed once: после batch'а `puppeteerSg.close()` вызван ровно один раз (spy).
- Browser NOT closed between iterations: проверить, что между двумя успешными URL'ами browser instance тот же (или хотя бы не было лишних `launch()`).

**Verification:** `bun test` зелёный. End-to-end smoke: `bun start links.md` со списком из 2-3 реальных URL — отрабатывает последовательно, выдаёт сводку.

---

### U3. CLI entry: auto-detect file vs URL + summary print + exit code

**Goal:** Обновить `run.js` так, чтобы он различал режимы и печатал финальный отчёт.

**Requirements:** R1, R2, R6, R8.

**Dependencies:** U1, U2.

**Files:**
- `run.js` (modify).
- `test/run.test.js` (опционально — CLI обычно покрывают integration-смоком, не unit'ом).

**Approach:**
```
import { existsSync } from 'node:fs'
import { app } from './src/App.js'
import { urlListReader } from './src/utils/io/UrlListReader.js'

if (process.argv.length !== 3) {
  console.error('Usage: bun start <url-or-file>')
  process.exit(1)
}
const arg = process.argv[2]

if (existsSync(arg)) {
  const urls = urlListReader.read(arg)
  if (urls.length === 0) {
    console.error(`No URLs found in ${arg}`)
    process.exit(1)
  }
  const report = await app.executeBatch(urls)
  console.log(`\n=== Batch summary ===`)
  console.log(`Total: ${report.total}, OK: ${report.ok}, Failed: ${report.failed}`)
  if (report.failed > 0) {
    console.log(`Failed URLs:`)
    report.results.filter(r => r.status === 'fail').forEach(r =>
      console.log(`  - ${r.url}: ${r.error}`)
    )
    process.exit(1)
  }
} else {
  await app.execute(arg)
}
```

**Patterns to follow:** `run.js` сейчас однострочный — сохранить тот же стиль (no try/catch wrapper, top-level await), исключения пусть всплывают.

**Test scenarios:**
- Manual smoke: `bun start https://www.scribd.com/document/...` (single URL) — работает как раньше.
- Manual smoke: `bun start links.md` — последовательно скачивает все URL, в конце печатает summary, exit 0.
- Manual smoke: `bun start ./nonexistent-and-not-a-url` — попадает в `else`, downloader выбрасывает `Unsupported URL`.
- Manual smoke: пустой файл `empty.md` — печатает «No URLs found», exit 1.

**Verification:** Запустить `bun start links.md` с реальным `links.md` репозитория. Все 20 URL обработаны, summary напечатан, exit code корректный. `bun start <single-url>` всё ещё работает идентично прошлому поведению.

---

## Risks & Dependencies

- **Browser lifecycle между URL'ами (KTD4).** Главный execution-time риск. Митигация: U2 включает разведку downloader'ов перед написанием, и тест «browser closed once» поймает регрессию.
- **Долгий batch — память Puppeteer растёт.** На 20 URL вряд ли проблема, но если кто-то прокинет 200 — может ОOM. Out of scope сейчас; зафиксировать в `Deferred to Follow-Up Work` если всплывёт (resume / chunking).
- **Regex для URL может зацепить хвост строки с пунктуацией.** `\S+` жадно подберёт всё до пробела. Для текущих `links.md` (URL в конце строки) это работает. Если пользователь напишет `- https://… (комментарий)` — захватит и `(комментарий)`. Acceptable для v1.

---

## Verification

- `bun test` — все юнит-тесты зелёные (U1, U2).
- `bun run lint` и `bun run format:check` — без ошибок.
- Smoke: `bun start links.md` против реального `links.md` репозитория — скачивает все, печатает summary.
- Smoke: `bun start <single-url>` — поведение идентично pre-change.
- Exit code: при наличии failed URL — `1`; при полном успехе — `0`.

---

## Sources & Research

- Local repo scan: `src/App.js`, `src/utils/request/PuppeteerSg.js` (lazy launch/close), три downloader'а в `src/service/`, текущий `run.js`, формат `links.md`.
- Bun docs: `Bun.file(path).text()` для чтения файла (нативный API, не нужен `node:fs/promises`).
- Tech stack: Bun 1.3.14, ESM, oxlint + oxfmt, тестовый раннер `bun test`.
