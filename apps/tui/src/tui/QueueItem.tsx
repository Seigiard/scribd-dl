import { Box, Text } from "ink";
import type { Job, JobStatus } from "@scribd-dl/shared";

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

const BAR_WIDTH = 10;

const renderBar = (done: number, total: number): string => {
  if (total <= 0) return "";
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * BAR_WIDTH);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}] ${done}/${total}`;
};

export const QueueItem = ({ job, action, focused }: QueueItemProps) => {
  const color = statusColor(job.status);
  const label = actionLabel(action);
  const compressing = job.compression?.status === "compressing";
  // Compression runs while status is still Downloading (KTD3); its marker replaces
  // the progress bar so the row shows a single state.
  const showProgress = job.status === "Downloading" && job.progress && !job.compression;
  const compressionFailed = job.compression?.status === "failed" ? job.compression.reason : null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Box flexGrow={1} marginRight={1}>
          <Text wrap="truncate-end">{job.displayTitle}</Text>
        </Box>
        {compressing ? (
          <>
            <Text color="cyan">compressing…</Text>
            <Text> </Text>
          </>
        ) : null}
        {showProgress ? (
          <>
            <Text>{renderBar(job.progress!.done, job.progress!.total)}</Text>
            <Text> </Text>
          </>
        ) : null}
        {color ? <Text color={color}>{job.status}</Text> : <Text>{job.status}</Text>}
      </Box>
      <Box>
        <Box flexGrow={1} marginRight={1}>
          <Text dimColor wrap="truncate-end">
            {job.url}
          </Text>
        </Box>
        {label ? <Text inverse={focused === true}>{label}</Text> : null}
      </Box>
      {compressionFailed ? (
        <Text color="yellow" wrap="truncate-end">
          Compression failed, file kept — {compressionFailed}
        </Text>
      ) : null}
      {job.status === "Failed" && job.failure ? (
        <Text color="red" wrap="truncate-end">
          Reason: {job.failure.reason}
        </Text>
      ) : null}
    </Box>
  );
};
