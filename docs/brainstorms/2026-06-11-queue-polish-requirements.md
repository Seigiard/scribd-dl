---
title: "Queue polish: layout flip, dedup, clear actions"
status: completed
created: 2026-06-11
updated: 2026-06-11
completed: 2026-06-12
supersedes_seed: chat-prompt
---

# Queue polish: layout flip, dedup, clear actions

Три объединённых улучшения очереди со сменой layout и единым каналом нотификаций. Item 2 из исходного seed (toast-система) заменён на расширение `$transient` — внимание остаётся в одном месте, под header'ом, рядом с тем, где происходят изменения очереди.

## Goal

Сделать ежедневный paste→download флоу самообъяснимым: новые и недавно потроганные jobs наверху, статус системы (connect, paste feedback, errors) виден в одной полосе под header'ом, очистка терминальных и активных jobs — двумя явными кнопками. Минимум новых каналов нотификаций, минимум поверхности wire contract.

## Non-goals

- Toast-система в углу окна (отвергнуто в пользу единой статус-полосы).
- System-level уведомления OS (deferred R5 Tauri plan — закрывается этой работой как «не нужно»).
- Soft-delete / trash для очищенных jobs.
- Удаление файлов на диске при Clear (любого вида).
- Counter в кнопках Clear.
- Cross-client синхронизация UI-настроек (TUI и SPA рендерят один snapshot, но конкретный shape кнопок/полосы — забота каждого клиента).

---

## Item 1 — Layout flip + единая статус-полоса (`$transient` с severity)

### Решение

- **Order очереди:** newest-first. Источник — engine `EngineSnapshot`: `jobs` отдаётся в порядке «недавно потроганное сверху». TUI и будущий desktop читают тот же контракт.
- **Layout SPA:** footer `Press Cmd+V…` удаляется. Под header появляется **status zone** — одна строка с двумя ролями: текст `$transient` слева, кластер кнопок Clear (Item 3) справа.
- **Disconnect banner (`mount-banner`) удаляется.** Состояние коннекта показывается через `$transient` как sticky error.
- **`$transient` расширяется:**
  - shape: `{ severity: 'info' | 'warning' | 'error', message: string, sticky?: boolean } | null`.
  - одно сообщение в момент; новое перебивает старое **только если severity ≥ текущего** (error > warning > info). Sticky error (disconnect) перебивается только другим error.
  - auto-dismiss по таймеру для не-sticky: длительность зависит от severity (info короче, error длиннее; конкретные числа — при имплементации).
  - sticky=true для disconnect → таймер не ставится, очищается явным reconnect-событием.
- **Default state статус-полосы (когда `$transient === null`):** `Press Cmd+V to download links` как статичная подсказка слева от кнопок Clear. Это часть статичного UI, не значение `$transient`.

### Wire/contract impact

- `EngineSnapshot.jobs` — порядок меняется. Это поведенческий контракт; шейп типа в `packages/shared/src/jobs.ts` остаётся.
- Никаких новых WS event-типов для статус-полосы. `$transient` — чисто SPA-атом, наполняется из обработчиков команд (`engineClient.ts` try/catch) и `WSConnection`-listener'ов (open / close).

### Затрагивается

- `packages/engine/src/service/DownloadEngine.ts` — `snapshot()` отдаёт newest-first; внутреннее хранение остаётся `Ref<Map>`, порядок применяется при сериализации.
- `apps/web/index.html` — `mount-banner` и `mount-statusbar` удаляются; добавляется `mount-status-zone` под `mount-header`.
- `apps/web/src/store.ts` — `$transient` сменяет тип с `string | null` на структуру выше; `showTransient(msg)` → `showTransient(severity, message, opts?)`.
- `apps/web/src/views/` — `statusbar.ts` переименовывается / заменяется `statusZone.ts` (одна строка с slot'ами для текста и кнопок).
- `apps/web/src/main.ts` — wiring для нового mount и его подписок.
- TUI (`apps/tui`) — адаптация рендера очереди под newest-first (если сейчас он рендерит snapshot как есть, должен просто заработать).

---

## Item 2 — Paste-time dedup и реактивация по файлу

### Решение

- **Дедупликация по нормализованному URL** при `enqueue(text)`. Если такая ссылка уже есть в очереди — **перемещаем существующий job в начало** (newest-first), нового job не создаём.
- **Existence check для `Downloaded`:** engine при enqueue делает `fs.stat` по resolved пути файла (`outputFolder + filename + .pdf`). Eager, синхронно в обработчике enqueue.
  - Файл существует → статус `Downloaded` сохраняется, job просто перемещается в начало.
  - Файл отсутствует → status → `Queued`, `progress` сбрасывается, `displayTitle` **сохраняется** (до первого успешного scrape следующим запуском); job уходит к worker fiber.
- **Implicit retry для Failed:**
  - `Failed (retryable=true)` + paste той же ссылки → status → `Queued`, как выше.
  - `Failed (retryable=false)` (включая non-scribd) + paste → только перемещение в начало, status не трогаем. Для retry retryable=false существует явный кнопочный путь (если есть) или удаление + добавление.
- **Batch paste mixed (часть новых, часть дубликатов):**
  - Новые добавляются в начало в порядке их появления в paste-тексте (первый URL paste'а оказывается самым верхним).
  - Дубликаты перемещаются в начало, сохраняя относительный порядок внутри paste-блока среди себя; уезжают **под** новые из того же paste'а (новое > только что потроганное).
- **Broadcast:** после `enqueue`'а engine один раз отправляет `EngineSnapshot` всем WS-клиентам. Никаких новых event-типов (`JobMoved`, `JobUpserted`) не вводится.
- **Persistence:** `JobStore` пишет результат как обычно (snapshot после mutation); порядок в `jobs.jsonl` отражает новый order.

### Wire/contract impact

- Никаких новых типов в `packages/shared/src/jobs.ts`. Семантика `EngineSnapshot` уточняется: «order = newest-first».
- HTTP: `POST /enqueue` ответ остаётся прежним (`{ enqueued: number }`), но `enqueued` теперь — число фактически новых jobs, дубликаты не считаются. Возможно — расширить до `{ added: number, moved: number }`; решим при имплементации.

### Затрагивается

- `packages/engine/src/service/DownloadEngine.ts` — `enqueue(text)` логика: разбор → нормализация URL → проверка существующего → file-stat для `Downloaded` → mutate `Ref<Map>` → broadcast snapshot.
- `packages/engine/src/utils/io/DirectoryIo.ts` — добавится тонкий `fileExists(path)` или используем `fs.promises.stat` через тегированную ошибку.
- `packages/engine/src/service/JobStore.ts` — write остаётся как сейчас.
- `apps/web/src/store.ts` — `applySnapshot` уже diff'ит по id, изменений не нужно; SPA получает новый order бесплатно.

---

## Item 3 — Clear Finished / Clear All

### Решение

- **Две кнопки** в статус-зоне (справа от текста `$transient`):
  - **Clear Finished** — удаляет все `Downloaded` + `Failed` (любой retryable). Без подтверждения.
  - **Clear All** — удаляет всё, **включая активные `Downloading` и `Queued`**. Active fiber прерывается (`Effect.interrupt` через worker scope). С подтверждением через native dialog: `tauri-plugin-dialog` в desktop, `window.confirm` в SPA.
- **Disable правила:**
  - Clear Finished disabled при нулевом числе terminal jobs.
  - Clear All disabled при пустой очереди.
- **Без counter в label** (`Clear Finished` / `Clear All`).
- **Файлы на диске никогда не удаляются.** Это инвариант обеих кнопок.
- **Persistence:** обе операции пишут `jobs.jsonl` через обычный snapshot-flush (`JobStore.write`). Не soft-delete.

### Wire/contract impact

- HTTP: новые endpoint'ы. Предпочтительная форма — `DELETE /jobs?scope=finished` и `DELETE /jobs?scope=all`. Альтернатива — два отдельных endpoint'а. Решаем при `/ce-plan`.
- WS broadcast: `EngineSnapshot` после операции (как с enqueue). Никаких новых event-типов.

### Затрагивается

- `packages/engine/src/service/DownloadEngine.ts` — `clearFinished()` и `clearAll()` методы; для `clearAll` нужна координация с worker fiber (interrupt текущей задачи безопасно через scope).
- `packages/engine/engine.ts` — HTTP routes.
- `packages/shared/src/http.ts` — request/response shapes для clear endpoint'ов.
- `apps/web/src/lib/api.ts` — `clearFinished()`, `clearAll()` clients.
- `apps/web/src/views/statusZone.ts` — кнопки и disable-логика.
- `apps/web/src/engineClient.ts` — wrapper с try/catch → `$transient` error при фейле.

---

## Dependencies / Assumptions

- **Engine — единственный источник order.** Все клиенты доверяют snapshot-у; никто не сортирует локально. Это переносит ответственность на engine и оставляет клиентов тонкими.
- **`outputFolder`-resolution для file-existence check** в Item 2 использует ту же логику, которая сейчас формирует target-путь при сохранении PDF (через `ConfigStore` + `DEFAULT_CONFIG.filename`). Не дублировать формулу — вынести в общий helper, если ещё не вынесено.
- **Worker fiber interrupt при Clear All** должен быть безопасным благодаря `Layer.scoped` поверх `puppeteer.launch` — scope гарантирует cleanup при interrupt. Это работает, если worker действительно построен на scoped resources (надо подтвердить при имплементации).
- **TUI** должен работать без изменений (просто рендерит snapshot). Подтвердить смоук-тестом при работе над Item 1.

## Outstanding for /ce-plan

- Точный shape статус-зоны при двух кнопках + `$transient`-сообщении: одна строка с правым кластером кнопок vs два уровня (текст сверху, кнопки снизу).
- Auto-dismiss длительности для info / warning / error.
- HTTP shape Clear: `DELETE /jobs?scope=…` vs два endpoint'а.
- В Item 2: показывать ли в `$transient` info-сообщение типа `Found N new, M already in queue` после paste, или paste — silent (молча перестраивается очередь, sufficient signal).
- Подтвердить TUI поведение с newest-first (адаптация или само работает).
- Обновить `docs/plans/2026-06-11-004-feat-tauri-desktop-app-plan.md`: deferred R5 (system notifications) закрыт этой работой как «не нужно», unified $transient покрывает кейс.

## Success criteria

- Paste дубликата той же ссылки **не создаёт второй job** в очереди (видно по UI: счётчик не растёт, существующий уезжает наверх).
- Paste известной `Downloaded` ссылки **с удалённым файлом** перезапускает скачивание; ссылка с присутствующим файлом — не перезапускает.
- WS disconnect — sticky error в статус-зоне; reconnect — статус-зона возвращается в default-подсказку без ручного действия.
- Paste-фейл и operation-фейл показываются с severity=error и **перебивают** info `Press Cmd+V…`-подсказку, но **не** sticky disconnect.
- Clear Finished с 8 terminal jobs очищает 8, оставляет активные. Clear All с активным Downloading прерывает его и оставляет пустую очередь без зависших puppeteer-инстансов.
- `output/`-директория после Clear All содержит все ранее скачанные PDF нетронутыми.
