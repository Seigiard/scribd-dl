import { Box, Text } from "ink";
import type { Job, JobStatus } from "../service/DownloadEngine";

export interface QueueItemProps {
  readonly job: Job;
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

export const QueueItem = ({ job }: QueueItemProps) => {
  const color = statusColor(job.status);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Box flexGrow={1}>
          <Text>{job.displayTitle}</Text>
        </Box>
        <Text color={color}>{job.status}</Text>
      </Box>
      <Text dimColor>{job.url}</Text>
      {job.status === "Failed" && job.failure ? <Text color="red">Reason: {job.failure.reason}</Text> : null}
    </Box>
  );
};
