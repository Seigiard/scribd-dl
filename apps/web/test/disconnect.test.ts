import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "uhtml";

const reconnectMock = vi.fn();
vi.mock("@/engineClient", () => ({
  reconnect: reconnectMock,
}));

const { disconnectBanner } = await import("@/views/disconnect-banner");

describe("disconnectBanner()", () => {
  beforeEach(() => {
    reconnectMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing when connected", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, disconnectBanner({ connected: true }));

    // #then
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent?.trim()).toBe("");
  });

  it("shows Disconnected text and Reconnect button when disconnected", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, disconnectBanner({ connected: false }));

    // #then
    expect(container.textContent).toContain("Disconnected");
    expect(container.querySelector("button")?.textContent?.trim()).toBe("Reconnect");
  });

  it("clicking Reconnect calls engineClient.reconnect", () => {
    // #given
    const container = document.createElement("div");
    render(container, disconnectBanner({ connected: false }));
    const button = container.querySelector("button")!;

    // #when
    button.click();

    // #then
    expect(reconnectMock).toHaveBeenCalledTimes(1);
  });
});
