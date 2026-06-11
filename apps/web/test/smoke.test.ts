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
await import("@/components/sd-folder-modal");
const { resetStores } = await import("@/store");

describe("SPA smoke", () => {
  beforeEach(() => {
    resetStores();
    document.body.innerHTML = `
      <div class="terminal-banner terminal-header">
        <strong>Scribd downloader</strong>
        <div class="mount-header"></div>
      </div>
      <div class="terminal-content">
        <div class="mount-banner"></div>
        <div class="mount-queue"></div>
      </div>
      <div class="terminal-footer">
        <div class="mount-statusbar"></div>
      </div>
      <div class="mount-modal"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("scaffold has all mount containers", () => {
    expect(document.querySelector(".mount-header")).not.toBeNull();
    expect(document.querySelector(".mount-banner")).not.toBeNull();
    expect(document.querySelector(".mount-queue")).not.toBeNull();
    expect(document.querySelector(".mount-statusbar")).not.toBeNull();
    expect(document.querySelector(".mount-modal")).not.toBeNull();
  });
});
