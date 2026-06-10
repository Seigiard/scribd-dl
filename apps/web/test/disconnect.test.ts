import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reconnectMock = vi.fn();
vi.mock("@/engineClient", () => ({
  reconnect: reconnectMock,
}));

await import("@/components/sd-disconnect-banner");
const { $connected, resetStores } = await import("@/store");

describe("<sd-disconnect-banner>", () => {
  beforeEach(() => {
    resetStores();
    reconnectMock.mockReset();
    document.body.innerHTML = "<sd-disconnect-banner></sd-disconnect-banner>";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is visible when $connected is false", () => {
    const banner = document.querySelector("sd-disconnect-banner") as HTMLElement;
    expect(banner.hidden).toBe(false);
  });

  it("hides when $connected becomes true", () => {
    $connected.set(true);
    const banner = document.querySelector("sd-disconnect-banner") as HTMLElement;
    expect(banner.hidden).toBe(true);
  });

  it("clicking Reconnect calls engineClient.reconnect", () => {
    const button = document.querySelector('sd-disconnect-banner button[data-ref="reconnect"]') as HTMLButtonElement;
    button.click();
    expect(reconnectMock).toHaveBeenCalledTimes(1);
  });
});
