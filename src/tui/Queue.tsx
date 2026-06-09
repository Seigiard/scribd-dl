import { Box } from "ink";
import type { EngineSnapshot, JobId } from "../service/DownloadEngine";
import { QueueItem, type QueueItemAction } from "./QueueItem";

export interface ActionableControl {
  readonly type: QueueItemAction;
  readonly id: JobId;
}

export interface QueueProps {
  readonly snapshot: EngineSnapshot;
  readonly actionable?: ReadonlyArray<ActionableControl>;
  readonly focusIndex?: number;
}

export const Queue = ({ snapshot, actionable = [], focusIndex = 0 }: QueueProps) => {
  if (snapshot.jobs.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column">
      {snapshot.jobs.map((job) => {
        const idx = actionable.findIndex((a) => a.id === job.id);
        const action = idx >= 0 ? actionable[idx]!.type : undefined;
        const focused = idx >= 0 && idx === focusIndex;
        return <QueueItem key={job.id} job={job} action={action} focused={focused} />;
      })}
    </Box>
  );
};
