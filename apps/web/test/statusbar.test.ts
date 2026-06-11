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
    render(container, statusbar({ transient: "No links found in clipboard" }));

    // #then
    expect(container.textContent).toBe("No links found in clipboard");
  });

  it("treats an empty string as a valid transient (no fallback)", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, statusbar({ transient: "" }));

    // #then
    expect(container.textContent).toBe("");
  });
});
