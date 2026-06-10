import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { QueueItem } from "../src/components/QueueItem";
import type { Job } from "@scribd-dl/shared";

const baseJob: Job = {
  id: "j1",
  url: "https://www.scribd.com/document/1/example",
  domain: "scribd",
  displayTitle: "Example document",
  status: "Queued",
};

describe("QueueItem", () => {
  test("Queued job shows title, url, and Queued badge — no progress, no reason", () => {
    // #when
    render(<QueueItem job={baseJob} />);

    // #then
    expect(screen.getByTestId("job-title")).toHaveTextContent("Example document");
    expect(screen.getByTestId("job-url")).toHaveTextContent("https://www.scribd.com/document/1/example");
    expect(screen.getByTestId("job-status")).toHaveTextContent("Queued");
    expect(screen.queryByTestId("job-progress-text")).not.toBeInTheDocument();
    expect(screen.queryByTestId("job-reason")).not.toBeInTheDocument();
  });

  test("Downloading job with progress shows page counter and progress bar", () => {
    // #given
    const job: Job = { ...baseJob, status: "Downloading", progress: { done: 12, total: 87, stage: "scrape" } };

    // #when
    render(<QueueItem job={job} />);

    // #then
    expect(screen.getByTestId("job-status")).toHaveTextContent("Downloading");
    expect(screen.getByTestId("job-progress-text")).toHaveTextContent("12 / 87 (scrape)");
  });

  test("Downloading job without progress yet does not render the progress row", () => {
    // #given
    const job: Job = { ...baseJob, status: "Downloading" };

    // #when
    render(<QueueItem job={job} />);

    // #then
    expect(screen.getByTestId("job-status")).toHaveTextContent("Downloading");
    expect(screen.queryByTestId("job-progress-text")).not.toBeInTheDocument();
  });

  test("Downloaded job shows green-ish Downloaded badge", () => {
    // #given
    const job: Job = { ...baseJob, status: "Downloaded" };

    // #when
    render(<QueueItem job={job} />);

    // #then
    const badge = screen.getByTestId("job-status");
    expect(badge).toHaveTextContent("Downloaded");
    expect(badge.className).toMatch(/status-downloaded/);
  });

  test("Failed retryable job shows red Failed badge and reason", () => {
    // #given
    const job: Job = { ...baseJob, status: "Failed", failure: { reason: "PageLoadFailed: timeout", retryable: true } };

    // #when
    render(<QueueItem job={job} />);

    // #then
    expect(screen.getByTestId("job-status")).toHaveTextContent("Failed");
    expect(screen.getByTestId("job-reason")).toHaveTextContent("Reason: PageLoadFailed: timeout");
  });

  test("Failed unsupported job shows 'Unsupported domain' reason", () => {
    // #given
    const job: Job = { ...baseJob, domain: "unsupported", status: "Failed", failure: { reason: "Unsupported domain", retryable: false } };

    // #when
    render(<QueueItem job={job} />);

    // #then
    expect(screen.getByTestId("job-reason")).toHaveTextContent("Reason: Unsupported domain");
  });

  test("Queued job with onRemove renders × button; click invokes onRemove(job.id)", () => {
    // #given
    const onRemove = vi.fn();

    // #when
    render(<QueueItem job={baseJob} onRemove={onRemove} />);
    fireEvent.click(screen.getByTestId("remove-button"));

    // #then
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("j1");
  });

  test("Failed retryable job with onRetry renders Retry button; click invokes onRetry(job.id)", () => {
    // #given
    const job: Job = { ...baseJob, status: "Failed", failure: { reason: "x", retryable: true } };
    const onRetry = vi.fn();

    // #when
    render(<QueueItem job={job} onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId("retry-button"));

    // #then
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("j1");
  });

  test("Failed unsupported (retryable=false) does not render Retry button even when onRetry is passed", () => {
    // #given
    const job: Job = { ...baseJob, domain: "unsupported", status: "Failed", failure: { reason: "Unsupported domain", retryable: false } };
    const onRetry = vi.fn();

    // #when
    render(<QueueItem job={job} onRetry={onRetry} />);

    // #then
    expect(screen.queryByTestId("retry-button")).not.toBeInTheDocument();
  });

  test("Downloading and Downloaded jobs render no action buttons", () => {
    // #given
    const onRemove = vi.fn();
    const onRetry = vi.fn();

    // #when
    const { rerender } = render(<QueueItem job={{ ...baseJob, status: "Downloading" }} onRemove={onRemove} onRetry={onRetry} />);
    // #then
    expect(screen.queryByTestId("remove-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("retry-button")).not.toBeInTheDocument();

    // #when
    rerender(<QueueItem job={{ ...baseJob, status: "Downloaded" }} onRemove={onRemove} onRetry={onRetry} />);
    // #then
    expect(screen.queryByTestId("remove-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("retry-button")).not.toBeInTheDocument();
  });
});
