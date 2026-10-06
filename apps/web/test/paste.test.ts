import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";

const enqueueTextMock = vi.fn<typeof api.enqueueText>(async () => ({ jobs: [] }));

const clearAllMock = vi.fn(async () => 0);

const clearFinishedMock = vi.fn(async () => 0);

const fetchSnapshotMock = vi.fn(async () => ({ jobs: [] }));

const fetchFolderMock = vi.fn(async () => "/tmp/out");

const removeJobMock = vi.fn(async () => {});

const retryJobMock = vi.fn(async () => {});

const setFolderMock = vi.fn(async () => {});

const { __testing, attachPasteHandler, detachPasteHandler, handlePastedText } =
  await import("@/engineClient");

const { $transient, resetStores } = await import("@/store");

const FAKE_URL = "http://engine.test";

describe("paste handler", () => {
  beforeEach(() => {
    resetStores();
    __testing.setApi({
      ...api,
      clearAll: clearAllMock,
      clearFinished: clearFinishedMock,
      enqueueText: enqueueTextMock,
      fetchSnapshot: fetchSnapshotMock,
      fetchFolder: fetchFolderMock,
      removeJob: removeJobMock,
      retryJob: retryJobMock,
      setFolder: setFolderMock,
    });
    enqueueTextMock.mockReset();
    enqueueTextMock.mockResolvedValue({ jobs: [] });
    __testing.setBaseUrl(FAKE_URL);
  });

  afterEach(() => {
    detachPasteHandler();
    __testing.reset();
    document.body.innerHTML = "";
  });

  it("posts the pasted text when at least one https URL is present", async () => {
    enqueueTextMock.mockResolvedValueOnce({
      jobs: [
        {
          id: "x",
          url: "https://scribd.com/doc/123",
          domain: "scribd",
          displayTitle: "123",
          status: "Queued",
        },
      ],
    });
    await handlePastedText("look at this https://scribd.com/doc/123");
    expect(enqueueTextMock).toHaveBeenCalledWith(
      FAKE_URL,
      "look at this https://scribd.com/doc/123",
    );
    expect($transient.get()).toBeNull();
  });

  it("shows the transient when no URL is found", async () => {
    await handlePastedText("no links here");
    expect(enqueueTextMock).not.toHaveBeenCalled();
    expect($transient.get()?.message).toBe("No links found in clipboard");
  });

  it("shows the transient when the server accepted zero jobs", async () => {
    enqueueTextMock.mockResolvedValueOnce({ jobs: [] });
    await handlePastedText("https://unsupported.example.com/abc");
    expect(enqueueTextMock).toHaveBeenCalledTimes(1);
    expect($transient.get()?.message).toBe("No links found in clipboard");
  });

  it("shows a warning when every link is rejected as Failed retryable=false", async () => {
    enqueueTextMock.mockResolvedValueOnce({
      jobs: [
        {
          id: "u",
          url: "https://example.com/x",
          domain: "unsupported",
          displayTitle: "x",
          status: "Failed",
          failure: { reason: "Unsupported domain", retryable: false },
        },
      ],
    });
    await handlePastedText("https://example.com/x");
    expect($transient.get()?.severity).toBe("warning");
    expect($transient.get()?.message).toBe("Unsupported domain");
  });

  const makePasteEvent = (text: string): Event => {
    const event = new Event("paste", { bubbles: true });

    const clipboardData: Pick<DataTransfer, "getData"> = {
      getData: (format) => (format === "text" ? text : ""),
    };

    Object.defineProperty(event, "clipboardData", { value: clipboardData });

    return event;
  };

  it("ignores paste events whose target is an INPUT", () => {
    attachPasteHandler();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(makePasteEvent("https://scribd.com/doc/1"));
    expect(enqueueTextMock).not.toHaveBeenCalled();
  });

  it("routes window paste events through handlePastedText", () => {
    attachPasteHandler();
    window.dispatchEvent(makePasteEvent("https://scribd.com/doc/2"));
    expect(enqueueTextMock).toHaveBeenCalledTimes(1);
  });
});
