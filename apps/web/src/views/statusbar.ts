import { html, type Hole } from "uhtml";

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

export type StatusbarProps = {
  transient: string | null;
};

export const statusbar = ({ transient }: StatusbarProps): Hole => {
  const text = transient ?? DEFAULT_HINT;
  return html`<div class="statusbar">${text}</div>`;
};
