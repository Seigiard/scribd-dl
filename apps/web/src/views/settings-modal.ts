import { atom } from "nanostores";
import { html, type Hole } from "uhtml";
import { saveSettingsCommand } from "@/engineClient";
import { $modal, $settings, type ModalMode } from "@/store";

const SAVE_ERROR = "Failed to save";
const INCOMPLETE_ERROR = "Enter both keys, or clear both";

export type SettingsValidity = "unverified" | "validating" | "valid" | "invalid";

export const $settingsError = atom<string | null>(null);
export const $draftPublicKey = atom<string>("");
export const $draftSecretKey = atom<string>("");
export const $settingsValidity = atom<SettingsValidity>("unverified");

export type SettingsModalProps = {
  mode: ModalMode;
  publicKey: string;
  secretKey: string;
  validity: SettingsValidity;
  error: string | null;
};

const validityFromFlag = (valid: boolean | null): SettingsValidity => (valid === null ? "unverified" : valid ? "valid" : "invalid");

const oneFilled = (pub: string, sec: string): boolean => (pub.trim() === "") !== (sec.trim() === "");

const close = (): void => {
  $modal.set("none");
};

const trySave = async (): Promise<void> => {
  const pub = $draftPublicKey.get().trim();
  const sec = $draftSecretKey.get().trim();
  if (oneFilled(pub, sec)) {
    $settingsError.set(INCOMPLETE_ERROR);
    return;
  }
  $settingsError.set(null);
  $settingsValidity.set("validating");
  try {
    const valid = await saveSettingsCommand(pub, sec);
    const cleared = pub === "" && sec === "";
    $settingsValidity.set(cleared ? "unverified" : valid ? "valid" : "invalid");
  } catch {
    $settingsError.set(SAVE_ERROR);
    $settingsValidity.set("unverified");
  }
};

const onPublicInput = (e: Event): void => {
  $draftPublicKey.set((e.target as HTMLInputElement).value);
};

const onSecretInput = (e: Event): void => {
  $draftSecretKey.set((e.target as HTMLInputElement).value);
};

const onSaveClick = (): void => {
  void trySave();
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

let needsFocus = false;

const onInputRef = (el: HTMLInputElement | null): void => {
  if (!el || !needsFocus) return;
  needsFocus = false;
  queueMicrotask(() => {
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  });
};

$modal.listen((mode) => {
  if (mode === "settings") {
    const current = $settings.get();
    $draftPublicKey.set(current?.publicKey ?? "");
    $draftSecretKey.set(current?.secretKey ?? "");
    $settingsValidity.set(validityFromFlag(current?.valid ?? null));
    $settingsError.set(null);
    needsFocus = true;
    attachEscape();
  } else {
    $settingsError.set(null);
    detachEscape();
  }
});

const onBackdropClick = (e: MouseEvent): void => {
  if (e.target === e.currentTarget) close();
};

const VALIDITY_LABEL: Record<SettingsValidity, string> = {
  unverified: "Not verified yet",
  validating: "Validating…",
  valid: "Keys valid",
  invalid: "Keys invalid",
};

const validityLine = (validity: SettingsValidity): Hole =>
  html`<div class="settings-validity" data-validity=${validity}>${VALIDITY_LABEL[validity]}</div>`;

export const settingsModal = ({ mode, publicKey, secretKey, validity, error }: SettingsModalProps): Hole => {
  if (mode !== "settings") return html``;
  const saveDisabled = validity === "validating" || oneFilled(publicKey, secretKey);
  return html`<div class="settings-modal" @click=${onBackdropClick}>
    <article class="terminal-card">
      <header>iLovePDF compression keys</header>
      <div class="p-1">
        <p class="settings-note">Downloads are uploaded to iLovePDF for compression when both keys are valid.</p>
        <div class="form-group">
          <label>Public key</label>
          <input
            class="settings-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            .value=${publicKey}
            ref=${onInputRef}
            @input=${onPublicInput}
          />
        </div>
        <div class="form-group">
          <label>Secret key</label>
          <input class="settings-input" type="text" autocomplete="off" spellcheck="false" .value=${secretKey} @input=${onSecretInput} />
        </div>
        ${validityLine(validity)}
        <div class="modal-actions">
          <button type="button" class="btn btn-default" @click=${close}>Close</button>
          <button type="button" class="btn btn-primary" ?disabled=${saveDisabled} @click=${onSaveClick}>Save</button>
        </div>
        ${error ? html`<div class="terminal-alert terminal-alert-error">${error}</div>` : null}
      </div>
    </article>
  </div>`;
};
