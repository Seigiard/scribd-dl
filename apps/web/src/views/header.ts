import { html, type Hole } from "uhtml";
import { $modal } from "@/store";

export type HeaderProps = {
  folder: string | null;
};

const openModal = (): void => {
  $modal.set("folder");
};

const openSettings = (): void => {
  $modal.set("settings");
};

export const header = ({ folder }: HeaderProps): Hole => {
  return html`<div class="folder-row">
    <span>Download folder: <span>${folder ?? "—"}</span></span>
    <button type="button" class="btn btn-default btn-ghost" @click=${openModal}>Change</button>
    <button type="button" class="btn btn-default btn-ghost" data-action="settings" @click=${openSettings}>Settings</button>
  </div>`;
};
