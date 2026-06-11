import { html, type Hole } from "uhtml";
import type { Job } from "@scribd-dl/shared";
import { removeJobById, retryJobById } from "@/engineClient";
import { STATUS_ICON, icon } from "./icons";

const EMPTY_TITLE = "—";

type Action = { kind: "retry" | "remove"; href: string; label: string };

const pickAction = (job: Job): Action | null => {
  if (job.status === "Failed" && job.failure?.retryable) {
    return { kind: "retry", href: "#icon-retry", label: "Retry" };
  }
  if (job.status === "Queued" || job.status === "Failed") {
    return { kind: "remove", href: "#icon-delete", label: "Remove" };
  }
  return null;
};

const actionButton = (job: Job): Hole | null => {
  const action = pickAction(job);
  if (!action) return null;
  const onClick = (): void => {
    if (action.kind === "retry") void retryJobById(job.id);
    else void removeJobById(job.id);
  };
  return html`<button
    type="button"
    class="item-action"
    data-action=${action.kind}
    aria-label=${action.label}
    @click=${onClick}
  >
    ${icon(action.href)}
  </button>`;
};

const progressLine = (job: Job): Hole | null => {
  if (job.status !== "Downloading" || !job.progress) return null;
  const { done, total, stage } = job.progress;
  return html`<div class="item-progress">${done} / ${total} (${stage})</div>`;
};

const reasonLine = (job: Job): Hole | null => {
  if (job.status !== "Failed" || !job.failure) return null;
  return html`<div class="item-reason">Reason: ${job.failure.reason}</div>`;
};

export const queueItem = (job: Job): Hole => {
  return html`<div class="queue-item" data-status=${job.status}>
    <div class="item-head">
      ${icon(STATUS_ICON[job.status], "item-icon-status")}
      <span class="item-title">${job.displayTitle || EMPTY_TITLE}</span>
      ${actionButton(job)}
    </div>
    <div class="item-url">${job.url}</div>
    ${progressLine(job)} ${reasonLine(job)}
  </div>`;
};
