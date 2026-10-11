import { afterEach, describe, expect, it } from "vitest";
import { render } from "uhtml";
import type { Job, JobId } from "@scribd-dl/shared";

const { queue } = await import("@/views/queue");

const makeJob = (id: string, overrides: Partial<Job> = {}): Job => ({
  id,
  url: `https://scribd.com/doc/${id}`,
  domain: "scribd",
  displayTitle: `Doc ${id}`,
  status: "Queued",
  ...overrides,
});

const mount = (jobs: Record<JobId, Job | undefined>): HTMLElement => {
  const container = document.createElement("div");
  render(container, () => queue({ jobs }));

  return container.querySelector<HTMLElement>(".queue")!;
};

const items = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll(".queue-item"));

describe("queue()", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("empty: renders empty .queue", () => {
    const root = mount({});
    expect(root).not.toBeNull();
    expect(items(root)).toHaveLength(0);
  });

  it("single: renders one queue-item", () => {
    const root = mount({ a: makeJob("a") });
    const children = items(root);
    expect(children).toHaveLength(1);
    expect(children[0].textContent).toContain("Doc a");
  });

  it("multiple: renders all jobs", () => {
    const jobs = {
      a: makeJob("a"),
      b: makeJob("b", { status: "Downloading", progress: { done: 1, total: 2, stage: "scrape" } }),
      c: makeJob("c", { status: "Downloaded" }),
    };

    const root = mount(jobs);
    expect(items(root)).toHaveLength(3);
  });

  it("filters undefined values", () => {
    const jobs = {
      a: makeJob("a"),
      b: undefined,
    };

    const root = mount(jobs);
    const children = items(root);
    expect(children).toHaveLength(1);
    expect(children[0].textContent).toContain("Doc a");
  });

  it("update in place preserves DOM node identity (auto-keyed by template)", () => {
    const container = document.createElement("div");
    render(container, () => queue({ jobs: { a: makeJob("a") } }));
    const firstItem = container.querySelector<HTMLElement>(".queue-item")!;

    render(container, () =>
      queue({
        jobs: {
          a: makeJob("a", {
            status: "Downloading",
            progress: { done: 1, total: 4, stage: "scrape" },
          }),
        },
      }),
    );
    const updated = container.querySelector<HTMLElement>(".queue-item")!;
    expect(updated).toBe(firstItem);
    expect(updated.dataset.status).toBe("Downloading");
  });

  it("prepends a pasted job to an already rendered saved queue", () => {
    // #given
    const container = document.createElement("div");
    const saved = makeJob("saved", { status: "Downloaded" });
    render(container, () => queue({ jobs: {} }));
    render(container, () => queue({ jobs: { saved } }));

    // #when
    render(container, () => queue({ jobs: { pasted: makeJob("pasted"), saved } }));

    // #then
    expect(Array.from(container.querySelectorAll(".item-url"), (node) => node.textContent)).toEqual([
      "https://scribd.com/doc/pasted",
      "https://scribd.com/doc/saved",
    ]);
  });
});
