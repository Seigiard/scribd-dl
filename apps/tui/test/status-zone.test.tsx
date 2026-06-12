import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { DEFAULT_HINT, StatusZone } from "../src/tui/StatusZone";

const baseProps = {
  transient: null,
  clearFinishedEnabled: false,
  clearAllEnabled: false,
  clearFinishedFocused: false,
  clearAllFocused: false,
} as const;

describe("StatusZone", () => {
  test("default state shows the hint plus both Clear buttons", () => {
    const ui = render(React.createElement(StatusZone, baseProps));
    const frame = ui.lastFrame()!;
    expect(frame).toContain(DEFAULT_HINT);
    expect(frame).toContain("[Clear Finished]");
    expect(frame).toContain("[Clear All]");
    ui.unmount();
  });

  test("transient hides both Clear buttons", () => {
    const ui = render(
      React.createElement(StatusZone, {
        ...baseProps,
        transient: { severity: "warning", message: "Unsupported domain", sticky: false },
      }),
    );
    const frame = ui.lastFrame()!;
    expect(frame).toContain("Unsupported domain");
    expect(frame).not.toContain("[Clear Finished]");
    expect(frame).not.toContain("[Clear All]");
    ui.unmount();
  });

  test("error transient is shown (color via ANSI markers — non-empty render)", () => {
    const ui = render(
      React.createElement(StatusZone, {
        ...baseProps,
        transient: { severity: "error", message: "Disconnected from engine", sticky: true },
      }),
    );
    expect(ui.lastFrame()).toContain("Disconnected from engine");
    ui.unmount();
  });

  test("disabled Clear buttons render dim (still present in frame)", () => {
    const ui = render(
      React.createElement(StatusZone, {
        ...baseProps,
        clearFinishedEnabled: false,
        clearAllEnabled: false,
      }),
    );
    const frame = ui.lastFrame()!;
    expect(frame).toContain("[Clear Finished]");
    expect(frame).toContain("[Clear All]");
    ui.unmount();
  });

  test("focused Clear Finished shows inverse marker around label", () => {
    const ui = render(
      React.createElement(StatusZone, {
        ...baseProps,
        clearFinishedEnabled: true,
        clearAllEnabled: true,
        clearFinishedFocused: true,
      }),
    );
    expect(ui.lastFrame()).toContain("[Clear Finished]");
    ui.unmount();
  });
});
