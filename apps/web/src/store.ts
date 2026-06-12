import { atom, map } from "nanostores";
import type { EngineSnapshot, Job, JobId } from "@scribd-dl/shared";

export type ModalMode = "none" | "folder";

export type TransientSeverity = "info" | "warning" | "error";

export interface TransientState {
  readonly severity: TransientSeverity;
  readonly message: string;
  readonly sticky?: boolean;
}

type JobsMap = Record<JobId, Job | undefined>;

const SEVERITY_TIMERS: Readonly<Record<TransientSeverity, number>> = {
  info: 2000,
  warning: 4000,
  error: 6000,
};

const SEVERITY_RANK: Readonly<Record<TransientSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
};

export const $jobs = map<JobsMap>({});
export const $folder = atom<string | null>(null);
export const $connected = atom<boolean>(false);
export const $transient = atom<TransientState | null>(null);
export const $modal = atom<ModalMode>("none");

let transientTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimer = (): void => {
  if (transientTimer !== null) {
    clearTimeout(transientTimer);
    transientTimer = null;
  }
};

export const showTransient = (severity: TransientSeverity, message: string, opts?: { readonly sticky?: boolean }): void => {
  const current = $transient.get();
  if (current !== null) {
    const currentRank = SEVERITY_RANK[current.severity];
    const incomingRank = SEVERITY_RANK[severity];
    if (incomingRank < currentRank) return;
    if (current.sticky && incomingRank < SEVERITY_RANK.error) return;
  }
  clearTimer();
  const sticky = opts?.sticky === true;
  $transient.set({ severity, message, sticky });
  if (!sticky) {
    transientTimer = setTimeout(() => {
      $transient.set(null);
      transientTimer = null;
    }, SEVERITY_TIMERS[severity]);
  }
};

export const dismissSticky = (): void => {
  clearTimer();
  $transient.set(null);
};

export const clearTransient = (): void => {
  clearTimer();
  $transient.set(null);
};

const jobsShallowEqual = (a: Job, b: Job): boolean => {
  if (a === b) return true;
  if (a.id !== b.id || a.url !== b.url || a.domain !== b.domain || a.displayTitle !== b.displayTitle || a.status !== b.status) {
    return false;
  }
  const af = a.failure;
  const bf = b.failure;
  if (af !== bf) {
    if (!af || !bf) return false;
    if (af.reason !== bf.reason || af.retryable !== bf.retryable) return false;
  }
  const ap = a.progress;
  const bp = b.progress;
  if (ap !== bp) {
    if (!ap || !bp) return false;
    if (ap.done !== bp.done || ap.total !== bp.total || ap.stage !== bp.stage) return false;
  }
  return true;
};

export const applySnapshot = (snap: EngineSnapshot): void => {
  // Rebuild the whole map so the object key order matches the snapshot's
  // newest-first order. setKey on existing keys preserves their original
  // insertion slot, which would render new jobs at the bottom of the queue.
  const prev = $jobs.get();
  const next: JobsMap = {};
  let changed = false;
  for (const job of snap.jobs) {
    next[job.id] = job;
    const current = prev[job.id];
    if (current === undefined || !jobsShallowEqual(current, job)) {
      changed = true;
    }
  }
  if (!changed) {
    const prevIds = Object.keys(prev);
    const sameLength = prevIds.length === snap.jobs.length;
    const sameOrder = sameLength && prevIds.every((id, i) => id === snap.jobs[i]!.id);
    if (sameOrder) return;
  }
  $jobs.set(next);
};

export const resetStores = (): void => {
  $jobs.set({});
  $folder.set(null);
  $connected.set(false);
  clearTransient();
  $modal.set("none");
};
