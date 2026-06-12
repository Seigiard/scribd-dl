import type { EngineSnapshot, JobId, TransientState } from "@scribd-dl/shared";

export type FocusableKind = "change" | "clearFinished" | "clearAll" | "remove" | "retry";

export type FocusableSlot =
  | { readonly kind: "change" | "clearFinished" | "clearAll" }
  | { readonly kind: "remove" | "retry"; readonly id: JobId };

export interface FocusableSummary {
  readonly slots: ReadonlyArray<FocusableSlot>;
  readonly hasTerminal: boolean;
  readonly hasAny: boolean;
}

export const computeFocusable = (snap: EngineSnapshot, transient: TransientState | null): FocusableSummary => {
  const slots: FocusableSlot[] = [{ kind: "change" }];
  const removeSlots: FocusableSlot[] = [];
  const retrySlots: FocusableSlot[] = [];

  const hasAny = snap.jobs.length > 0;
  let hasTerminal = false;

  for (const j of snap.jobs) {
    if (j.status === "Downloaded" || j.status === "Failed") hasTerminal = true;
    if (j.status === "Queued") removeSlots.push({ kind: "remove", id: j.id });
    if (j.status === "Failed" && j.failure?.retryable === true) retrySlots.push({ kind: "retry", id: j.id });
  }

  const clearVisible = transient === null;

  if (clearVisible && hasTerminal) slots.push({ kind: "clearFinished" });
  if (clearVisible && hasAny) slots.push({ kind: "clearAll" });
  slots.push(...removeSlots, ...retrySlots);

  return { slots, hasTerminal, hasAny };
};
