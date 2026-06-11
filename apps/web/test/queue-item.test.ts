import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "uhtml";
import type { Job, JobId, JobStatus } from "@scribd-dl/shared";

const removeJobByIdMock = vi.fn(async () => {});
const retryJobByIdMock = vi.fn(async () => {});
vi.mock("@/engineClient", () => ({
  removeJobById: removeJobByIdMock,
  retryJobById: retryJobByIdMock,
}));

const { queueItem } = await import("@/views/queue-item");

const ID = "j1" as JobId;

const makeJob = (status: JobStatus, overrides: Partial<Job> = {}): Job => ({
  id: ID,
  url: "https://scribd.com/doc/abc",
  domain: "scribd",
  displayTitle: "Doc abc",
  status,
  ...overrides,
});

const mountJob = (job: Job): HTMLElement => {
  const container = document.createElement("div");
  render(container, queueItem(job));
  return container.querySelector(".queue-item") as HTMLElement;
};

describe("queueItem()", () => {
  beforeEach(() => {
    removeJobByIdMock.mockReset();
    retryJobByIdMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Queued: title, url, default icon, Remove action", () => {
    const el = mountJob(makeJob("Queued"));
    expect(el.dataset.status).toBe("Queued");
    expect(el.textContent).toContain("Doc abc");
    expect(el.textContent).toContain("https://scribd.com/doc/abc");
    expect(el.querySelector('button[data-action="remove"]')).not.toBeNull();
    expect(el.querySelector('button[data-action="retry"]')).toBeNull();
    expect(el.querySelector(".item-progress")).toBeNull();
    expect(el.querySelector(".item-reason")).toBeNull();
  });

  it("Downloading with progress: shows progress text, no action", () => {
    const el = mountJob(
      makeJob("Downloading", { progress: { done: 5, total: 10, stage: "render" } }),
    );
    expect(el.querySelector(".item-progress")?.textContent).toBe("5 / 10 (render)");
    expect(el.querySelector("button")).toBeNull();
  });

  it("Downloaded: no action, no progress, no reason", () => {
    const el = mountJob(makeJob("Downloaded"));
    expect(el.querySelector("button")).toBeNull();
    expect(el.querySelector(".item-progress")).toBeNull();
    expect(el.querySelector(".item-reason")).toBeNull();
  });

  it("Failed + retryable: shows reason and Retry action", () => {
    const el = mountJob(makeJob("Failed", { failure: { reason: "Timed out", retryable: true } }));
    expect(el.querySelector(".item-reason")?.textContent).toBe("Reason: Timed out");
    expect(el.querySelector('button[data-action="retry"]')).not.toBeNull();
    expect(el.querySelector('button[data-action="remove"]')).toBeNull();
  });

  it("Failed + non-retryable: shows reason and Remove action", () => {
    const el = mountJob(
      makeJob("Failed", { failure: { reason: "Unsupported domain", retryable: false } }),
    );
    expect(el.querySelector(".item-reason")?.textContent).toBe("Reason: Unsupported domain");
    expect(el.querySelector('button[data-action="remove"]')).not.toBeNull();
    expect(el.querySelector('button[data-action="retry"]')).toBeNull();
  });

  it("clicking Remove calls removeJobById with id", () => {
    const el = mountJob(makeJob("Queued"));
    const btn = el.querySelector('button[data-action="remove"]') as HTMLButtonElement;
    btn.click();
    expect(removeJobByIdMock).toHaveBeenCalledWith(ID);
  });

  it("clicking Retry calls retryJobById with id", () => {
    const el = mountJob(makeJob("Failed", { failure: { reason: "x", retryable: true } }));
    const btn = el.querySelector('button[data-action="retry"]') as HTMLButtonElement;
    btn.click();
    expect(retryJobByIdMock).toHaveBeenCalledWith(ID);
  });

  it("renders placeholder when displayTitle is empty", () => {
    const el = mountJob(makeJob("Queued", { displayTitle: "" }));
    expect(el.querySelector(".item-title")?.textContent).toBe("—");
  });
});
