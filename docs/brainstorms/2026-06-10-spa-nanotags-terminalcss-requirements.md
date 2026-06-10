# SPA: миграция React → nanotags + terminal.css

**Date:** 2026-06-10
**Scope:** Standard (рефакторинг apps/web, ~800 строк исходников)

## Goal

Снять с `apps/web` зависимости от React, Tailwind и Radix. SPA становится тонким клиентом движка на nanotags (custom elements + nanostores) поверх terminal.css. Vite + TS + vitest сохраняются.

Скоуп клиента — то, что и сейчас: пастят ссылки, видят очередь со статусами и прогрессом, ремувают `Queued`, ретраят `Failed (retryable)`, видят баннер при дисконнекте, видят и **меняют** download folder.

## Non-goals

- TUI-парность с Ink (Tab-фокус-нав, `q to quit`, ASCII-рамки). terminal.css берётся только как визуальный тон.
- Pixel-perfect копия мокапа (заголовок "Tauri Downloader TUI" и т.п.). Заголовок и copy остаются как сейчас или меняются отдельно.
- Изменение wire-контракта (`@scribd-dl/shared`) и engine.
- Введение роутинга, i18n, SSR.

## User-facing behavior

Один экран. Сверху — карточка terminal.css c `<header>`-заголовком, ниже — folder-строка с кнопкой `Change`, ниже — очередь, в подвале — статус-строка.

**Folder line.** Текущая папка + кнопка `Change`. Клик открывает модалку с инпутом (предзаполнен текущим значением), `Save`/`Cancel`, валидация на пустую строку, ошибка через `terminal-alert terminal-alert-error`. `Enter` = save, `Esc` = cancel. Сохранение шлёт `POST /folder` на движок (новый эндпоинт — см. развилку O-1); локально в `localStorage` ничего не пишем — источник правды engine.

**Queue items.**
- Title (`job.displayTitle`), статус справа.
- URL под title (`job.url`), моноширинно, обрезается.
- Цвета статусов: `Downloaded` — `--primary-color`, `Failed` — `--error-color`, `Downloading` — `--primary-color` + blink-анимация, `Queued` — без подсветки.
- `Queued` → справа кнопка `Remove` (DELETE через `removeJob`).
- `Failed` + `failure.retryable === true` → справа кнопка `Retry`.
- `Failed` → строкой ниже: `Reason: <failure.reason>` в `--error-color`.
- `Downloading` + `progress` → строка `done / total (stage)` под URL. Прогресс-бар не обязателен; текстовая строка достаточна для terminal.css-тона.

**Paste.** `Ctrl/Cmd+V` (или браузерный `paste` event на `window`) → `POST /enqueue` через существующий `enqueueText`. Игнор пасты, когда target — `INPUT`/`TEXTAREA` (внутри модалки). Если в буфере не нашлось ссылок и сервер вернул `jobs: []` — транзиент `No links found in clipboard` на 2 сек в статус-строке.

**Disconnect banner.** Если WS отвалился — баннер над очередью, кнопка `Reconnect` дёргает `reconnect()` стора.

**Status bar.** Транзиент (`No links found`, и т.п.) или статичная подсказка `Press Ctrl/Cmd+V to download links`. Без `q to quit`, без `Tab to nav`.

## Architecture

### Зависимости

Уходят: `react`, `react-dom`, `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss`, `@tailwindcss/vite`, `@vitejs/plugin-react`, `@testing-library/react`, `@types/react*`.

Приходят: `nanotags`, `nanostores`, `terminal.css` (npm-пакет). `@testing-library/dom` вместо react-варианта.

### Состояние (nanostores)

Один модуль `apps/web/src/store.ts` экспортирует:

- `$snapshot: atom<EngineSnapshot>` — последний снэпшот от движка (REST + WS патчи).
- `$jobs: map<Record<JobId, Job>>` — производное от `$snapshot.jobs`, **map** чтобы точечная мутация одного job'а перерендеривала только свой `<sd-queue-item>`, не весь список.
- `$folder: atom<string | null>` — фетчится по `GET /folder`, обновляется после `POST /folder`.
- `$connected: atom<boolean>` — WS-флаг.
- `$transient: atom<string | null>` — транзиентное сообщение статус-бара (с таймером в коде, не в сторе).
- `$modal: atom<'none' | 'folder'>` — состояние модалки.

WS-логика и `enqueueText`/`removeJob`/`retryJob`/`fetchFolder` переезжают из `hooks/` в `apps/web/src/engineClient.ts` — обычные функции, без хуков. Они пишут в сторы, custom elements читают через `ctx.effect`.

### Custom elements

Каркас в `apps/web/index.html`:

```html
<sd-app>
  <sd-header data-ref="header"></sd-header>
  <sd-disconnect-banner data-ref="banner" hidden></sd-disconnect-banner>
  <sd-queue data-ref="queue"></sd-queue>
  <sd-statusbar data-ref="statusbar"></sd-statusbar>
  <sd-folder-modal data-ref="modal" hidden></sd-folder-modal>
</sd-app>
```

- `<sd-header>` — карточка terminal.css, рисует folder-строку и кнопку `Change` (открывает `$modal`).
- `<sd-disconnect-banner>` — подписан на `$connected`, переключает `hidden`.
- `<sd-queue>` — подписан на `$jobs` map. На добавление job'а вставляет новый `<sd-queue-item job-id="...">`, на удаление снимает. Поскольку это `map`, batched-мутации внутри job'а не трогают список.
- `<sd-queue-item>` — получает `job-id` атрибутом, подписан на ключ в `$jobs`, перерисовывает только свой блок при изменении статуса/прогресса.
- `<sd-statusbar>` — подписан на `$transient`, fallback на статичную подсказку.
- `<sd-folder-modal>` — подписан на `$modal`, рендерит overlay + input + Save/Cancel. Делает `POST /folder`.

### Структура файлов (предварительно)

```
apps/web/
  index.html                  # каркас с custom elements
  src/
    main.ts                   # define()-ы всех тегов, mount
    store.ts                  # nanostores
    engineClient.ts           # WS + REST, пишет в сторы
    components/
      sd-app.ts
      sd-header.ts
      sd-disconnect-banner.ts
      sd-queue.ts
      sd-queue-item.ts
      sd-statusbar.ts
      sd-folder-modal.ts
    styles.css                # @import "terminal.css" + точечные оверрайды
```

`lib/api.ts` и `lib/backendUrl.ts` сохраняются как есть.

### Тесты

Текущие 5 файлов в `apps/web/test/*` переписываются на `@testing-library/dom` + `vitest` + `jsdom`. Сценарии те же:
- `paste.test` — paste event → POST /enqueue.
- `QueueItem.test` — рендер статусов, кнопок Remove/Retry, reason.
- `smoke.test` — монтаж SPA.
- `useEngineState.test` → переименовать в `store.test` — WS-патч обновляет `$jobs`, `$connected`, и т.п.
- `disconnect.test` — баннер появляется/исчезает.

## Engine changes

Чтобы реализовать смену папки из UI, нужен HTTP-эндпоинт `POST /folder { folder: string }` на движке. Сейчас есть `setOutputFolder` в `DownloadEngine` и `outputFolder` в `ConfigStore`, не хватает только HTTP-обвязки.

Это **минимальный** engine-change в рамках этой задачи. Всё остальное — чисто apps/web.

## Decisions resolved

- **D-1.** Vite + TS остаются. React/Tailwind/Radix уходят.
- **D-2.** Реактивность — `nanostores` (`atom` + `map`). Точечная мутация по job-id через `map` снимает развилку «innerHTML-перебилд vs ключованный список».
- **D-3.** terminal.css = визуальный тон. Веб-идиомы (клики, фокус по умолчанию) сохраняются. Без `q to quit`, без принудительного Tab-фокуса.
- **D-4.** Folder picker реализуется как модалка с инпутом. Источник правды — engine (`POST /folder`), а не `localStorage`.
- **D-5.** Тесты переписываются (а не сносятся).
- **D-6.** Прогресс показывается текстом `done / total (stage)`. Без прогресс-бара.

## Outstanding questions

- **O-1.** Точный shape `POST /folder` (валидация пути на сервере? создание директории, если её нет? коды ошибок?). Решается в плане при добавлении эндпоинта.
- **O-2.** Что показывать в `<sd-header>` как заголовок карточки. Текущий `Header.tsx` — 20 строк, посмотреть и сохранить тот же текст по умолчанию.
- **O-3.** Footer hint exact copy: `Press Ctrl/Cmd+V to download links` (как в референсе) или мягче.

## Success criteria

- `apps/web/package.json` не содержит `react*`, `@radix-ui/*`, `tailwind*`, `clsx`, `cva`, `tailwind-merge`.
- `bun run app:dev` запускает SPA, она подключается к движку и работает: paste, queue, remove, retry, folder change, disconnect banner.
- `bun --filter @scribd-dl/web test` зелёный.
- `bun run lint` и `bun run format:check` чистые.
- Бандл значительно меньше текущего (react+radix+tailwind суммарно ~150кб gzip; ожидание — единицы кб).
- `packages/engine` и `packages/shared` не меняются, кроме нового HTTP-роута `POST /folder`.
