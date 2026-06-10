import { QueueItem } from "@/components/QueueItem";
import type { EngineSnapshot } from "@/lib/types";

export interface QueueProps {
  readonly snapshot: EngineSnapshot;
}

export const Queue = ({ snapshot }: QueueProps) => {
  if (snapshot.jobs.length === 0) {
    return <div className="flex-1" />;
  }
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" data-testid="queue">
      {snapshot.jobs.map((job) => (
        <QueueItem key={job.id} job={job} />
      ))}
    </div>
  );
};
