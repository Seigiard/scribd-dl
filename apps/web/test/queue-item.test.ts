import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobId, JobStatus } from "@scribd-dl/shared";

const removeJobByIdMock = vi.fn(async () => {});
const retryJobByIdMock = vi.fn(async () => {});
vi.mock("@/engineClient", () => ({
  removeJobById: removeJobByIdMock,
  retryJobById: retryJobByIdMock,
}));

await import("@/components/sd-queue-item");
const { $jobs, resetStores } = await import("@/store");

const ID = "j1" as JobId;

const mountWithJob = (status: JobStatus, overrides: Partial<Job> = {}): HTMLElement => {
  const job: Job = {
    id: ID,
    url: "https://scribd.com/doc/abc",
    domain: "scribd",
    displayTitle: "Doc abc",
    status,
    ...overrides,
  };
  $jobs.setKey(ID, job);
  document.body.innerHTML = `<sd-queue-item job-id="${ID}"></sd-queue-item>`;
  return document.querySelector("sd-queue-item") as HTMLElement;
};

describe("<sd-queue-item>", () => {
  beforeEach(() => {
    resetStores();
    removeJobByIdMock.mockReset();
    retryJobByIdMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders title, url, status and Remove button when Queued", () => {
    const el = mountWithJob("Queued");
    expect(el.querySelector('[data-ref="title"]')!.textContent).toBe("Doc abc");
    expect(el.querySelector('[data-ref="url"]')!.textContent).toBe("https://scribd.com/doc/abc");
    expect(el.querySelector('[data-ref="status"]')!.textContent).toBe("Queued");
    expect(el.querySelector('[data-ref="progress"]')!.hasAttribute("hidden")).toBe(true);
    expect(el.querySelector('[data-ref="reason"]')!.hasAttribute("hidden")).toBe(true);
    expect(el.querySelector('button[data-action="remove"]')).not.toBeNull();
    expect(el.querySelector('button[data-action="retry"]')).toBeNull();
  });

  it("shows progress text when Downloading with progress", () => {
    const el = mountWithJob("Downloading", { progress: { done: 5, total: 10, stage: "render" } });
    expect(el.querySelector('[data-ref="progress"]')!.textContent).toBe("5 / 10 (render)");
    expect(el.querySelector('[data-ref="progress"]')!.hasAttribute("hidden")).toBe(false);
    expect(el.querySelector('[data-ref="status"]')!.textContent).toBe("Downloading...");
  });

  it("Downloaded shows no action buttons", () => {
    const el = mountWithJob("Downloaded");
    expect(el.querySelector("button")).toBeNull();
    expect(el.querySelector('[data-ref="status"]')!.textContent).toBe("Downloaded");
  });

  it("Failed + retryable renders Reason and Retry", () => {
    const el = mountWithJob("Failed", {
      failure: { reason: "Timed out", retryable: true },
    });
    expect(el.querySelector('[data-ref="reason"]')!.textContent).toBe("Reason: Timed out");
    expect(el.querySelector('[data-ref="reason"]')!.hasAttribute("hidden")).toBe(false);
    expect(el.querySelector('button[data-action="retry"]')).not.toBeNull();
  });

  it("Failed + non-retryable renders Reason but no Retry", () => {
    const el = mountWithJob("Failed", {
      failure: { reason: "Unsupported domain", retryable: false },
    });
    expect(el.querySelector('[data-ref="reason"]')!.textContent).toBe("Reason: Unsupported domain");
    expect(el.querySelector('button[data-action="retry"]')).toBeNull();
  });

  it("clicking Remove calls removeJobById with the job id", () => {
    const el = mountWithJob("Queued");
    const btn = el.querySelector('button[data-action="remove"]') as HTMLButtonElement;
    btn.click();
    expect(removeJobByIdMock).toHaveBeenCalledWith(ID);
  });

  it("clicking Retry calls retryJobById with the job id", () => {
    const el = mountWithJob("Failed", { failure: { reason: "x", retryable: true } });
    const btn = el.querySelector('button[data-action="retry"]') as HTMLButtonElement;
    btn.click();
    expect(retryJobByIdMock).toHaveBeenCalledWith(ID);
  });

  it("status change to Downloading updates the same DOM element without remount", () => {
    const el = mountWithJob("Queued");
    const titleNode = el.querySelector('[data-ref="title"]');
    $jobs.setKey(ID, {
      id: ID,
      url: "https://scribd.com/doc/abc",
      domain: "scribd",
      displayTitle: "Doc abc",
      status: "Downloading",
      progress: { done: 1, total: 4, stage: "scrape" },
    });
    expect(el.querySelector('[data-ref="title"]')).toBe(titleNode);
    expect(el.querySelector('[data-ref="status"]')!.textContent).toBe("Downloading...");
    expect(el.dataset.status).toBe("Downloading");
  });
});
