import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enqueueTextMock = vi.fn(async () => ({ jobs: [] }));
const fetchSnapshotMock = vi.fn(async () => ({ jobs: [] }));
const fetchFolderMock = vi.fn(async () => "/tmp/out");
const removeJobMock = vi.fn(async () => {});
const retryJobMock = vi.fn(async () => {});
const setFolderMock = vi.fn(async () => {});

vi.mock("@/lib/api", () => ({
  enqueueText: enqueueTextMock,
  fetchSnapshot: fetchSnapshotMock,
  fetchFolder: fetchFolderMock,
  removeJob: removeJobMock,
  retryJob: retryJobMock,
  setFolder: setFolderMock,
}));

const { __testing, attachPasteHandler, detachPasteHandler, handlePastedText } = await import("@/engineClient");
const { $transient, resetStores } = await import("@/store");

const FAKE_URL = "http://engine.test";

describe("paste handler", () => {
  beforeEach(() => {
    resetStores();
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
    enqueueTextMock.mockResolvedValueOnce({ jobs: [{ id: "x" }] as never });
    await handlePastedText("look at this https://scribd.com/doc/123");
    expect(enqueueTextMock).toHaveBeenCalledWith(FAKE_URL, "look at this https://scribd.com/doc/123");
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

  const makePasteEvent = (text: string): ClipboardEvent => {
    const evt = new Event("paste", { bubbles: true }) as ClipboardEvent;
    Object.defineProperty(evt, "clipboardData", {
      value: { getData: (type: string) => (type === "text" ? text : "") },
    });
    return evt;
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
