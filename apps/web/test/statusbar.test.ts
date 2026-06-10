import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/components/sd-statusbar";
import { $transient, resetStores } from "@/store";

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

describe("<sd-statusbar>", () => {
  beforeEach(() => {
    resetStores();
    document.body.innerHTML = "<sd-statusbar></sd-statusbar>";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the default hint when $transient is null", () => {
    const bar = document.querySelector("sd-statusbar")!;
    expect(bar.textContent).toBe(DEFAULT_HINT);
  });

  it("swaps to the transient message", () => {
    $transient.set("No links found in clipboard");
    const bar = document.querySelector("sd-statusbar")!;
    expect(bar.textContent).toBe("No links found in clipboard");
  });

  it("falls back to the default when transient clears", () => {
    $transient.set("nope");
    $transient.set(null);
    const bar = document.querySelector("sd-statusbar")!;
    expect(bar.textContent).toBe(DEFAULT_HINT);
  });
});
