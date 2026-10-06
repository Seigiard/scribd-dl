import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobEvents as events, type JobEvent } from "@scribd-dl/shared";
import * as api from "@/lib/api";

const fetchSnapshotMock = vi.fn(async () => ({ jobs: [] }));

const fetchFolderMock = vi.fn(async () => "/tmp/out");

const { __testing } = await import("@/engineClient");

const { $folder, resetStores } = await import("@/store");

const FAKE_URL = "http://engine.test";

describe("engineClient WS event handling", () => {
  beforeEach(() => {
    resetStores();
    __testing.setApi({ ...api, fetchSnapshot: fetchSnapshotMock, fetchFolder: fetchFolderMock });
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
    __testing.handleWsEvent(events.OutputFolderChanged({ path: "/external/dir" }));

    // #then
    expect($folder.get()).toBe("/external/dir");
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it("JobAdded triggers snapshot refresh, does not touch $folder", async () => {
    $folder.set("/keep");
    __testing.handleWsEvent(
      events.JobAdded({
        job: {
          id: "j1",
          url: "https://scribd.com/x",
          domain: "scribd",
          displayTitle: "x",
          status: "Queued",
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect($folder.get()).toBe("/keep");
  });

  it.each<JobEvent>([
    events.JobStarted({ id: "j1" }),
    events.JobCompleted({ id: "j1" }),
    events.JobRemoved({ id: "j1" }),
    events.JobRequeued({ id: "j1" }),
    events.JobFailed({ id: "j1", reason: "x", retryable: false }),
    events.JobTitleUpdated({ id: "j1", title: "y" }),
    events.JobProgress({ id: "j1", done: 1, total: 2, stage: "render" }),
  ])("non-folder event $_tag triggers refresh", async (event) => {
    __testing.handleWsEvent(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("OutputFolderChanged with empty string sets $folder to empty (engine-authoritative)", () => {
    __testing.handleWsEvent(events.OutputFolderChanged({ path: "" }));
    expect($folder.get()).toBe("");
  });

  it("SnapshotReplaced applies snapshot inline without HTTP refresh", async () => {
    // #given
    const { $jobs } = await import("@/store");

    // #when
    __testing.handleWsEvent(
      events.SnapshotReplaced({
        snapshot: {
          jobs: [
            {
              id: "ws-snap",
              url: "https://scribd.com/y",
              domain: "scribd",
              displayTitle: "y",
              status: "Queued",
            },
          ],
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    // #then
    expect($jobs.get()["ws-snap"]).toEqual({
      id: "ws-snap",
      url: "https://scribd.com/y",
      domain: "scribd",
      displayTitle: "y",
      status: "Queued",
    });
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });
});
