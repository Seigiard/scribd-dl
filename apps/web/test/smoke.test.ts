import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/engineClient", () => ({
  startEngineClient: vi.fn(async () => {}),
  attachPasteHandler: vi.fn(),
  reconnect: vi.fn(),
  saveFolder: vi.fn(),
  removeJobById: vi.fn(),
  retryJobById: vi.fn(),
}));

await import("@/components/sd-app");
await import("@/components/sd-header");
await import("@/components/sd-disconnect-banner");
await import("@/components/sd-queue");
await import("@/components/sd-queue-item");
await import("@/components/sd-statusbar");
await import("@/components/sd-folder-modal");
const { resetStores } = await import("@/store");

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

describe("SPA smoke", () => {
  beforeEach(() => {
    resetStores();
    document.body.innerHTML = `
      <sd-app>
        <article class="terminal-card">
          <header>Scribd downloader</header>
          <sd-header></sd-header>
          <sd-disconnect-banner hidden></sd-disconnect-banner>
          <sd-queue></sd-queue>
          <sd-statusbar></sd-statusbar>
        </article>
        <sd-folder-modal hidden></sd-folder-modal>
      </sd-app>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts the full scaffold without throwing", () => {
    expect(document.querySelector("sd-app")).not.toBeNull();
    expect(document.querySelector("sd-header")).not.toBeNull();
    expect(document.querySelector("sd-queue")).not.toBeNull();
    expect(document.querySelector("sd-statusbar")).not.toBeNull();
    expect(document.querySelector("sd-disconnect-banner")).not.toBeNull();
    expect(document.querySelector("sd-folder-modal")).not.toBeNull();
  });

  it("statusbar shows the default hint at startup", () => {
    const bar = document.querySelector("sd-statusbar")!;
    expect(bar.textContent).toBe(DEFAULT_HINT);
  });

  it("queue starts empty", () => {
    const queue = document.querySelector("sd-queue")!;
    expect(queue.querySelectorAll("sd-queue-item")).toHaveLength(0);
  });
});
