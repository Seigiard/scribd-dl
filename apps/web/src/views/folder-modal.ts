import { atom } from "nanostores";
import { html, type Hole } from "uhtml";
import { saveFolder } from "@/engineClient";
import { $folder, $modal, type ModalMode } from "@/store";

const EMPTY_ERROR = "Path cannot be empty";
const SAVE_ERROR = "Failed to save";

export const $modalError = atom<string | null>(null);
export const $draftFolder = atom<string>("");

export type FolderModalProps = {
  mode: ModalMode;
  folder: string | null;
  error: string | null;
  draft: string;
};

const close = (): void => {
  $modal.set("none");
};

const trySave = async (): Promise<void> => {
  const val = $draftFolder.get().trim();
  if (!val) {
    $modalError.set(EMPTY_ERROR);
    return;
  }
  try {
    await saveFolder(val);
    $modalError.set(null);
    close();
  } catch {
    $modalError.set(SAVE_ERROR);
  }
};

const onInput = (e: Event): void => {
  $draftFolder.set((e.target as HTMLInputElement).value);
};

const onSaveClick = (): void => {
  void trySave();
};

const onInputKeydown = (e: KeyboardEvent): void => {
  if (e.key === "Enter") {
    e.preventDefault();
    void trySave();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
};

const onBackdropClick = (e: MouseEvent): void => {
  if (e.target === e.currentTarget) close();
};

let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

const attachEscape = (): void => {
  if (escapeHandler) return;
  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  window.addEventListener("keydown", escapeHandler, { capture: true });
};

const detachEscape = (): void => {
  if (!escapeHandler) return;
  window.removeEventListener("keydown", escapeHandler, { capture: true });
  escapeHandler = null;
};

$modal.listen((mode) => {
  if (mode === "folder") {
    $modalError.set(null);
    $draftFolder.set($folder.get() ?? "");
    attachEscape();
  } else {
    $modalError.set(null);
    $draftFolder.set("");
    detachEscape();
  }
});

export const folderModal = ({ mode, error, draft }: FolderModalProps): Hole => {
  if (mode !== "folder") return html``;
  return html`<div class="folder-modal" @click=${onBackdropClick}>
    <article class="terminal-card">
      <header>Change download folder</header>
      <div class="p-1">
        <div class="form-group">
          <input
            class="folder-modal-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            .value=${draft}
            @input=${onInput}
            @keydown=${onInputKeydown}
          />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-default" @click=${close}>Cancel</button>
          <button type="button" class="btn btn-primary" @click=${onSaveClick}>Save</button>
        </div>
        ${error ? html`<div class="terminal-alert terminal-alert-error">${error}</div>` : null}
      </div>
    </article>
  </div>`;
};
