import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { Queue } from "../src/tui/Queue";
import { QueueItem } from "../src/tui/QueueItem";
import type { Job, JobId } from "@scribd-dl/shared";

const jobId = (s: string): JobId => s as JobId;

const queuedJob: Job = {
  id: jobId("a"),
  url: "https://www.scribd.com/document/1/foo",
  domain: "scribd",
  displayTitle: "Scribd document 1",
  status: "Queued",
};

const downloadingJob: Job = { ...queuedJob, id: jobId("b"), status: "Downloading" };
const downloadedJob: Job = { ...queuedJob, id: jobId("c"), status: "Downloaded" };
const failedRetryable: Job = {
  ...queuedJob,
  id: jobId("d"),
  status: "Failed",
  failure: { reason: "PageLoadFailed: timeout", retryable: true },
};
const failedUnsupported: Job = {
  id: jobId("e"),
  url: "https://example.com/doc",
  domain: "unsupported",
  displayTitle: "Unsupported link",
  status: "Failed",
  failure: { reason: "Unsupported domain", retryable: false },
};

describe("QueueItem", () => {
  test("Queued: shows title, status, url", () => {
    const ui = render(<QueueItem job={queuedJob} />);
    const frame = ui.lastFrame() ?? "";
    expect(frame).toContain("Scribd document 1");
    expect(frame).toContain("Queued");
    expect(frame).toContain("https://www.scribd.com/document/1/foo");
    ui.unmount();
  });

  test("Downloading: shows status text", () => {
    const ui = render(<QueueItem job={downloadingJob} />);
    expect(ui.lastFrame() ?? "").toContain("Downloading");
    ui.unmount();
  });

  test("Downloading with progress: renders bar and ratio", () => {
    const job: Job = { ...downloadingJob, progress: { done: 4, total: 10, stage: "render" } };
    const ui = render(<QueueItem job={job} />);
    const frame = ui.lastFrame() ?? "";
    expect(frame).toContain("4/10");
    expect(frame).toMatch(/█+░+/);
    ui.unmount();
  });

  test("Downloading without progress: no bar rendered", () => {
    const ui = render(<QueueItem job={downloadingJob} />);
    const frame = ui.lastFrame() ?? "";
    expect(frame).not.toMatch(/\d+\/\d+/);
    ui.unmount();
  });

  test("Downloaded: shows status text", () => {
    const ui = render(<QueueItem job={downloadedJob} />);
    expect(ui.lastFrame() ?? "").toContain("Downloaded");
    ui.unmount();
  });

  test("Failed retryable: status text + reason line shown", () => {
    const ui = render(<QueueItem job={failedRetryable} />);
    const frame = ui.lastFrame() ?? "";
    expect(frame).toContain("Failed");
    expect(frame).toContain("Reason: PageLoadFailed: timeout");
    ui.unmount();
  });

  test("Failed unsupported: shows Unsupported domain reason", () => {
    const ui = render(<QueueItem job={failedUnsupported} />);
    expect(ui.lastFrame() ?? "").toContain("Reason: Unsupported domain");
    ui.unmount();
  });
});

describe("Queue", () => {
  test("empty snapshot renders nothing", () => {
    const ui = render(<Queue snapshot={{ jobs: [] }} />);
    expect((ui.lastFrame() ?? "").trim()).toBe("");
    ui.unmount();
  });

  test("renders one block per job in order", () => {
    const ui = render(<Queue snapshot={{ jobs: [queuedJob, downloadingJob, failedRetryable] }} />);
    const frame = ui.lastFrame() ?? "";
    const idxQueued = frame.indexOf("Queued");
    const idxDownloading = frame.indexOf("Downloading");
    const idxFailed = frame.indexOf("Failed");
    expect(idxQueued).toBeGreaterThanOrEqual(0);
    expect(idxDownloading).toBeGreaterThan(idxQueued);
    expect(idxFailed).toBeGreaterThan(idxDownloading);
    ui.unmount();
  });
});
