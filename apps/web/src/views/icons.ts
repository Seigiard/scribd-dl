import { html, type Hole } from "uhtml";
import type { JobStatus } from "@scribd-dl/shared";

export const STATUS_ICON: Record<JobStatus, string> = {
  Queued: "#icon-queued",
  Downloading: "#icon-downloading",
  Downloaded: "#icon-downloaded",
  Failed: "#icon-failed",
};

export const icon = (href: string, extraClass = ""): Hole => {
  const cls = extraClass ? `item-icon ${extraClass}` : "item-icon";
  return html`<svg class=${cls} aria-hidden="true"><use href=${href} /></svg>`;
};
