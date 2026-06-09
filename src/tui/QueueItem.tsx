import { Box, Text } from "ink";
import type { Job, JobStatus } from "../service/DownloadEngine";

export type QueueItemAction = "remove" | "retry";

export interface QueueItemProps {
  readonly job: Job;
  readonly action?: QueueItemAction;
  readonly focused?: boolean;
}

const statusColor = (status: JobStatus): string | undefined => {
  switch (status) {
    case "Queued":
      return undefined;
    case "Downloading":
      return "yellow";
    case "Downloaded":
      return "green";
    case "Failed":
      return "red";
  }
};

const actionLabel = (action?: QueueItemAction): string | null => {
  if (action === "remove") return "[Remove]";
  if (action === "retry") return "[Retry]";
  return null;
};

export const QueueItem = ({ job, action, focused }: QueueItemProps) => {
  const color = statusColor(job.status);
  const label = actionLabel(action);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Box flexGrow={1}>
          <Text>{job.displayTitle}</Text>
        </Box>
        <Text color={color}>{job.status}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text dimColor>{job.url}</Text>
        </Box>
        {label ? <Text inverse={focused === true}>{label}</Text> : null}
      </Box>
      {job.status === "Failed" && job.failure ? <Text color="red">Reason: {job.failure.reason}</Text> : null}
    </Box>
  );
};
