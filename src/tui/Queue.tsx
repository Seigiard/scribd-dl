import { Box } from "ink";
import type { EngineSnapshot } from "../service/DownloadEngine";
import { QueueItem } from "./QueueItem";

export interface QueueProps {
  readonly snapshot: EngineSnapshot;
}

export const Queue = ({ snapshot }: QueueProps) => {
  if (snapshot.jobs.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column">
      {snapshot.jobs.map((job) => (
        <QueueItem key={job.id} job={job} />
      ))}
    </Box>
  );
};
