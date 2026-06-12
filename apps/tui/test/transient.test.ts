import { describe, expect, test } from "bun:test";
import { applyTransient, compareSeverity, severityTimer } from "../src/tui/transient";

describe("compareSeverity", () => {
  test("ranks info < warning < error", () => {
    expect(compareSeverity("info", "warning")).toBeLessThan(0);
    expect(compareSeverity("warning", "error")).toBeLessThan(0);
    expect(compareSeverity("error", "info")).toBeGreaterThan(0);
    expect(compareSeverity("warning", "warning")).toBe(0);
  });
});

describe("severityTimer", () => {
  test("returns per-severity timeout (info=2000, warning=4000, error=6000)", () => {
    expect(severityTimer("info")).toBe(2000);
    expect(severityTimer("warning")).toBe(4000);
    expect(severityTimer("error")).toBe(6000);
  });
});

describe("applyTransient", () => {
  test("null current accepts any incoming", () => {
    expect(applyTransient(null, "info", "msg")).toEqual({ severity: "info", message: "msg", sticky: false });
  });

  test("info current overwritten by warning", () => {
    const cur = { severity: "info" as const, message: "a", sticky: false };
    expect(applyTransient(cur, "warning", "b")).toEqual({ severity: "warning", message: "b", sticky: false });
  });

  test("error current blocks incoming info/warning", () => {
    const cur = { severity: "error" as const, message: "a", sticky: false };
    expect(applyTransient(cur, "info", "b")).toBe(cur);
    expect(applyTransient(cur, "warning", "b")).toBe(cur);
  });

  test("error current accepts another error", () => {
    const cur = { severity: "error" as const, message: "a", sticky: false };
    expect(applyTransient(cur, "error", "b")).toEqual({ severity: "error", message: "b", sticky: false });
  });

  test("sticky error blocks warning, accepts error", () => {
    const cur = { severity: "error" as const, message: "stuck", sticky: true };
    expect(applyTransient(cur, "warning", "b")).toBe(cur);
    expect(applyTransient(cur, "error", "b")).toEqual({ severity: "error", message: "b", sticky: false });
  });

  test("equal severity overwrites", () => {
    const cur = { severity: "info" as const, message: "a", sticky: false };
    expect(applyTransient(cur, "info", "b")).toEqual({ severity: "info", message: "b", sticky: false });
  });

  test("opts.sticky=true sets sticky on result", () => {
    expect(applyTransient(null, "error", "x", { sticky: true })).toEqual({ severity: "error", message: "x", sticky: true });
  });
});
