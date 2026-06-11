import { html, type Hole } from "uhtml";
import type { Job, JobId } from "@scribd-dl/shared";
import { queueItem } from "./queue-item";

export type QueueProps = {
  jobs: Record<JobId, Job | undefined>;
};

const isJob = (j: Job | undefined): j is Job => j !== undefined;

export const queue = ({ jobs }: QueueProps): Hole => {
  const list = Object.values(jobs).filter(isJob);
  return html`<div class="queue">${list.map((job) => queueItem(job))}</div>`;
};
