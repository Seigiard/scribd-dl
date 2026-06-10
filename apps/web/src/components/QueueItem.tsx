import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Job, JobStatus } from "@scribd-dl/shared";

export interface QueueItemProps {
  readonly job: Job;
  readonly onRemove?: (id: string) => void;
  readonly onRetry?: (id: string) => void;
}

const STATUS_STYLE: Record<JobStatus, string> = {
  Queued: "text-status-queued-fg bg-status-queued-bg",
  Downloading: "text-status-downloading-fg bg-status-downloading-bg",
  Downloaded: "text-status-downloaded-fg bg-status-downloaded-bg",
  Failed: "text-status-failed-fg bg-status-failed-bg",
};

const percent = (done: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
};

export const QueueItem = ({ job, onRemove, onRetry }: QueueItemProps) => {
  const showProgress = job.status === "Downloading" && job.progress !== undefined;
  const canRemove = job.status === "Queued" && onRemove !== undefined;
  const canRetry =
    job.status === "Failed" && job.failure?.retryable === true && onRetry !== undefined;

  return (
    <Card data-testid="queue-item" data-job-id={job.id}>
      <CardContent className="flex flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <span
            className="truncate text-[14px] font-medium text-ink"
            data-testid="job-title"
          >
            {job.displayTitle}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium tracking-[0.02em]",
                STATUS_STYLE[job.status],
              )}
              data-testid="job-status"
            >
              {job.status}
            </span>
            {canRemove && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(job.id)}
                aria-label="Remove"
                data-testid="remove-button"
              >
                ×
              </Button>
            )}
            {canRetry && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRetry(job.id)}
                data-testid="retry-button"
              >
                Retry
              </Button>
            )}
          </div>
        </div>
        <span
          className="truncate font-mono text-[12px] text-ink-subtle"
          data-testid="job-url"
        >
          {job.url}
        </span>
        {showProgress && job.progress && (
          <div className="mt-1 flex items-center gap-3">
            <Progress
              value={percent(job.progress.done, job.progress.total)}
              className="flex-1"
            />
            <span
              className="font-mono text-[11px] text-ink-subtle tabular-nums"
              data-testid="job-progress-text"
            >
              {job.progress.done} / {job.progress.total} ({job.progress.stage})
            </span>
          </div>
        )}
        {job.status === "Failed" && job.failure && (
          <span className="text-[12px] text-status-failed-fg" data-testid="job-reason">
            Reason: {job.failure.reason}
          </span>
        )}
      </CardContent>
    </Card>
  );
};
