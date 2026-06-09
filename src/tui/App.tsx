import { Box, Text } from "ink";
import type { DownloadEngineService } from "../service/DownloadEngine";
import { useEngineState } from "./useEngineState";

export interface AppProps {
  readonly engine: DownloadEngineService;
  readonly folder: string;
}

export const App = ({ engine, folder }: AppProps) => {
  const snapshot = useEngineState(engine);
  return (
    <Box flexDirection="column">
      <Text>Download folder: {folder}</Text>
      <Text>{snapshot.jobs.length} jobs</Text>
    </Box>
  );
};
