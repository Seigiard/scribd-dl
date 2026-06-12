---
title: refactor: Extract shared client feedback helpers
type: refactor
status: active
date: 2026-06-12
origin: docs/brainstorms/2026-06-12-shared-client-feedback-helpers-requirements.md
---

# refactor: Extract shared client feedback helpers

## Summary

Introduce a small framework-free feedback helper surface in `@scribd-dl/shared`, then migrate TUI and Web to consume it while keeping state, timers, and rendering app-local. The implementation should land shared policy tests first, then shrink app tests toward lifecycle and integration coverage.

---

## Problem Frame

TUI and Web currently duplicate transient severity policy, timer durations, sticky overwrite behavior, URL preflight, and enqueue feedback summary logic. The origin requirements define the target boundary: standardize cross-client behavior without moving UI lifecycle into shared code.

---

## Requirements

**Shared helper behavior**
- R1. Shared client feedback behavior must be represented as pure, framework-free helpers callable from TUI, Web, and future clients.
- R2. The shared transient model must cover severity, message text, and sticky/non-sticky behavior.
- R3. Transient severity ordering and overwrite rules must be centralized.
- R4. Auto-dismiss duration policy must be centralized as behavior data; timer creation and cleanup remain app-local.
- R5. Enqueue feedback summarization must be centralized for empty input, all-rejected batches, and partially rejected batches.
- R6. URL-presence detection used before enqueue must be centralized as part of paste feedback preflight.
- R11. The shared helper surface should be small and named around client feedback behavior, not generic utilities.

**App ownership and boundaries**
- R7. TUI and Web must continue to own local state stores, timers, rendering, focus behavior, and layout.
- R8. Shared helpers must not introduce React, Ink, nanostores, DOM, browser-only APIs, timers, fetch, or WebSocket dependencies.

**Compatibility and testing**
- R9. Existing user-visible flows should remain behaviorally equivalent except where drift is intentionally collapsed.
- R10. Shared behavior must be tested once at helper level; app tests should focus on integration with local state/rendering.
- R12. The extraction must not change engine HTTP/WS semantics or require new engine endpoints.

**Origin actors:** A1 TUI client, A2 Web client, A3 future desktop client, A4 planner/implementer.
**Origin acceptance examples:** AE1 sticky error protection, AE2 duration/local timer split, AE3 all-rejected enqueue summary, AE4 partial-rejection enqueue summary, AE5 framework-free/no engine contract change.

---

## Scope Boundaries

- No shared transient state manager.
- No React hook, Ink component, nanostores adapter, DOM adapter, or timer lifecycle abstraction in shared code.
- No visual redesign of TUI/Web status zones.
- No new engine endpoints, HTTP request/response shapes, or WS events.
- No broad UI copy unification beyond enqueue/status feedback policy.
- No desktop implementation in this plan.

### Deferred to Follow-Up Work

- Desktop adoption: future desktop work should consume the shared helpers rather than copying TUI/Web policy.
- Broader operation error formatting: clear/remove/retry/save-folder error copy can be considered later if duplication becomes meaningful.

---

## Context & Research

### Relevant Code and Patterns

- `packages/shared/src/index.ts` re-exports the public shared surface; new shared helpers should be exported here.
- `packages/shared/src/client.ts` is already runtime shared code, but stays a thin HTTP/WS client and should not absorb UI feedback policy.
- `packages/shared/test/client.test.ts` shows shared tests use `bun:test` and local stubs without app frameworks.
- `apps/tui/src/tui/transient.ts` already contains the pure transient seam: severity ordering, duration lookup, and apply policy.
- `apps/tui/src/hooks/useTransient.ts` owns React/Ink state and timer lifecycle; this should remain local.
- `apps/tui/src/tui/App.tsx` owns input handling and currently summarizes enqueue results locally.
- `apps/web/src/store.ts` owns nanostore state and timer lifecycle while duplicating transient policy.
- `apps/web/src/engineClient.ts` owns paste handling and currently duplicates URL detection and enqueue result summary.
- `apps/web/test/store.test.ts` and `apps/tui/test/useTransient.test.tsx` should continue covering app-local lifecycle behavior after shared policy moves.
- `apps/web/test/paste.test.ts` should continue covering DOM paste routing, editable-target exclusion, and integration with shared feedback outcomes.

### Institutional Learnings

- `docs/brainstorms/2026-06-10-tui-app-extraction-requirements.md` established `@scribd-dl/shared` as wire contract plus thin, framework-free client runtime code.
- `docs/brainstorms/2026-06-11-queue-polish-requirements.md` established the transient behavior contract: one status zone message, severity priority, sticky disconnect, and per-severity dismiss duration.
- `docs/plans/2026-06-11-006-feat-tui-ui-parity-plan.md` identified the pure TUI transient seam that can be promoted to shared.
- `docs/brainstorms/2026-06-11-uhtml-islands-rewrite-requirements.md` reinforces that Web views and wiring remain app-local.

### External References

- None. Local code and prior project docs are sufficient for this internal refactor.

---

## Key Technical Decisions

- Create a dedicated shared feedback module rather than extending generic utilities: this satisfies R11 and keeps the shared surface intentional.
- Normalize shared transient state to a required `sticky: boolean`: this aligns with strict optional typing and avoids client-specific optional semantics.
- Return an explicit transient apply result with a no-op signal and timer instruction: clients must not clear or reset timers when an incoming lower-severity message is ignored.
- Preserve current sticky equal-severity behavior: sticky affects auto-dismissal, while overwrite priority is determined by severity. Any sticky feedback blocks lower severity; equal-or-higher severity replaces it and uses the incoming sticky setting.
- Treat URL detection as cheap client preflight only: engine enqueue remains the canonical parser; shared preflight only decides whether clients should avoid an obviously empty enqueue call.
- Summarize enqueue feedback from `EnqueueResponse.jobs`, not from detected URL count: the engine response is the only cross-client denominator.
- Count “rejected” enqueue jobs as non-retryable failed jobs only: retryable failures should not be presented as paste rejections and should not produce enqueue feedback by themselves. When non-retryable failures are present, partial-rejection counts use all returned jobs as the denominator to preserve current TUI/Web behavior.
- Return the exact shared feedback outcome current clients consume: a feedback state or no feedback. Split summary/formatting only if implementation finds an existing client needs different rendering.

---

## Open Questions

### Resolved During Planning

- Should enqueue helpers return formatted messages or structured outcomes? Resolve as a shared feedback state or no feedback; avoid a separate formatter unless implementation proves existing clients need it.
- Should URL detection mirror engine extraction? Resolve as cheap `has HTTP(S) URL` preflight; engine parsing remains canonical.
- Which app tests should shrink? Move policy matrices into shared tests; keep app tests for timers, state lifecycle, paste routing, and integration calls.
- Can equal-severity errors replace sticky disconnect? Preserve current behavior: yes.

### Deferred to Implementation

- Exact exported helper names: choose clear names consistent with the new module while preserving the planned boundaries.
- Exact split between one or two shared feedback test files: decide during implementation based on readability.

---

## Implementation Units

- U1. **Add shared feedback policy module and tests**

**Goal:** Establish the shared pure helper surface for transient policy, URL preflight, and enqueue summary before changing either app.

**Requirements:** R1, R2, R3, R4, R5, R6, R8, R10, R11, R12; AE1, AE2, AE3, AE4, AE5.

**Dependencies:** None.

**Files:**
- Create: `packages/shared/src/clientFeedback.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/client-feedback.test.ts`

**Approach:**
- Extract the current pure transient behavior into shared without importing app code or runtime APIs.
- Model the transient apply operation so callers can tell whether an incoming message was applied or ignored.
- Include duration policy as returned data or lookup data, not as timer ownership.
- Add enqueue summary helpers that inspect returned jobs, classify non-retryable failures as rejected, and return the feedback state current clients should show or no feedback.
- Add a cheap HTTP(S) URL preflight helper for client-side paste feedback.

**Technical design:** Directional shape for review, not implementation specification:
- Feedback state carries severity, message, and required sticky boolean.
- Applying incoming feedback returns either an ignored result with the unchanged state, or an applied result with the next state and an auto-dismiss duration or no duration.
- Enqueue summary accepts returned jobs and returns a feedback state or no feedback.
- URL preflight answers only whether HTTP(S) text is present; it does not expose engine-compatible parsing.

**Execution note:** Implement shared policy tests first so app migrations can preserve behavior against the new contract.

**Patterns to follow:**
- `apps/tui/src/tui/transient.ts` for existing pure transient policy.
- `apps/web/src/engineClient.ts` and `apps/tui/src/tui/App.tsx` for current enqueue summary semantics.
- `packages/shared/test/client.test.ts` for shared `bun:test` style.

**Test scenarios:**
- Covers AE1. Happy path: current sticky error plus incoming info produces an ignored/no-op result and preserves current state.
- Covers AE1. Happy path: current sticky error plus incoming warning produces an ignored/no-op result and preserves current state.
- Happy path: current sticky error plus incoming error applies the incoming error and uses the incoming sticky setting.
- Happy path: current info plus incoming warning applies warning.
- Happy path: current error plus incoming info is ignored.
- Happy path: equal severity applies and indicates a timer should be reset for non-sticky feedback.
- Covers AE2. Happy path: applied non-sticky info, warning, and error each produce the expected duration policy.
- Covers AE2. Happy path: applied sticky feedback produces no auto-dismiss duration.
- Edge case: ignored feedback produces no timer instruction.
- Covers AE3. Happy path: empty jobs summary produces an info no-links outcome.
- Covers AE3. Happy path: one non-retryable failed job produces a warning using its reason.
- Covers AE3. Happy path: multiple all-rejected jobs produce a warning using the first reason plus rejected count semantics.
- Covers AE4. Happy path: mixed accepted jobs and non-retryable failed jobs produce a partial-rejection warning based on returned job count.
- Edge case: retryable failed jobs are not counted as paste rejections.
- Edge case: retryable failed jobs alone produce no enqueue feedback.
- Edge case: mixed retryable and non-retryable failed jobs count only non-retryable failures as rejected while preserving returned job count as the partial-rejection denominator.
- Edge case: all accepted/queued/downloaded/downloading jobs produce no enqueue feedback.
- Edge case: URL preflight returns false for plain text and true for HTTP(S) URLs in bare text or markdown-style text.
- Covers AE5. Integration boundary: shared feedback module imports no app framework, DOM, timer, fetch, or WebSocket APIs.

**Verification:**
- Shared policy tests cover the behavior currently duplicated in TUI and Web.
- `@scribd-dl/shared` exports the new helper surface without changing existing HTTP/WS exports.

---

- U2. **Migrate TUI to shared feedback policy**

**Goal:** Replace TUI-local policy duplication with shared helpers while preserving React/Ink hook lifecycle and terminal behavior.

**Requirements:** R1, R3, R4, R5, R6, R7, R8, R9, R10; AE1, AE2, AE3, AE4.

**Dependencies:** U1.

**Files:**
- Modify: `apps/tui/src/hooks/useTransient.ts`
- Modify: `apps/tui/src/tui/App.tsx`
- Modify or delete: `apps/tui/src/tui/transient.ts`
- Test: `apps/tui/test/useTransient.test.tsx`
- Test: `apps/tui/test/transient.test.ts`

**Approach:**
- Import shared transient types and apply/duration helpers into `useTransient`, keeping `useState`, refs, timeout creation, cleanup, and dismiss behavior local.
- Ensure ignored incoming feedback does not clear or reset the current timer.
- Replace TUI enqueue summary logic in `App` with the shared enqueue feedback outcome.
- Replace TUI URL preflight with the shared URL helper while keeping `looksLikePaste` local.
- Remove or reduce `apps/tui/src/tui/transient.ts` once no longer needed.

**Patterns to follow:**
- Existing `apps/tui/src/hooks/useTransient.ts` timer lifecycle and cleanup pattern.
- Existing `apps/tui/src/tui/App.tsx` input/focus ownership boundaries.

**Test scenarios:**
- Covers AE2. Integration: `useTransient` applies an info message, schedules a local timer, and clears state after the shared info duration.
- Integration: an ignored lower-severity message does not reset the existing timer.
- Covers AE1. Integration: sticky error remains when warning/info arrives through the hook.
- Integration: sticky message creates no auto-dismiss timer and clears through local dismiss.
- Covers AE3, AE4. Integration: one representative TUI enqueue response path applies the shared feedback outcome through local transient handling.
- Edge case: short typed junk below TUI paste threshold remains app-local and does not show no-links feedback.

**Verification:**
- TUI behavior remains equivalent while pure transient policy tests no longer live only in the TUI app.
- TUI imports no shared UI adapter because none exists.

---

- U3. **Migrate Web store and paste flow to shared feedback policy**

**Goal:** Replace Web-local policy duplication with shared helpers while preserving nanostores, DOM paste routing, and SPA-specific lifecycle behavior.

**Requirements:** R1, R3, R4, R5, R6, R7, R8, R9, R10; AE1, AE2, AE3, AE4.

**Dependencies:** U1.

**Files:**
- Modify: `apps/web/src/store.ts`
- Modify: `apps/web/src/engineClient.ts`
- Test: `apps/web/test/store.test.ts`
- Test: `apps/web/test/paste.test.ts`

**Approach:**
- Import shared transient types and apply/duration helpers into `store.ts`, keeping nanostore atoms and timer cleanup local.
- Preserve `dismissSticky` current behavior as an unconditional local clear unless implementation reveals a reason to rename it.
- Replace Web `extractUrls` preflight with shared URL detection.
- Replace Web enqueue summary logic with the shared enqueue feedback outcome.
- Keep editable target detection and paste event listener ownership in `engineClient.ts`.

**Patterns to follow:**
- Existing `apps/web/src/store.ts` timer cleanup and `resetStores` behavior.
- Existing `apps/web/src/engineClient.ts` paste routing and app-local backend URL handling.
- `apps/web/test/paste.test.ts` Vitest mocking pattern.

**Test scenarios:**
- Covers AE2. Integration: Web `showTransient` applies info and clears after the shared duration via local timer.
- Integration: ignored lower-severity feedback does not clear or reset the existing timer.
- Covers AE1. Integration: sticky error blocks warning/info in the nanostore path.
- Integration: `resetStores` clears transient state and local timer.
- Integration: no URL paste avoids enqueue and shows shared no-links feedback.
- Integration: paste in input/textarea/contenteditable still avoids enqueue and shows no feedback.
- Covers AE3, AE4. Integration: one representative Web enqueue response path applies the shared feedback outcome through local transient handling.

**Verification:**
- Web behavior remains equivalent while transient and enqueue policy matrices move to shared tests.
- Web still owns DOM paste handling, backend URL resolution, nanostores, and timers.

---

- U4. **Finalize export and regression coverage**

**Goal:** Finish the migration by verifying the package root export, regression coverage, and engine-contract invariants that span U1-U3.

**Requirements:** R8, R9, R10, R11, R12; AE5.

**Dependencies:** U2, U3.

**Files:**
- Test: `packages/shared/test/client-feedback.test.ts`
- Test: `apps/tui/test/useTransient.test.tsx`
- Test: `apps/web/test/store.test.ts`
- Test: `apps/web/test/paste.test.ts`

**Approach:**
- Confirm the public export surface is explicit and does not require deep imports from apps.
- Remove redundant app policy test cases that are now covered by shared helper tests, while keeping integration assertions that prove local lifecycle works.
- Confirm no engine routes, shared HTTP response shapes, or WS event types changed.
- Ensure naming presents this as client feedback behavior, not miscellaneous utilities.

**Patterns to follow:**
- `packages/shared/src/index.ts` barrel export convention.
- Existing workspace test split: shared uses `bun:test`; Web uses Vitest; TUI uses `bun:test` plus Ink testing utilities.

**Test scenarios:**
- Covers AE5. Integration: importing shared feedback helpers from `@scribd-dl/shared` works in both TUI and Web code paths.
- Regression: existing shared HTTP client tests still pass unchanged.
- Regression: existing TUI/Web feedback flows still pass with reduced app-local policy duplication.
- Boundary: no tests require engine HTTP/WS changes to satisfy shared feedback behavior.

**Verification:**
- Shared helpers are available through the package root export.
- App tests cover lifecycle/rendering integration, not duplicate every policy branch already covered in shared.
- Engine contract files remain unchanged unless implementation reveals a type-only import cleanup need.

---

## System-Wide Impact

- **Interaction graph:** Shared feedback helpers feed TUI `useTransient`/`App` and Web `store`/`engineClient`; engine enqueue behavior remains the upstream source of jobs.
- **Error propagation:** Transport and command errors continue to surface through app-local `showTransient`; only the policy for whether feedback applies and how enqueue summaries are described is shared.
- **State lifecycle risks:** Ignored feedback must not reset timers; local cleanup on unmount/reset remains essential in both clients.
- **API surface parity:** TUI, Web, and future desktop should import from the `@scribd-dl/shared` package root rather than deep app-local copies.
- **Integration coverage:** Shared tests prove policy; app tests prove local timer/store/render/paste integration.
- **Unchanged invariants:** Engine HTTP/WS endpoints, `EnqueueResponse`, `Job`, `JobEvent`, TUI focus behavior, Web editable-target paste exclusion, and visual status-zone layout remain unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Shared helper grows into a generic utilities bucket | Name it around client feedback and limit U1 to transient, URL preflight, and enqueue summary behavior from origin requirements. |
| App timers reset when incoming feedback is ignored | Use explicit no-op/apply result from shared transient helper and cover it in TUI/Web integration tests. |
| Client URL preflight is mistaken for canonical engine parsing | Document and test it as cheap preflight only; continue summarizing from engine-returned jobs. |
| Copy drift remains if summaries are too loosely structured | Return the feedback state current clients consume so severity/message behavior stays centralized. |
| Tests are over-deleted during migration | Keep app lifecycle tests and only move pure policy matrices into shared tests. |

---

## Documentation / Operational Notes

- No README update is required unless implementation changes the visible public API documentation for `@scribd-dl/shared`.
- If a new shared module name becomes part of contributor conventions, update `CLAUDE.md` only if the boundary needs to be preserved for future work.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-12-shared-client-feedback-helpers-requirements.md](../brainstorms/2026-06-12-shared-client-feedback-helpers-requirements.md)
- Related code: `packages/shared/src/index.ts`
- Related code: `packages/shared/src/client.ts`
- Related code: `packages/shared/test/client.test.ts`
- Related code: `apps/tui/src/tui/transient.ts`
- Related code: `apps/tui/src/hooks/useTransient.ts`
- Related code: `apps/tui/src/tui/App.tsx`
- Related code: `apps/web/src/store.ts`
- Related code: `apps/web/src/engineClient.ts`
- Related code: `apps/web/test/store.test.ts`
- Related code: `apps/web/test/paste.test.ts`
- Prior requirements: `docs/brainstorms/2026-06-10-tui-app-extraction-requirements.md`
- Prior requirements: `docs/brainstorms/2026-06-11-queue-polish-requirements.md`
- Prior plan: `docs/plans/2026-06-11-006-feat-tui-ui-parity-plan.md`
