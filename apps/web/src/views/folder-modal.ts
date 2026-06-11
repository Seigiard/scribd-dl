import { atom } from "nanostores";
import { html, type Hole } from "uhtml";
import { saveFolder } from "@/engineClient";
import { $modal, type ModalMode } from "@/store";

const EMPTY_ERROR = "Path cannot be empty";
const SAVE_ERROR = "Failed to save";

export const $modalError = atom<string | null>(null);

export type FolderModalProps = {
  mode: ModalMode;
  folder: string | null;
  error: string | null;
};

const close = (): void => {
  $modal.set("none");
};

const findInput = (target: EventTarget | null): HTMLInputElement | null => {
  if (!(target instanceof HTMLElement)) return null;
  const root = target.closest(".folder-modal");
  return root?.querySelector<HTMLInputElement>(".folder-modal-input") ?? null;
};

const trySave = async (input: HTMLInputElement): Promise<void> => {
  const val = input.value.trim();
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

const onSaveClick = (e: MouseEvent): void => {
  const input = findInput(e.currentTarget);
  if (input) void trySave(input);
};

const onInputKeydown = (e: KeyboardEvent): void => {
  if (e.key === "Enter") {
    e.preventDefault();
    void trySave(e.currentTarget as HTMLInputElement);
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
    attachEscape();
  } else {
    detachEscape();
  }
});

export const folderModal = ({ mode, folder, error }: FolderModalProps): Hole => {
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
            .value=${folder ?? ""}
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
