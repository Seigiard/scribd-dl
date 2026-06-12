import { describe, expect, test } from "bun:test";
import type { Job } from "../src/jobs";
import {
  applyTransient,
  containsUrl,
  NO_LINKS_MESSAGE,
  summarizeEnqueueFeedback,
  TRANSIENT_DURATIONS,
  type TransientState,
} from "../src/clientFeedback";

const state = (severity: TransientState["severity"], message: string, sticky: boolean): TransientState => ({
  severity,
  message,
  sticky,
});

const job = (overrides: Partial<Job> & Pick<Job, "id" | "status">): Job => ({
  url: "https://example.test/doc",
  domain: "scribd",
  displayTitle: overrides.id,
  ...overrides,
});

describe("applyTransient", () => {
  test("ignores incoming info when current is sticky error (AE1)", () => {
    // #given
    const current = state("error", "Disconnected", true);

    // #when
    const result = applyTransient(current, { severity: "info", message: "loaded" });

    // #then
    expect(result.kind).toBe("ignored");
  });

  test("ignores incoming warning when current is sticky error (AE1)", () => {
    // #given
    const current = state("error", "Disconnected", true);

    // #when
    const result = applyTransient(current, { severity: "warning", message: "slow" });

    // #then
    expect(result.kind).toBe("ignored");
  });

  test("replaces sticky error when incoming is error with new sticky setting", () => {
    // #given
    const current = state("error", "Disconnected", true);

    // #when
    const result = applyTransient(current, { severity: "error", message: "Failed", sticky: false });

    // #then
    expect(result).toEqual({
      kind: "applied",
      state: { severity: "error", message: "Failed", sticky: false },
      dismissAfterMs: TRANSIENT_DURATIONS.error,
    });
  });

  test("applies warning over current info", () => {
    // #given
    const current = state("info", "ok", false);

    // #when
    const result = applyTransient(current, { severity: "warning", message: "watch out" });

    // #then
    expect(result).toEqual({
      kind: "applied",
      state: { severity: "warning", message: "watch out", sticky: false },
      dismissAfterMs: TRANSIENT_DURATIONS.warning,
    });
  });

  test("ignores info when current is non-sticky error", () => {
    // #given
    const current = state("error", "Failed", false);

    // #when
    const result = applyTransient(current, { severity: "info", message: "ok" });

    // #then
    expect(result.kind).toBe("ignored");
  });

  test("equal severity replaces and signals timer should be reset for non-sticky", () => {
    // #given
    const current = state("info", "first", false);

    // #when
    const result = applyTransient(current, { severity: "info", message: "second" });

    // #then
    expect(result).toEqual({
      kind: "applied",
      state: { severity: "info", message: "second", sticky: false },
      dismissAfterMs: TRANSIENT_DURATIONS.info,
    });
  });

  test("applied non-sticky info uses info duration (AE2)", () => {
    // #when
    const result = applyTransient(null, { severity: "info", message: "ok" });

    // #then
    expect(result).toEqual({
      kind: "applied",
      state: { severity: "info", message: "ok", sticky: false },
      dismissAfterMs: TRANSIENT_DURATIONS.info,
    });
  });

  test("applied non-sticky warning uses warning duration (AE2)", () => {
    // #when
    const result = applyTransient(null, { severity: "warning", message: "warn" });

    // #then
    expect(result).toEqual({
      kind: "applied",
      state: { severity: "warning", message: "warn", sticky: false },
      dismissAfterMs: TRANSIENT_DURATIONS.warning,
    });
  });

  test("applied non-sticky error uses error duration (AE2)", () => {
    // #when
    const result = applyTransient(null, { severity: "error", message: "err" });

    // #then
    expect(result).toEqual({
      kind: "applied",
      state: { severity: "error", message: "err", sticky: false },
      dismissAfterMs: TRANSIENT_DURATIONS.error,
    });
  });

  test("applied sticky feedback produces no auto-dismiss duration (AE2)", () => {
    // #when
    const result = applyTransient(null, { severity: "error", message: "Disconnected", sticky: true });

    // #then
    expect(result).toEqual({
      kind: "applied",
      state: { severity: "error", message: "Disconnected", sticky: true },
      dismissAfterMs: null,
    });
  });

  test("ignored result carries no timer instruction", () => {
    // #given
    const current = state("error", "Failed", false);

    // #when
    const result = applyTransient(current, { severity: "info", message: "ok" });

    // #then
    expect(result).toEqual({ kind: "ignored" });
  });
});

describe("summarizeEnqueueFeedback", () => {
  test("empty jobs produces no-links info outcome (AE3)", () => {
    // #when
    const result = summarizeEnqueueFeedback([]);

    // #then
    expect(result).toEqual({ severity: "info", message: NO_LINKS_MESSAGE, sticky: false });
  });

  test("one non-retryable failed job produces warning with its reason (AE3)", () => {
    // #given
    const jobs: Job[] = [
      job({ id: "j1", status: "Failed", failure: { reason: "Unsupported host", retryable: false } }),
    ];

    // #when
    const result = summarizeEnqueueFeedback(jobs);

    // #then
    expect(result).toEqual({ severity: "warning", message: "Unsupported host", sticky: false });
  });

  test("multiple all-rejected jobs produce warning with first reason and rejected count (AE3)", () => {
    // #given
    const jobs: Job[] = [
      job({ id: "j1", status: "Failed", failure: { reason: "Unsupported host", retryable: false } }),
      job({ id: "j2", status: "Failed", failure: { reason: "Bad link", retryable: false } }),
    ];

    // #when
    const result = summarizeEnqueueFeedback(jobs);

    // #then
    expect(result).toEqual({ severity: "warning", message: "Unsupported host (2 links)", sticky: false });
  });

  test("mixed accepted and non-retryable failed jobs produce partial-rejection warning (AE4)", () => {
    // #given
    const jobs: Job[] = [
      job({ id: "j1", status: "Queued" }),
      job({ id: "j2", status: "Queued" }),
      job({ id: "j3", status: "Failed", failure: { reason: "Bad link", retryable: false } }),
    ];

    // #when
    const result = summarizeEnqueueFeedback(jobs);

    // #then
    expect(result).toEqual({ severity: "warning", message: "1 of 3 links rejected", sticky: false });
  });

  test("retryable failed jobs are not counted as paste rejections (mixed)", () => {
    // #given
    const jobs: Job[] = [
      job({ id: "j1", status: "Queued" }),
      job({ id: "j2", status: "Failed", failure: { reason: "Network", retryable: true } }),
    ];

    // #when
    const result = summarizeEnqueueFeedback(jobs);

    // #then
    expect(result).toBeNull();
  });

  test("retryable failed jobs alone produce no enqueue feedback", () => {
    // #given
    const jobs: Job[] = [
      job({ id: "j1", status: "Failed", failure: { reason: "Network", retryable: true } }),
    ];

    // #when
    const result = summarizeEnqueueFeedback(jobs);

    // #then
    expect(result).toBeNull();
  });

  test("mixed retryable and non-retryable failures use only non-retryable as rejected count, all jobs as denominator", () => {
    // #given
    const jobs: Job[] = [
      job({ id: "j1", status: "Queued" }),
      job({ id: "j2", status: "Failed", failure: { reason: "Network", retryable: true } }),
      job({ id: "j3", status: "Failed", failure: { reason: "Unsupported", retryable: false } }),
    ];

    // #when
    const result = summarizeEnqueueFeedback(jobs);

    // #then
    expect(result).toEqual({ severity: "warning", message: "1 of 3 links rejected", sticky: false });
  });

  test("all accepted/queued jobs produce no enqueue feedback", () => {
    // #given
    const jobs: Job[] = [
      job({ id: "j1", status: "Queued" }),
      job({ id: "j2", status: "Downloading" }),
      job({ id: "j3", status: "Downloaded" }),
    ];

    // #when
    const result = summarizeEnqueueFeedback(jobs);

    // #then
    expect(result).toBeNull();
  });
});

describe("containsUrl", () => {
  test("returns false for plain text", () => {
    // #then
    expect(containsUrl("hello world")).toBe(false);
  });

  test("returns true for bare HTTP URL", () => {
    // #then
    expect(containsUrl("http://example.test")).toBe(true);
  });

  test("returns true for bare HTTPS URL", () => {
    // #then
    expect(containsUrl("https://example.test/path")).toBe(true);
  });

  test("returns true for markdown-style line with URL", () => {
    // #then
    expect(containsUrl("- https://example.test/doc")).toBe(true);
  });

  test("returns false for ftp:// URL (only HTTP/HTTPS preflight)", () => {
    // #then
    expect(containsUrl("ftp://example.test/file")).toBe(false);
  });
});

describe("module boundaries", () => {
  test("clientFeedback module imports no framework, DOM, timer, fetch, or WebSocket dependencies (AE5)", async () => {
    // #given — collect only import specifiers, so comments and string literals can't false-trigger
    const url = new URL("../src/clientFeedback.ts", import.meta.url);
    const source = await Bun.file(url).text();
    const importSpecifiers = Array.from(source.matchAll(/^\s*import[^;]*from\s+["']([^"']+)["']/gm)).map((m) => m[1]!);

    // #then — only same-package relative imports (e.g., "./jobs") are permitted
    const forbidden = new Set([
      "react",
      "react-dom",
      "ink",
      "nanostores",
      "@nanostores/preact",
      "uhtml",
      "puppeteer",
      "effect",
      "@effect/cli",
      "@effect/platform",
    ]);
    for (const spec of importSpecifiers) {
      expect(spec.startsWith("./") || spec.startsWith("../")).toBe(true);
      expect(forbidden.has(spec)).toBe(false);
    }
  });
});
