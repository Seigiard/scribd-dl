import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clearFinishedMock = vi.fn(async () => 0);
const clearAllMock = vi.fn(async () => 0);

vi.mock("@/lib/api", () => ({
  enqueueText: vi.fn(),
  fetchSnapshot: vi.fn(async () => ({ jobs: [] })),
  fetchFolder: vi.fn(async () => "/tmp/out"),
  removeJob: vi.fn(),
  retryJob: vi.fn(),
  setFolder: vi.fn(),
  clearFinished: clearFinishedMock,
  clearAll: clearAllMock,
}));

const { __testing, commandClearAll, commandClearFinished } = await import("@/engineClient");
const { $jobs, $transient, resetStores } = await import("@/store");

const FAKE_URL = "http://engine.test";

describe("commandClearFinished", () => {
  beforeEach(() => {
    resetStores();
    clearFinishedMock.mockReset();
    clearFinishedMock.mockResolvedValue(0);
    __testing.setBaseUrl(FAKE_URL);
  });

  afterEach(() => {
    __testing.reset();
  });

  it("delegates to api.clearFinished with current baseUrl", async () => {
    // #when
    await commandClearFinished();

    // #then
    expect(clearFinishedMock).toHaveBeenCalledWith(FAKE_URL);
  });

  it("on HTTP failure surfaces error toast", async () => {
    // #given
    clearFinishedMock.mockRejectedValueOnce(new Error("boom"));

    // #when
    await commandClearFinished();

    // #then
    expect($transient.get()?.severity).toBe("error");
    expect($transient.get()?.message).toBe("boom");
  });
});

describe("commandClearAll", () => {
  beforeEach(() => {
    resetStores();
    clearAllMock.mockReset();
    clearAllMock.mockResolvedValue(0);
    __testing.setBaseUrl(FAKE_URL);
  });

  afterEach(() => {
    __testing.reset();
    vi.restoreAllMocks();
  });

  const seedJobs = (count: number): void => {
    for (let i = 0; i < count; i++) {
      $jobs.setKey(`j${i}`, {
        id: `j${i}`,
        url: `https://scribd.com/${i}`,
        domain: "scribd",
        displayTitle: `${i}`,
        status: "Queued",
      } as never);
    }
  };

  it("does nothing when queue is empty", async () => {
    // #when
    await commandClearAll();

    // #then
    expect(clearAllMock).not.toHaveBeenCalled();
  });

  it("calls clearAll on confirm", async () => {
    // #given
    seedJobs(3);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    // #when
    await commandClearAll();

    // #then
    expect(clearAllMock).toHaveBeenCalledWith(FAKE_URL);
  });

  it("skips clearAll on cancel", async () => {
    // #given
    seedJobs(3);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    // #when
    await commandClearAll();

    // #then
    expect(clearAllMock).not.toHaveBeenCalled();
  });

  it("on HTTP failure surfaces error toast", async () => {
    // #given
    seedJobs(1);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    clearAllMock.mockRejectedValueOnce(new Error("server down"));

    // #when
    await commandClearAll();

    // #then
    expect($transient.get()?.severity).toBe("error");
    expect($transient.get()?.message).toBe("server down");
  });
});
