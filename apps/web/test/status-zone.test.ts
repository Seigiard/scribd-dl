import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "uhtml";
import type { Job, JobId } from "@scribd-dl/shared";

const clearFinishedMock = vi.fn();
const clearAllMock = vi.fn();

vi.mock("@/engineClient", () => ({
  commandClearFinished: clearFinishedMock,
  commandClearAll: clearAllMock,
}));

const { statusZone } = await import("@/views/status-zone");

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

const job = (id: string, status: Job["status"]): Job =>
  ({
    id: id as JobId,
    url: `https://scribd.com/${id}`,
    domain: "scribd",
    displayTitle: id,
    status,
  }) as Job;

const renderTo = (props: Parameters<typeof statusZone>[0]): HTMLDivElement => {
  const container = document.createElement("div");
  render(container, statusZone(props));
  return container;
};

describe("statusZone view", () => {
  beforeEach(() => {
    clearFinishedMock.mockReset();
    clearAllMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows default hint when transient is null", () => {
    // #when
    const c = renderTo({ transient: null, jobs: {} });

    // #then
    expect(c.querySelector(".status-zone-text")?.textContent).toBe(DEFAULT_HINT);
  });

  it("shows the transient message with severity class", () => {
    // #when
    const c = renderTo({
      transient: { severity: "error", message: "boom", sticky: false },
      jobs: {},
    });

    // #then
    const text = c.querySelector(".status-zone-text") as HTMLElement | null;
    expect(text?.textContent).toBe("boom");
    expect(text?.classList.contains("status-zone-error")).toBe(true);
  });

  it("both buttons disabled when queue is empty", () => {
    // #when
    const c = renderTo({ transient: null, jobs: {} });
    const buttons = c.querySelectorAll("button");

    // #then
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(true);
  });

  it("Clear All enabled and Clear Finished disabled when only Queued jobs present", () => {
    // #when
    const c = renderTo({ transient: null, jobs: { a: job("a", "Queued"), b: job("b", "Queued") } });
    const buttons = c.querySelectorAll("button");

    // #then
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
  });

  it("Clear Finished enabled when terminal jobs present", () => {
    // #when
    const c = renderTo({
      transient: null,
      jobs: { a: job("a", "Downloaded"), b: job("b", "Failed"), c: job("c", "Queued") },
    });
    const buttons = c.querySelectorAll("button");

    // #then
    expect(buttons[0]!.disabled).toBe(false);
    expect(buttons[1]!.disabled).toBe(false);
  });

  it("clicking Clear Finished invokes commandClearFinished", () => {
    // #given
    const c = renderTo({ transient: null, jobs: { a: job("a", "Downloaded") } });

    // #when
    (c.querySelectorAll("button")[0] as HTMLButtonElement).click();

    // #then
    expect(clearFinishedMock).toHaveBeenCalledTimes(1);
  });

  it("clicking Clear All invokes commandClearAll", () => {
    // #given
    const c = renderTo({ transient: null, jobs: { a: job("a", "Queued") } });

    // #when
    (c.querySelectorAll("button")[1] as HTMLButtonElement).click();

    // #then
    expect(clearAllMock).toHaveBeenCalledTimes(1);
  });
});
