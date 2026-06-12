import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { Text } from "ink";
import React from "react";
import { useTransient, type UseTransient } from "../src/hooks/useTransient";

const flush = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));

let api: UseTransient | null = null;

const Probe = () => {
  const t = useTransient();
  api = t;
  return React.createElement(Text, null, `s=${t.transient?.severity ?? "null"} m=${t.transient?.message ?? "-"}`);
};

beforeEach(() => {
  api = null;
});

afterEach(() => {
  api = null;
});

describe("useTransient", () => {
  test("showTransient sets state and clears after timer", async () => {
    const ui = render(React.createElement(Probe));
    await flush();
    api!.showTransient("info", "hello");
    await flush();
    expect(ui.lastFrame()).toContain("s=info");
    expect(ui.lastFrame()).toContain("m=hello");
    await flush(2100);
    expect(ui.lastFrame()).toContain("s=null");
    ui.unmount();
  });

  test("sticky error stays without timer", async () => {
    const ui = render(React.createElement(Probe));
    await flush();
    api!.showTransient("error", "stuck", { sticky: true });
    await flush(50);
    expect(ui.lastFrame()).toContain("s=error");
    expect(ui.lastFrame()).toContain("m=stuck");
    ui.unmount();
  });

  test("dismissSticky clears state", async () => {
    const ui = render(React.createElement(Probe));
    await flush();
    api!.showTransient("error", "stuck", { sticky: true });
    await flush();
    api!.dismissSticky();
    await flush();
    expect(ui.lastFrame()).toContain("s=null");
    ui.unmount();
  });

  test("lower severity does not overwrite higher one", async () => {
    const ui = render(React.createElement(Probe));
    await flush();
    api!.showTransient("error", "boom");
    await flush();
    api!.showTransient("info", "later");
    await flush();
    expect(ui.lastFrame()).toContain("s=error");
    expect(ui.lastFrame()).toContain("m=boom");
    ui.unmount();
  });

  test("ignored lower-severity message does not reset the existing timer", async () => {
    // #given
    const ui = render(React.createElement(Probe));
    await flush();
    api!.showTransient("error", "boom"); // 6000ms timer
    await flush(50);

    // #when — sneak in an ignored info, then wait until just past the lower-severity duration
    api!.showTransient("info", "should be ignored");
    await flush(2200); // > info duration (2000ms) — if timer was reset to info, state would have cleared

    // #then — error is still on screen because original error timer was not reset by the ignored message
    expect(ui.lastFrame()).toContain("s=error");
    expect(ui.lastFrame()).toContain("m=boom");
    ui.unmount();
  });
});
