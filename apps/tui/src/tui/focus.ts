import type { EngineSnapshot, JobId } from "@scribd-dl/shared";
import type { TransientState } from "./transient";

export type FocusableKind = "change" | "clearFinished" | "clearAll" | "remove" | "retry";

export interface FocusableSlot {
  readonly kind: FocusableKind;
  readonly id?: JobId;
}

export interface FocusableSummary {
  readonly slots: ReadonlyArray<FocusableSlot>;
  readonly hasTerminal: boolean;
  readonly hasAny: boolean;
}

export const computeFocusable = (snap: EngineSnapshot, transient: TransientState | null): FocusableSummary => {
  const slots: FocusableSlot[] = [{ kind: "change" }];

  const hasTerminal = snap.jobs.some((j) => j.status === "Downloaded" || j.status === "Failed");
  const hasAny = snap.jobs.length > 0;
  const clearVisible = transient === null;

  if (clearVisible && hasTerminal) slots.push({ kind: "clearFinished" });
  if (clearVisible && hasAny) slots.push({ kind: "clearAll" });

  for (const j of snap.jobs) {
    if (j.status === "Queued") slots.push({ kind: "remove", id: j.id });
  }
  for (const j of snap.jobs) {
    if (j.status === "Failed" && j.failure?.retryable === true) slots.push({ kind: "retry", id: j.id });
  }

  return { slots, hasTerminal, hasAny };
};
