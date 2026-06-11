---
title: "Queue polish: dedup, error toasts, Clear All"
status: draft
created: 2026-06-11
seeded_from: chat-prompt
---

# Queue polish: dedup, error toasts, Clear All

Seed document captured during the Tauri desktop work. Three small UX
improvements that hit different parts of the queue lifecycle. Each is
sketched well enough to remember, but not yet pressure-tested — full
brainstorm to follow before planning.

---

## Item 1 — Paste-time dedup and re-download check

### What
Когда пользователь пейстит URL, обработка списка не дублирует уже известные ссылки и пересобирает упавшие/удалённые файлы.

### Behaviour sketched so far
- **Дедупликация при paste.** Если такая ссылка уже есть в очереди — не создавать новый job. Существующая запись **перемещается в конец списка** (как сигнал "недавно потрогали"), статус сохраняется.
- **Reuse vs re-download для `Downloaded`.** При повторном paste известной ссылки со статусом `Downloaded`:
  - file на диске существует → статус остаётся, job не пересоздаётся.
  - file отсутствует → job снова уходит в `Queued` и качается заново.

### Open / для брейншторма
- Где живёт проверка существования файла — engine при paste, или ленивая при click/open? (engine — единственное место знающее output folder).
- Считается ли `move to end` изменением статуса для WS broadcast? Если да — нужен новый event tag (`JobMoved`?) или достаточно `JobAdded`-как-no-op + полный refresh.
- Что делать если `displayTitle` у существующей записи устарел (e.g., была `Failed` с reason="404" → файл удалён → перекачиваем)? Сбрасывать в URL до resolve, или хранить старое?
- Re-download у `Failed (retryable=false)` → пейст той же ссылки = manual retry?
- Поведение для batch-paste где половина ссылок новая, половина дубликаты — порядок в очереди после операции?

### Касается
- `packages/engine/src/service/DownloadEngine.ts` — `enqueue(text)` логика.
- `packages/engine/src/service/JobStore.ts` — мутации существующих записей.
- `packages/shared/src/jobs.ts` — возможный новый `JobMoved` event.
- `apps/web/src/store.ts` — `applySnapshot` уже знает diff'ить по id; порядок придёт из engine snapshot.

---

## Item 2 — Toast-уведомления для ошибок

### What
Заменить (или дополнить) текущий transient banner на toast-систему, в которой можно отображать ошибки операций (network fail, save folder fail, retry fail, etc.).

### Behaviour sketched so far
- Тосты появляются в углу окна (визуально отдельно от queue), автоисчезают через N секунд.
- Изначально только для **ошибок**. Successes тоже через тосты — отдельный вопрос (см. open).
- Дизайн (положение, цвет, анимация, длительность, max stack) — **обсуждается отдельно**.

### Open / для брейншторма
- Заменяем `$transient` (текущий "No links found in clipboard") тостами или это два канала?
- Auto-dismiss vs persist-until-click — разная политика для error vs info?
- Max одновременно на экране (stacking)?
- Что с тостами при minimised window — копить и показать на focus, или drop?
- Source-of-truth: только frontend (engineClient → toast при try/catch), или engine тоже может пушить `Notification`-event через WS?

### Касается
- `apps/web/src/store.ts` — новый `$toasts` atom (или замена `$transient`).
- `apps/web/src/views/` — новый `toasts.ts` view.
- `apps/web/src/engineClient.ts` — call-sites для error → toast.
- `apps/web/index.html` — `.mount-toasts` контейнер.

---

## Item 3 — Footer-кнопка Clear All с confirmation

### What
В нижнем баре окна (там где сейчас "Press Cmd+V to download links") добавить кнопку **Clear All**, которая после подтверждения чистит очередь.

### Behaviour sketched so far
- Кнопка видна всегда, **disabled когда очередь пустая**.
- Клик → нативный (или in-app modal) confirm: "Remove all N jobs?" / Cancel / Confirm.
- Confirm → удаляет всё.

### Open / для брейншторма
- Scope удаления: всё подряд, или только terminal статусы (`Downloaded` / `Failed`)? Активные `Downloading` — отменяются вместе или защищены?
- Поведение по отношению к persisted state (`jobs.jsonl`) — после Clear All запись очищается, не "soft-delete"?
- Confirm popup: использовать `tauri-plugin-dialog` (нативный) в desktop / `window.confirm` в браузере, или единый in-app modal (как `folder-modal`)?
- Подсветка в счётчике: "Clear All (12)"?
- Side effect на files на диске: уже скачанные PDF — **не трогаем** (это документально подтвердить).

### Касается
- `packages/engine/src/service/DownloadEngine.ts` — новый `clearAll()` метод.
- `packages/engine/engine.ts` — HTTP route `DELETE /jobs` (или `POST /jobs/clear`).
- `packages/shared/src/jobs.ts` — возможный `JobsCleared` event.
- `apps/web/src/views/statusbar.ts` — кнопка в футере.
- `apps/web/src/lib/api.ts` — клиент.

---

## Cross-item observations

- Items 1 и 3 оба меняют engine wire contract (новые HTTP routes / WS events). Имеет смысл планировать вместе, чтобы один цикл миграции shared types.
- Item 2 чисто frontend — может ехать отдельно и быстрее.
- Все три не блокируют друг друга. Порядок реализации обсуждаем при /ce-plan.

---

## Outstanding for proper brainstorm

Когда сядем за полноценный `/ce-brainstorm` по этому seed:

1. Зафиксировать persona/scenario для каждого item (кто и в каком моменте сценария это hit'ит).
2. Решить open вопросы выше.
3. Прикинуть, нужны ли engine-side изменения (Items 1, 3) или fit'ятся в чистый frontend layer.
4. Связать с план-доком Tauri desktop (`docs/plans/2026-06-11-004-feat-tauri-desktop-app-plan.md`) — Item 2 заменяет deferred R5 (system notifications) на in-SPA toast'ы.
