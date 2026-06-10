import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineSnapshot, Job, JobId } from "@scribd-dl/shared";

vi.mock("@/engineClient", () => ({
  removeJobById: vi.fn(),
  retryJobById: vi.fn(),
}));

await import("@/components/sd-queue");
await import("@/components/sd-queue-item");
const { applySnapshot, resetStores } = await import("@/store");

const job = (id: string, overrides: Partial<Job> = {}): Job => ({
  id: id as JobId,
  url: `https://scribd.com/doc/${id}`,
  domain: "scribd",
  displayTitle: `Doc ${id}`,
  status: "Queued",
  ...overrides,
});

const snap = (jobs: Job[]): EngineSnapshot => ({ jobs });

const mount = (): HTMLElement => {
  document.body.innerHTML = "<sd-queue></sd-queue>";
  return document.querySelector("sd-queue") as HTMLElement;
};

const items = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll("sd-queue-item"));

describe("<sd-queue>", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts empty when $jobs is empty", () => {
    const root = mount();
    expect(items(root)).toHaveLength(0);
  });

  it("appends a new <sd-queue-item> when a job is added", () => {
    const root = mount();
    applySnapshot(snap([job("a")]));
    const children = items(root);
    expect(children).toHaveLength(1);
    expect(children[0].getAttribute("job-id")).toBe("a");
  });

  it("removes the matching item when a job disappears", () => {
    const root = mount();
    applySnapshot(snap([job("a"), job("b")]));
    applySnapshot(snap([job("a")]));
    const children = items(root);
    expect(children).toHaveLength(1);
    expect(children[0].getAttribute("job-id")).toBe("a");
  });

  it("preserves the same DOM node when a job is updated in place", () => {
    const root = mount();
    applySnapshot(snap([job("a")]));
    const first = items(root)[0];
    applySnapshot(snap([job("a", { status: "Downloading" })]));
    expect(items(root)[0]).toBe(first);
    expect(first.dataset.status).toBe("Downloading");
  });
});
