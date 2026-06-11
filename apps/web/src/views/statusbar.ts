import { html, type Hole } from "uhtml";
import type { TransientState } from "@/store";

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

export type StatusbarProps = {
  transient: TransientState | null;
};

export const statusbar = ({ transient }: StatusbarProps): Hole => {
  if (transient === null) {
    return html`<div class="statusbar">${DEFAULT_HINT}</div>`;
  }
  const cls = `statusbar statusbar-${transient.severity}`;
  return html`<div class=${cls}>${transient.message}</div>`;
};
