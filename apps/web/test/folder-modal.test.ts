import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "uhtml";

const saveFolderMock = vi.fn(async (_path: string) => {});
vi.mock("@/engineClient", () => ({
  saveFolder: saveFolderMock,
}));

const { folderModal, $modalError } = await import("@/views/folder-modal");
const { $modal, resetStores } = await import("@/store");

const mountModal = (
  props: { mode: "none" | "folder"; folder: string | null; error: string | null },
): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(container, folderModal(props));
  return container;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("folderModal()", () => {
  beforeEach(() => {
    resetStores();
    $modalError.set(null);
    saveFolderMock.mockReset();
    saveFolderMock.mockResolvedValue();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing when mode is 'none'", () => {
    const root = mountModal({ mode: "none", folder: null, error: null });
    expect(root.querySelector(".folder-modal")).toBeNull();
  });

  it("renders modal with input prefilled by folder when open", () => {
    const root = mountModal({ mode: "folder", folder: "/home/me/Downloads", error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    expect(root.querySelector(".folder-modal")).not.toBeNull();
    expect(input.value).toBe("/home/me/Downloads");
    expect(root.querySelector(".terminal-alert")).toBeNull();
  });

  it("renders empty input value when folder is null", () => {
    const root = mountModal({ mode: "folder", folder: null, error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    expect(input.value).toBe("");
  });

  it("shows error block when error prop is set", () => {
    const root = mountModal({ mode: "folder", folder: "/x", error: "Path cannot be empty" });
    expect(root.querySelector(".terminal-alert")?.textContent).toContain("Path cannot be empty");
  });

  it("Save with empty path sets $modalError, does not call saveFolder", () => {
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: null, error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.value = "   ";
    const save = root.querySelector<HTMLButtonElement>("button.btn-primary")!;
    save.click();
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modalError.get()).toBe("Path cannot be empty");
    expect($modal.get()).toBe("folder");
  });

  it("Save with valid path trims, calls saveFolder, closes modal", async () => {
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: null, error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.value = "  /opt/dl  ";
    const save = root.querySelector<HTMLButtonElement>("button.btn-primary")!;
    save.click();
    await flush();
    expect(saveFolderMock).toHaveBeenCalledWith("/opt/dl");
    expect($modal.get()).toBe("none");
  });

  it("Enter in input triggers save flow", async () => {
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: null, error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.value = "/new";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(saveFolderMock).toHaveBeenCalledWith("/new");
    expect($modal.get()).toBe("none");
  });

  it("Escape in input closes without saving", () => {
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: "/x", error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modal.get()).toBe("none");
  });

  it("Cancel click closes without saving", () => {
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: "/x", error: null });
    const cancel = root.querySelector<HTMLButtonElement>("button.btn-default")!;
    cancel.click();
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modal.get()).toBe("none");
  });

  it("saveFolder rejection sets $modalError to SAVE_ERROR, keeps modal open", async () => {
    saveFolderMock.mockRejectedValueOnce(new Error("boom"));
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: null, error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.value = "/new";
    root.querySelector<HTMLButtonElement>("button.btn-primary")!.click();
    await flush();
    expect($modal.get()).toBe("folder");
    expect($modalError.get()).toBe("Failed to save");
  });
});
