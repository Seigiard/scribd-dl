import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveFolderMock = vi.fn(async (_path: string) => {});
vi.mock("@/engineClient", () => ({
  saveFolder: saveFolderMock,
}));

await import("@/components/sd-folder-modal");
const { $folder, $modal, resetStores } = await import("@/store");

type Refs = {
  modal: HTMLElement;
  input: HTMLInputElement;
  error: HTMLElement;
  save: HTMLButtonElement;
  cancel: HTMLButtonElement;
};

const mount = (): Refs => {
  document.body.innerHTML = "<sd-folder-modal hidden></sd-folder-modal>";
  const modal = document.querySelector("sd-folder-modal") as HTMLElement;
  return {
    modal,
    input: modal.querySelector('[data-ref="input"]') as HTMLInputElement,
    error: modal.querySelector('[data-ref="error"]') as HTMLElement,
    save: modal.querySelector('[data-ref="save"]') as HTMLButtonElement,
    cancel: modal.querySelector('[data-ref="cancel"]') as HTMLButtonElement,
  };
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("<sd-folder-modal>", () => {
  beforeEach(() => {
    resetStores();
    saveFolderMock.mockReset();
    saveFolderMock.mockResolvedValue();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens with the input prefilled by the current $folder", () => {
    $folder.set("/home/me/Downloads");
    const r = mount();
    expect(r.modal.hidden).toBe(true);
    $modal.set("folder");
    expect(r.modal.hidden).toBe(false);
    expect(r.input.value).toBe("/home/me/Downloads");
    expect(r.error.hidden).toBe(true);
  });

  it("empty path on Save shows an inline error and does not call saveFolder", () => {
    const r = mount();
    $modal.set("folder");
    r.input.value = "   ";
    r.save.click();
    expect(r.error.hidden).toBe(false);
    expect(r.error.textContent).toBe("Path cannot be empty");
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modal.get()).toBe("folder");
  });

  it("valid path on Save trims, calls saveFolder, and closes the modal", async () => {
    const r = mount();
    $modal.set("folder");
    r.input.value = "  /opt/dl  ";
    r.save.click();
    await flush();
    expect(saveFolderMock).toHaveBeenCalledWith("/opt/dl");
    expect($modal.get()).toBe("none");
    expect(r.modal.hidden).toBe(true);
  });

  it("Enter inside the input saves", async () => {
    const r = mount();
    $modal.set("folder");
    r.input.value = "/new";
    r.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(saveFolderMock).toHaveBeenCalledWith("/new");
    expect($modal.get()).toBe("none");
  });

  it("Escape inside the input closes without saving", () => {
    const r = mount();
    $modal.set("folder");
    r.input.value = "/new";
    r.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modal.get()).toBe("none");
  });

  it("Cancel click closes without saving", () => {
    const r = mount();
    $modal.set("folder");
    r.cancel.click();
    expect(saveFolderMock).not.toHaveBeenCalled();
    expect($modal.get()).toBe("none");
  });

  it("saveFolder rejection keeps the modal open with an error", async () => {
    saveFolderMock.mockRejectedValueOnce(new Error("boom"));
    const r = mount();
    $modal.set("folder");
    r.input.value = "/new";
    r.save.click();
    await flush();
    expect($modal.get()).toBe("folder");
    expect(r.error.hidden).toBe(false);
    expect(r.error.textContent).toBe("Failed to save");
  });
});
