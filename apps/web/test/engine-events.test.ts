import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@scribd-dl/shared";

const fetchSnapshotMock = vi.fn(async () => ({ jobs: [] }));
const fetchFolderMock = vi.fn(async () => "/tmp/out");

vi.mock("@/lib/api", () => ({
  enqueueText: vi.fn(),
  fetchSnapshot: fetchSnapshotMock,
  fetchFolder: fetchFolderMock,
  removeJob: vi.fn(),
  retryJob: vi.fn(),
  setFolder: vi.fn(),
}));

const { __testing } = await import("@/engineClient");
const { $folder, $jobs, resetStores } = await import("@/store");

const FAKE_URL = "http://engine.test";

describe("engineClient WS event handling", () => {
  beforeEach(() => {
    resetStores();
    fetchSnapshotMock.mockClear();
    fetchFolderMock.mockClear();
    __testing.setBaseUrl(FAKE_URL);
  });

  afterEach(() => {
    __testing.reset();
  });

  it("OutputFolderChanged updates $folder without snapshot refresh", () => {
    // #given
    expect($folder.get()).toBeNull();

    // #when
    __testing.handleWsEvent({ _tag: "OutputFolderChanged", path: "/external/dir" });

    // #then
    expect($folder.get()).toBe("/external/dir");
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it("JobAdded triggers snapshot refresh, does not touch $folder", async () => {
    $folder.set("/keep");
    __testing.handleWsEvent({
      _tag: "JobAdded",
      job: {
        id: "j1",
        url: "https://scribd.com/x",
        domain: "scribd",
        displayTitle: "x",
        status: "Queued",
      } as never,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect($folder.get()).toBe("/keep");
  });

  it.each<JobEvent>([
    { _tag: "JobStarted", id: "j1" as never },
    { _tag: "JobCompleted", id: "j1" as never },
    { _tag: "JobRemoved", id: "j1" as never },
    { _tag: "JobRequeued", id: "j1" as never },
    { _tag: "JobFailed", id: "j1" as never, reason: "x", retryable: false },
    { _tag: "JobTitleUpdated", id: "j1" as never, title: "y" },
    { _tag: "JobProgress", id: "j1" as never, done: 1, total: 2, stage: "render" },
  ])("non-folder event $_tag triggers refresh", async (event) => {
    __testing.handleWsEvent(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("OutputFolderChanged with empty string sets $folder to empty (engine-authoritative)", () => {
    __testing.handleWsEvent({ _tag: "OutputFolderChanged", path: "" });
    expect($folder.get()).toBe("");
  });

  describe("native notifications (Tauri runtime)", () => {
    const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();

    const setVisibility = (state: "visible" | "hidden"): void => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
    };

    beforeEach(() => {
      invokeMock.mockReset();
      invokeMock.mockResolvedValue(undefined);
      // @ts-expect-error — install Tauri global for this scope
      window.__TAURI__ = { core: { invoke: invokeMock } };
      setVisibility("hidden");
      $jobs.set({
        j1: {
          id: "j1" as never,
          url: "https://www.scribd.com/document/1/Quick-Brown-Fox",
          domain: "scribd",
          displayTitle: "Quick Brown Fox",
          status: "Downloaded",
        } as never,
      });
    });

    afterEach(() => {
      // @ts-expect-error — clean global between tests
      delete window.__TAURI__;
      setVisibility("visible");
    });

    it("does not notify when Tauri runtime is absent", async () => {
      // #given
      // @ts-expect-error
      delete window.__TAURI__;

      // #when
      __testing.handleWsEvent({ _tag: "JobCompleted", id: "j1" as never });
      await new Promise((r) => setTimeout(r, 0));

      // #then
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it("does not notify while window is focused (visible)", async () => {
      // #given
      setVisibility("visible");

      // #when
      __testing.handleWsEvent({ _tag: "JobCompleted", id: "j1" as never });
      await new Promise((r) => setTimeout(r, 0));

      // #then
      expect(invokeMock).not.toHaveBeenCalledWith("notify", expect.objectContaining({ title: "Downloaded" }));
    });

    it("JobCompleted while hidden invokes notify with displayTitle in body", async () => {
      // #when
      __testing.handleWsEvent({ _tag: "JobCompleted", id: "j1" as never });
      await new Promise((r) => setTimeout(r, 0));

      // #then
      expect(invokeMock).toHaveBeenCalledWith("notify", {
        title: "Downloaded",
        body: "Quick Brown Fox",
      });
    });

    it("JobFailed while hidden invokes notify with reason in body", async () => {
      // #when
      __testing.handleWsEvent({
        _tag: "JobFailed",
        id: "j1" as never,
        reason: "Network timeout",
        retryable: true,
      });
      await new Promise((r) => setTimeout(r, 0));

      // #then
      expect(invokeMock).toHaveBeenCalledWith("notify", {
        title: "Download failed",
        body: "Quick Brown Fox — Network timeout",
      });
    });

    it("JobCompleted for unknown id falls back to id in body", async () => {
      // #given — no matching entry in $jobs
      $jobs.set({});

      // #when
      __testing.handleWsEvent({ _tag: "JobCompleted", id: "missing" as never });
      await new Promise((r) => setTimeout(r, 0));

      // #then
      expect(invokeMock).toHaveBeenCalledWith("notify", {
        title: "Downloaded",
        body: "missing",
      });
    });

    it("non-completion events do not trigger notifications", async () => {
      // #when
      __testing.handleWsEvent({ _tag: "JobStarted", id: "j1" as never });
      await new Promise((r) => setTimeout(r, 0));

      // #then
      expect(invokeMock).not.toHaveBeenCalledWith("notify", expect.anything());
    });
  });
});
