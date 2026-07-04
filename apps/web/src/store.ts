import { atom, map } from "nanostores";
import {
  applyTransient,
  type EngineSnapshot,
  type Job,
  type JobId,
  type SettingsResponse,
  type TransientSeverity,
  type TransientState,
} from "@scribd-dl/shared";

export type { TransientSeverity, TransientState } from "@scribd-dl/shared";

export type ModalMode = "none" | "folder" | "settings";

type JobsMap = Record<JobId, Job | undefined>;

export const $jobs = map<JobsMap>({});
export const $folder = atom<string | null>(null);
export const $settings = atom<SettingsResponse | null>(null);
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
  const result = applyTransient($transient.get(), { severity, message, sticky: opts?.sticky });
  if (result.kind === "ignored") return;
  clearTimer();
  $transient.set(result.state);
  if (result.dismissAfterMs !== null) {
    transientTimer = setTimeout(() => {
      $transient.set(null);
      transientTimer = null;
    }, result.dismissAfterMs);
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
  const ac = a.compression;
  const bc = b.compression;
  if (ac !== bc) {
    if (!ac || !bc) return false;
    if (ac.status !== bc.status) return false;
    if (ac.status === "failed" && bc.status === "failed" && ac.reason !== bc.reason) return false;
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
  $settings.set(null);
  $connected.set(false);
  clearTransient();
  $modal.set("none");
};
