import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Job, JobStatus } from "@/lib/types";

export interface QueueItemProps {
  readonly job: Job;
  readonly onRemove?: (id: string) => void;
  readonly onRetry?: (id: string) => void;
}

const STATUS_COLOR: Record<JobStatus, string> = {
  Queued: "text-neutral-400 bg-neutral-800/60",
  Downloading: "text-amber-300 bg-amber-950/60",
  Downloaded: "text-emerald-300 bg-emerald-950/60",
  Failed: "text-red-300 bg-red-950/60",
};

const percent = (done: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
};

export const QueueItem = ({ job, onRemove, onRetry }: QueueItemProps) => {
  const showProgress = job.status === "Downloading" && job.progress !== undefined;
  const canRemove = job.status === "Queued" && onRemove !== undefined;
  const canRetry = job.status === "Failed" && job.failure?.retryable === true && onRetry !== undefined;
  return (
    <Card data-testid="queue-item" data-job-id={job.id}>
      <CardContent className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-medium text-neutral-100" data-testid="job-title">
            {job.displayTitle}
          </span>
          <div className="flex items-center gap-2">
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide", STATUS_COLOR[job.status])} data-testid="job-status">
              {job.status}
            </span>
            {canRemove && (
              <Button variant="ghost" size="icon" onClick={() => onRemove(job.id)} aria-label="Remove" data-testid="remove-button">
                ×
              </Button>
            )}
            {canRetry && (
              <Button variant="outline" size="sm" onClick={() => onRetry(job.id)} data-testid="retry-button">
                Retry
              </Button>
            )}
          </div>
        </div>
        <span className="truncate font-mono text-xs text-neutral-500" data-testid="job-url">
          {job.url}
        </span>
        {showProgress && job.progress && (
          <div className="mt-1 flex items-center gap-2">
            <Progress value={percent(job.progress.done, job.progress.total)} className="flex-1" />
            <span className="font-mono text-xs text-neutral-400" data-testid="job-progress-text">
              {job.progress.done} / {job.progress.total} ({job.progress.stage})
            </span>
          </div>
        )}
        {job.status === "Failed" && job.failure && (
          <span className="text-xs text-red-400" data-testid="job-reason">
            Reason: {job.failure.reason}
          </span>
        )}
      </CardContent>
    </Card>
  );
};
