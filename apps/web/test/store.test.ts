import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineSnapshot, Job, JobId } from "@scribd-dl/shared";
import { $jobs, $transient, applySnapshot, resetStores, showTransient } from "@/store";

const job = (overrides: Partial<Job> & { id: JobId }): Job => ({
  id: overrides.id,
  url: overrides.url ?? `https://example.com/${overrides.id}`,
  domain: overrides.domain ?? "scribd",
  displayTitle: overrides.displayTitle ?? `Doc ${overrides.id}`,
  status: overrides.status ?? "Queued",
  ...(overrides.failure !== undefined ? { failure: overrides.failure } : {}),
  ...(overrides.progress !== undefined ? { progress: overrides.progress } : {}),
});

const snapshot = (jobs: Job[]): EngineSnapshot => ({ jobs });

describe("store", () => {
  beforeEach(() => {
    resetStores();
  });

  it("empty snapshot leaves $jobs empty", () => {
    applySnapshot(snapshot([]));
    expect(Object.keys($jobs.get())).toHaveLength(0);
  });

  it("adds a new job into the map", () => {
    const a = job({ id: "a" as JobId });
    applySnapshot(snapshot([a]));
    expect($jobs.get().a).toEqual(a);
  });

  it("setKey is called only for changed jobs on update", () => {
    const a = job({ id: "a" as JobId, status: "Queued" });
    const b = job({ id: "b" as JobId, status: "Queued" });
    applySnapshot(snapshot([a, b]));

    const setKey = vi.spyOn($jobs, "setKey");
    const aDownloading = { ...a, status: "Downloading" as const };
    applySnapshot(snapshot([aDownloading, b]));

    const keysWritten = setKey.mock.calls.map((c) => c[0]);
    expect(keysWritten).toEqual(["a"]);
    expect($jobs.get().a).toEqual(aDownloading);
    expect($jobs.get().b).toEqual(b);
    setKey.mockRestore();
  });

  it("removes a job whose id disappeared from the snapshot", () => {
    const a = job({ id: "a" as JobId });
    const b = job({ id: "b" as JobId });
    applySnapshot(snapshot([a, b]));
    applySnapshot(snapshot([a]));

    expect($jobs.get().a).toEqual(a);
    expect($jobs.get().b).toBeUndefined();
  });

  describe("showTransient", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sets the message immediately and clears after 2s", () => {
      showTransient("hello");
      expect($transient.get()).toBe("hello");
      vi.advanceTimersByTime(1999);
      expect($transient.get()).toBe("hello");
      vi.advanceTimersByTime(1);
      expect($transient.get()).toBeNull();
    });

    it("a second call resets the timer", () => {
      showTransient("first");
      vi.advanceTimersByTime(1500);
      showTransient("second");
      vi.advanceTimersByTime(1500);
      expect($transient.get()).toBe("second");
      vi.advanceTimersByTime(500);
      expect($transient.get()).toBeNull();
    });
  });
});
