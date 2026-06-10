import { define } from "nanotags";
import { $jobs } from "@/store";
import type { JobId } from "@scribd-dl/shared";

const QUEUE_ITEM_TAG = "sd-queue-item";

define("sd-queue").setup((ctx) => {
  const present = new Set<JobId>();

  const sync = (value: Record<JobId, unknown>): void => {
    const nextIds: JobId[] = [];
    for (const key of Object.keys(value) as JobId[]) {
      if (value[key] !== undefined) nextIds.push(key);
    }
    const nextSet = new Set(nextIds);

    for (const id of present) {
      if (nextSet.has(id)) continue;
      const el = ctx.host.querySelector(`${QUEUE_ITEM_TAG}[job-id="${CSS.escape(id)}"]`);
      el?.remove();
      present.delete(id);
    }

    for (const id of nextIds) {
      if (present.has(id)) continue;
      const el = document.createElement(QUEUE_ITEM_TAG);
      el.setAttribute("job-id", id);
      ctx.host.appendChild(el);
      present.add(id);
    }
  };

  ctx.effect($jobs, sync);
});
