import { define } from "nanotags";
import { listenKeys } from "nanostores";
import { removeJobById, retryJobById } from "@/engineClient";
import { $jobs } from "@/store";
import type { Job, JobId } from "@scribd-dl/shared";

const EMPTY_TITLE = "—";

define("sd-queue-item").setup((ctx) => {
  const id = (ctx.host.getAttribute("job-id") ?? "") as JobId;

  ctx.host.innerHTML = `
    <div class="item-head">
      <svg class="item-icon item-icon-status" aria-hidden="true"><use data-ref="status-use" href="#icon-queued"/></svg>
      <span class="item-title" data-ref="title"></span>
      <button type="button" class="item-action" data-ref="action" hidden>
        <svg class="item-icon" aria-hidden="true"><use data-ref="action-use" href=""/></svg>
      </button>
    </div>
    <div class="item-url" data-ref="url"></div>
    <div class="item-progress" data-ref="progress" hidden></div>
    <div class="item-reason" data-ref="reason" hidden></div>
  `;

  const title = ctx.getElement<HTMLSpanElement>('[data-ref="title"]');
  const url = ctx.getElement<HTMLDivElement>('[data-ref="url"]');
  const action = ctx.getElement<HTMLButtonElement>('[data-ref="action"]');
  const progress = ctx.getElement<HTMLDivElement>('[data-ref="progress"]');
  const reason = ctx.getElement<HTMLDivElement>('[data-ref="reason"]');
  const statusUse = ctx.host.querySelector('[data-ref="status-use"]') as SVGUseElement;
  const actionUse = ctx.host.querySelector('[data-ref="action-use"]') as SVGUseElement;

  const STATUS_ICON: Record<Job["status"], string> = {
    Queued: "#icon-queued",
    Downloading: "#icon-downloading",
    Downloaded: "#icon-downloaded",
    Failed: "#icon-failed",
  };

  const render = (job: Job | undefined): void => {
    if (!job) {
      ctx.host.remove();
      return;
    }

    ctx.host.dataset.status = job.status;
    title.textContent = job.displayTitle || EMPTY_TITLE;
    statusUse.setAttribute("href", STATUS_ICON[job.status]);
    url.textContent = job.url;

    if (job.status === "Downloading" && job.progress) {
      progress.textContent = `${job.progress.done} / ${job.progress.total} (${job.progress.stage})`;
      progress.hidden = false;
    } else {
      progress.hidden = true;
      progress.textContent = "";
    }

    if (job.status === "Failed" && job.failure) {
      reason.textContent = `Reason: ${job.failure.reason}`;
      reason.hidden = false;
    } else {
      reason.hidden = true;
      reason.textContent = "";
    }

    if (job.status === "Failed" && job.failure?.retryable) {
      actionUse.setAttribute("href", "#icon-retry");
      action.dataset.action = "retry";
      action.setAttribute("aria-label", "Retry");
      action.hidden = false;
    } else if (job.status === "Queued" || job.status === "Failed") {
      actionUse.setAttribute("href", "#icon-delete");
      action.dataset.action = "remove";
      action.setAttribute("aria-label", "Remove");
      action.hidden = false;
    } else {
      action.hidden = true;
      action.removeAttribute("data-action");
    }
  };

  ctx.on(ctx.host, "click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const which = target.dataset.action;
    if (which === "remove") void removeJobById(id);
    else if (which === "retry") void retryJobById(id);
  });

  render($jobs.get()[id]);
  const unsubscribe = listenKeys($jobs, [id], (value) => {
    render(value[id]);
  });
  ctx.onCleanup(unsubscribe);
});
