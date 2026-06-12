import { describe, expect, test } from "bun:test";
import type { EngineSnapshot, Job, JobId } from "@scribd-dl/shared";
import { computeFocusable } from "../src/tui/focus";

const job = (id: string, status: Job["status"], extra: Partial<Job> = {}): Job => ({
  id: id as JobId,
  url: `https://scribd.com/${id}`,
  domain: "scribd",
  displayTitle: id,
  status,
  ...extra,
});

const snap = (...jobs: Job[]): EngineSnapshot => ({ jobs });

describe("computeFocusable", () => {
  test("empty queue, no transient → [change]", () => {
    const { slots } = computeFocusable(snap(), null);
    expect(slots.map((s) => s.kind)).toEqual(["change"]);
  });

  test("transient active suppresses Clear buttons regardless of state", () => {
    const transient = { severity: "warning" as const, message: "x", sticky: false };
    const { slots } = computeFocusable(snap(job("a", "Downloaded"), job("b", "Queued")), transient);
    expect(slots.map((s) => s.kind)).toEqual(["change", "remove"]);
  });

  test("queued-only queue includes clearAll but not clearFinished", () => {
    const { slots } = computeFocusable(snap(job("a", "Queued"), job("b", "Queued")), null);
    expect(slots.map((s) => s.kind)).toEqual(["change", "clearAll", "remove", "remove"]);
  });

  test("mixed terminal+queued includes both Clear buttons", () => {
    const { slots } = computeFocusable(snap(job("a", "Downloaded"), job("b", "Queued")), null);
    expect(slots.map((s) => s.kind)).toEqual(["change", "clearFinished", "clearAll", "remove"]);
  });

  test("Failed retryable=true adds a retry slot after removes", () => {
    const { slots } = computeFocusable(snap(job("a", "Failed", { failure: { reason: "x", retryable: true } }), job("b", "Queued")), null);
    expect(slots.map((s) => s.kind)).toEqual(["change", "clearFinished", "clearAll", "remove", "retry"]);
  });

  test("Failed retryable=false produces only clearFinished, no retry slot", () => {
    const { slots } = computeFocusable(snap(job("a", "Failed", { failure: { reason: "x", retryable: false } })), null);
    expect(slots.map((s) => s.kind)).toEqual(["change", "clearFinished", "clearAll"]);
  });
});
