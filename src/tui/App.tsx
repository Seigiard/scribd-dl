import { Box } from "ink";
import type { DownloadEngineService } from "../service/DownloadEngine";
import { Header } from "./Header";
import { Queue } from "./Queue";
import { StatusBar } from "./StatusBar";
import { useEngineState } from "./useEngineState";

export interface AppProps {
  readonly engine: DownloadEngineService;
  readonly folder: string;
}

export const App = ({ engine, folder }: AppProps) => {
  const snapshot = useEngineState(engine);
  return (
    <Box flexDirection="column">
      <Header folder={folder} />
      <Box marginTop={1} flexDirection="column">
        <Queue snapshot={snapshot} />
      </Box>
      <Box marginTop={1}>
        <StatusBar />
      </Box>
    </Box>
  );
};
