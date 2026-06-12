import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineSnapshot, Job, JobId } from "@scribd-dl/shared";
import { $jobs, $transient, applySnapshot, dismissSticky, resetStores, showTransient } from "@/store";

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

  it("snapshot preserves newest-first order (engine-authoritative)", () => {
    // #given — first snapshot adds A, B
    const a = job({ id: "a" as JobId });
    const b = job({ id: "b" as JobId });
    applySnapshot(snapshot([a, b]));
    expect(Object.keys($jobs.get())).toEqual(["a", "b"]);

    // #when — engine moves B to top
    applySnapshot(snapshot([b, a]));

    // #then — object iteration matches snapshot order
    expect(Object.keys($jobs.get())).toEqual(["b", "a"]);
  });

  it("status change on existing job updates content", () => {
    const a = job({ id: "a" as JobId, status: "Queued" });
    const b = job({ id: "b" as JobId, status: "Queued" });
    applySnapshot(snapshot([a, b]));

    const aDownloading = { ...a, status: "Downloading" as const };
    applySnapshot(snapshot([aDownloading, b]));

    expect($jobs.get().a).toEqual(aDownloading);
    expect($jobs.get().b).toEqual(b);
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

    it("sets info message immediately and clears after 2s", () => {
      // #given/when
      showTransient("info", "hello");

      // #then
      expect($transient.get()).toEqual({ severity: "info", message: "hello", sticky: false });
      vi.advanceTimersByTime(1999);
      expect($transient.get()?.message).toBe("hello");
      vi.advanceTimersByTime(1);
      expect($transient.get()).toBeNull();
    });

    it("error message lasts longer than info", () => {
      // #given/when
      showTransient("error", "boom");

      // #then — error timer is longer than info's 2s
      vi.advanceTimersByTime(2500);
      expect($transient.get()?.message).toBe("boom");
      vi.advanceTimersByTime(4000);
      expect($transient.get()).toBeNull();
    });

    it("higher severity overwrites lower", () => {
      // #given
      showTransient("info", "info-msg");

      // #when
      showTransient("error", "error-msg");

      // #then
      expect($transient.get()?.message).toBe("error-msg");
      expect($transient.get()?.severity).toBe("error");
    });

    it("lower severity does NOT overwrite higher", () => {
      // #given
      showTransient("error", "error-msg");

      // #when
      showTransient("info", "info-msg");

      // #then
      expect($transient.get()?.message).toBe("error-msg");
    });

    it("equal severity resets the timer", () => {
      // #given
      showTransient("info", "first");

      // #when
      vi.advanceTimersByTime(1500);
      showTransient("info", "second");
      vi.advanceTimersByTime(1500);

      // #then
      expect($transient.get()?.message).toBe("second");
      vi.advanceTimersByTime(500);
      expect($transient.get()).toBeNull();
    });

    it("sticky=true skips the auto-dismiss timer", () => {
      // #given/when
      showTransient("error", "disconnected", { sticky: true });

      // #then
      vi.advanceTimersByTime(60_000);
      expect($transient.get()?.message).toBe("disconnected");
      expect($transient.get()?.sticky).toBe(true);
    });

    it("sticky error blocks warning but accepts another error", () => {
      // #given
      showTransient("error", "disconnected", { sticky: true });

      // #when warning arrives → ignored
      showTransient("warning", "noise");

      // #then
      expect($transient.get()?.message).toBe("disconnected");

      // #when error arrives → replaces
      showTransient("error", "newer");

      // #then
      expect($transient.get()?.message).toBe("newer");
      expect($transient.get()?.sticky).toBe(false);
    });

    it("ignored lower-severity feedback does not reset the existing timer", () => {
      // #given — error timer is 6000ms
      showTransient("error", "boom");

      // #when — ignored info arrives partway through, then we wait past info's 2000ms duration
      vi.advanceTimersByTime(1500);
      showTransient("info", "noise");
      vi.advanceTimersByTime(2500);

      // #then — error still visible because original 6000ms timer was not reset to info's 2000ms
      expect($transient.get()?.message).toBe("boom");
    });

    it("dismissSticky clears state unconditionally", () => {
      // #given
      showTransient("error", "disconnected", { sticky: true });

      // #when
      dismissSticky();

      // #then
      expect($transient.get()).toBeNull();
    });
  });
});
