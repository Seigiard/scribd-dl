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
      <span class="item-title" data-ref="title"></span>
      <span class="item-status" data-ref="status"></span>
    </div>
    <div class="item-body">
      <span class="item-url" data-ref="url"></span>
      <span class="item-action" data-ref="action"></span>
    </div>
    <div class="item-progress" data-ref="progress" hidden></div>
    <div class="item-reason" data-ref="reason" hidden></div>
  `;

  const title = ctx.getElement<HTMLSpanElement>('[data-ref="title"]');
  const status = ctx.getElement<HTMLSpanElement>('[data-ref="status"]');
  const url = ctx.getElement<HTMLSpanElement>('[data-ref="url"]');
  const action = ctx.getElement<HTMLSpanElement>('[data-ref="action"]');
  const progress = ctx.getElement<HTMLDivElement>('[data-ref="progress"]');
  const reason = ctx.getElement<HTMLDivElement>('[data-ref="reason"]');

  const render = (job: Job | undefined): void => {
    if (!job) {
      ctx.host.remove();
      return;
    }

    ctx.host.dataset.status = job.status;
    title.textContent = job.displayTitle || EMPTY_TITLE;
    status.textContent = job.status === "Downloading" ? "Downloading..." : job.status;
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

    if (job.status === "Queued") {
      action.innerHTML = `<button type="button" class="btn btn-default" data-action="remove" aria-label="Remove">Remove</button>`;
    } else if (job.status === "Failed" && job.failure?.retryable) {
      action.innerHTML = `<button type="button" class="btn btn-primary" data-action="retry">Retry</button>`;
    } else {
      action.innerHTML = "";
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
