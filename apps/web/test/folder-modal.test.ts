import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "uhtml";

const saveFolderMock = vi.fn(async (_path: string) => {});
vi.mock("@/engineClient", () => ({
  saveFolder: saveFolderMock,
}));

const { folderModal, $modalError, $draftFolder } = await import("@/views/folder-modal");
const { $folder, $modal, resetStores } = await import("@/store");

type ModalProps = {
  mode: "none" | "folder";
  folder: string | null;
  error: string | null;
  draft?: string;
};

const mountModal = (props: ModalProps): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(container, folderModal({ draft: "", ...props }));
  return container;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("folderModal()", () => {
  beforeEach(() => {
    resetStores();
    $modalError.set(null);
    $draftFolder.set("");
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

  it("renders modal with input value from draft when open", () => {
    const root = mountModal({ mode: "folder", folder: null, error: null, draft: "/home/me/Downloads" });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    expect(root.querySelector(".folder-modal")).not.toBeNull();
    expect(input.value).toBe("/home/me/Downloads");
    expect(root.querySelector(".terminal-alert")).toBeNull();
  });

  it("renders empty input value when draft is empty", () => {
    const root = mountModal({ mode: "folder", folder: null, error: null });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    expect(input.value).toBe("");
  });

  it("shows error block when error prop is set", () => {
    const root = mountModal({ mode: "folder", folder: null, error: "Path cannot be empty" });
    expect(root.querySelector(".terminal-alert")?.textContent).toContain("Path cannot be empty");
  });

  it("opening modal seeds $draftFolder from $folder", () => {
    $folder.set("/home/me/Downloads");
    $modal.set("folder");
    expect($draftFolder.get()).toBe("/home/me/Downloads");
  });

  it("opening modal with null $folder seeds empty draft", () => {
    $folder.set(null);
    $modal.set("folder");
    expect($draftFolder.get()).toBe("");
  });

  it("closing modal resets $draftFolder to empty", () => {
    $folder.set("/x");
    $modal.set("folder");
    $draftFolder.set("/typed");
    $modal.set("none");
    expect($draftFolder.get()).toBe("");
  });

  it("@input updates $draftFolder", () => {
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: null, error: null, draft: "" });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.value = "/typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect($draftFolder.get()).toBe("/typed");
  });

  it("Save with empty draft sets $modalError, does not call saveFolder", () => {
    $modal.set("folder");
    $draftFolder.set("   ");
    const root = mountModal({ mode: "folder", folder: null, error: null, draft: "   " });
    const save = root.querySelector<HTMLButtonElement>("button.btn-primary")!;
    save.click();
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modalError.get()).toBe("Path cannot be empty");
    expect($modal.get()).toBe("folder");
  });

  it("Save with valid draft trims, calls saveFolder, closes modal", async () => {
    $modal.set("folder");
    $draftFolder.set("  /opt/dl  ");
    const root = mountModal({ mode: "folder", folder: null, error: null, draft: "  /opt/dl  " });
    const save = root.querySelector<HTMLButtonElement>("button.btn-primary")!;
    save.click();
    await flush();
    expect(saveFolderMock).toHaveBeenCalledWith("/opt/dl");
    expect($modal.get()).toBe("none");
  });

  it("Enter in input triggers save flow", async () => {
    $modal.set("folder");
    $draftFolder.set("/new");
    const root = mountModal({ mode: "folder", folder: null, error: null, draft: "/new" });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(saveFolderMock).toHaveBeenCalledWith("/new");
    expect($modal.get()).toBe("none");
  });

  it("Escape in input closes without saving", () => {
    $modal.set("folder");
    $draftFolder.set("/typed");
    const root = mountModal({ mode: "folder", folder: null, error: null, draft: "/typed" });
    const input = root.querySelector<HTMLInputElement>(".folder-modal-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modal.get()).toBe("none");
  });

  it("global Escape (focus outside input) closes the modal", () => {
    $modal.set("folder");
    mountModal({ mode: "folder", folder: null, error: null });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect($modal.get()).toBe("none");
  });

  it("global Escape is detached when modal closes", () => {
    $modal.set("folder");
    mountModal({ mode: "folder", folder: null, error: null });
    $modal.set("none");
    saveFolderMock.mockClear();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect($modal.get()).toBe("none");
    expect(saveFolderMock).not.toHaveBeenCalled();
  });

  it("Cancel click closes without saving", () => {
    $modal.set("folder");
    const root = mountModal({ mode: "folder", folder: null, error: null });
    const cancel = root.querySelector<HTMLButtonElement>("button.btn-default")!;
    cancel.click();
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modal.get()).toBe("none");
  });

  it("saveFolder rejection sets $modalError to SAVE_ERROR, keeps modal open", async () => {
    saveFolderMock.mockRejectedValueOnce(new Error("boom"));
    $modal.set("folder");
    $draftFolder.set("/new");
    const root = mountModal({ mode: "folder", folder: null, error: null, draft: "/new" });
    root.querySelector<HTMLButtonElement>("button.btn-primary")!.click();
    await flush();
    expect($modal.get()).toBe("folder");
    expect($modalError.get()).toBe("Failed to save");
  });

  it("external $folder change during typing does not overwrite draft", () => {
    // #given — user opened modal and typed "/my-draft"
    $folder.set("/old");
    $modal.set("folder");
    $draftFolder.set("/my-draft");
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(container, folderModal({ mode: "folder", folder: "/old", error: null, draft: $draftFolder.get() }));
    const input = container.querySelector<HTMLInputElement>(".folder-modal-input")!;
    expect(input.value).toBe("/my-draft");

    // #when — external source updates $folder (e.g. push event, second tab)
    $folder.set("/external");

    // #then — draft survives the external change; next render keeps user input
    render(container, folderModal({ mode: "folder", folder: "/external", error: null, draft: $draftFolder.get() }));
    expect(input.value).toBe("/my-draft");
    expect($draftFolder.get()).toBe("/my-draft");
  });
});
