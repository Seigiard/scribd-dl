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
const { $folder, resetStores } = await import("@/store");

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
});
