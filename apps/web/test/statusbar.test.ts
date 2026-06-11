import { describe, expect, it } from "vitest";
import { render } from "uhtml";
import { statusbar } from "@/views/statusbar";

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

describe("statusbar()", () => {
  it("shows the default hint when transient is null", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, statusbar({ transient: null }));

    // #then
    expect(container.textContent).toBe(DEFAULT_HINT);
  });

  it("shows the transient message when provided", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, statusbar({ transient: { severity: "info", message: "No links found in clipboard" } }));

    // #then
    expect(container.textContent).toBe("No links found in clipboard");
  });

  it("applies severity class to the statusbar element", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, statusbar({ transient: { severity: "error", message: "Disconnected", sticky: true } }));

    // #then
    const el = container.querySelector(".statusbar") as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el!.classList.contains("statusbar-error")).toBe(true);
  });
});
