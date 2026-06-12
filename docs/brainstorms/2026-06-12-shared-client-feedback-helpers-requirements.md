---
date: 2026-06-12
topic: shared-client-feedback-helpers
---

# Shared Client Feedback Helpers

## Summary

Extract shared, framework-free client feedback helpers so TUI and Web use one behavioral contract for transient status messages and enqueue feedback. The extraction should standardize rules and remove duplication without moving UI state, timers, rendering, or framework-specific adapters into shared code.

---

## Problem Frame

TUI and Web now both express the same client-side feedback behavior: transient severities, priority/overwrite rules, auto-dismiss timing, sticky disconnect behavior, and paste/enqueue response messaging. The duplication is small today, but it is already enough for clients to drift and would likely be copied again by a future desktop client.

The existing product direction favors thin clients that share the engine wire contract through `@scribd-dl/shared`. The next step is to make shared client behavior explicit where it is genuinely cross-client, while avoiding a shared UI runtime or framework-specific state layer.

---

## Actors

- A1. TUI client: Shows queue/status feedback in terminal UI and owns its React/Ink state lifecycle.
- A2. Web client: Shows queue/status feedback in the SPA and owns its nanostores state lifecycle.
- A3. Future desktop client: Reuses shared client behavior without inheriting TUI/Web implementation details.
- A4. Planner/implementer: Needs a clear boundary between shared behavior and app-local UI wiring.

---

## Requirements

**Shared feedback behavior**
- R1. Shared client feedback behavior must be represented as pure, framework-free helpers that can be called from TUI, Web, and future clients.
- R2. The shared transient model must cover severity, message text, and sticky/non-sticky behavior in a way both current clients can map to their existing local state.
- R3. Transient severity ordering and overwrite rules must be centralized so lower-severity messages cannot accidentally replace higher-severity or sticky error feedback in one client but not another.
- R4. Auto-dismiss duration policy must be centralized as behavior data, while actual timer creation, cleanup, and state updates remain app-local.
- R5. Enqueue feedback summarization must be centralized so empty input, all-rejected batches, and partially rejected batches produce consistent severity-level outcomes across clients.
- R6. URL-presence detection used before enqueue must be centralized if it is part of the shared paste feedback decision.

**App-local ownership**
- R7. TUI and Web must continue to own their own state stores, timers, rendering, focus behavior, and component/view layout.
- R8. The extraction must not introduce React, Ink, nanostores, DOM, or browser-only assumptions into the shared helpers.
- R9. Existing user-visible flows should remain behaviorally equivalent except where current client drift is intentionally collapsed into the shared contract.

**Contract and maintainability**
- R10. The shared behavior must be tested once at the helper level, with app tests focused on integration with local state/rendering rather than re-testing the full policy in every client.
- R11. The shared helper surface should be small and named around client feedback behavior, not as a generic utilities bucket.
- R12. The extraction must not change engine HTTP/WS contract semantics or require new engine endpoints.

---

## Acceptance Examples

- AE1. **Covers R3, R7.** Given a client is showing a sticky disconnect error, when that same client receives lower-severity enqueue info, the shared policy says the sticky error remains; the client applies that result through its own local store.
- AE2. **Covers R4, R7.** Given a non-sticky warning is shown, when a client applies it, the shared policy provides the warning duration, but the client still owns creating and clearing the actual timer.
- AE3. **Covers R5.** Given enqueue returns only unsupported/rejected jobs, when TUI and Web summarize the result, both produce the same severity class and same count/reason semantics.
- AE4. **Covers R5.** Given enqueue returns a mixed batch with some accepted jobs and some non-retryable rejected jobs, when TUI and Web summarize the result, both produce the same partial-rejection outcome.
- AE5. **Covers R8, R12.** Given the shared package is imported outside a UI runtime, when the feedback helpers are used, they do not require React, nanostores, DOM APIs, or engine contract changes.

---

## Success Criteria

- TUI and Web no longer carry duplicate transient severity/timer/overwrite policy.
- TUI and Web no longer independently encode enqueue feedback summary rules for the same response cases.
- Future desktop work can reuse the same helper-level behavior without copying policy from either existing client.
- Downstream planning can identify a small shared behavior surface and app-local integration work without inventing scope boundaries.

---

## Scope Boundaries

- No shared state manager for transient feedback.
- No React hook, Ink component, nanostores adapter, or timer lifecycle abstraction in shared code.
- No visual redesign of TUI/Web status zones.
- No new engine endpoints, HTTP request/response shapes, or WS events.
- No attempt to unify every UI label or all app-specific operation error copy beyond enqueue/status feedback policy.
- No desktop implementation in this change; desktop is only a future consumer that informs the boundary.

---

## Key Decisions

- Use pure helpers as the first extraction boundary: This removes duplication and standardizes behavior without turning `@scribd-dl/shared` into a UI framework layer.
- Treat feedback policy as shared client behavior, not generic utilities: This keeps the surface intentional and discourages unrelated helper accretion.
- Keep lifecycle local to each app: Timer cleanup, store updates, focus, and rendering are tied to each client runtime and should not be abstracted prematurely.
- Standardize behavior before expanding UI surface: The work should collapse drift in existing flows before adding desktop-specific needs.

---

## Dependencies / Assumptions

- `@scribd-dl/shared` is allowed to contain small runtime helpers when they are cross-client and framework-free, consistent with its current thin client role.
- Current TUI/Web feedback behavior is close enough that differences can be resolved into one contract without needing a product redesign.
- Any exact message wording choices that affect users should be preserved unless planning finds current TUI/Web behavior already diverges.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Determine whether enqueue feedback helpers should return fully formatted messages or structured outcomes that each client formats locally.
- [Affects R6][Technical] Confirm whether URL-presence detection belongs with enqueue feedback helpers or should remain app-local because engine enqueue remains the canonical parser.
- [Affects R10][Technical] Decide which existing app tests should shrink to integration coverage after helper-level policy tests are added.
