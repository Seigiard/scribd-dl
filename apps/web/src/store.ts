import { atom, map } from "nanostores";
import type { EngineSnapshot, Job, JobId } from "@scribd-dl/shared";

export type ModalMode = "none" | "folder";

type JobsMap = Record<JobId, Job | undefined>;

export const $jobs = map<JobsMap>({});
export const $folder = atom<string | null>(null);
export const $connected = atom<boolean>(false);
export const $transient = atom<string | null>(null);
export const $modal = atom<ModalMode>("none");

const TRANSIENT_MS = 2000;
let transientTimer: ReturnType<typeof setTimeout> | null = null;

export const showTransient = (msg: string): void => {
  $transient.set(msg);
  if (transientTimer !== null) clearTimeout(transientTimer);
  transientTimer = setTimeout(() => {
    $transient.set(null);
    transientTimer = null;
  }, TRANSIENT_MS);
};

export const clearTransient = (): void => {
  if (transientTimer !== null) {
    clearTimeout(transientTimer);
    transientTimer = null;
  }
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
  const next = new Map<JobId, Job>();
  for (const job of snap.jobs) next.set(job.id, job);

  const prev = $jobs.get();
  for (const id of Object.keys(prev) as JobId[]) {
    if (!next.has(id)) $jobs.setKey(id, undefined);
  }

  for (const [id, job] of next) {
    const current = prev[id];
    if (current === undefined || !jobsShallowEqual(current, job)) {
      $jobs.setKey(id, job);
    }
  }
};

export const resetStores = (): void => {
  $jobs.set({});
  $folder.set(null);
  $connected.set(false);
  clearTransient();
  $modal.set("none");
};
