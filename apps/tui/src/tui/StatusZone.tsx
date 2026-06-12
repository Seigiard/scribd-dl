import { Box, Text } from "ink";
import type { TransientSeverity, TransientState } from "./transient";

export const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links • q to quit • Tab to navigate";

export interface StatusZoneProps {
  readonly transient: TransientState | null;
  readonly clearFinishedEnabled: boolean;
  readonly clearAllEnabled: boolean;
  readonly clearFinishedFocused: boolean;
  readonly clearAllFocused: boolean;
}

const severityColor = (severity: TransientSeverity): string | undefined => {
  if (severity === "warning") return "yellow";
  if (severity === "error") return "red";
  return undefined;
};

export const StatusZone = ({
  transient,
  clearFinishedEnabled,
  clearAllEnabled,
  clearFinishedFocused,
  clearAllFocused,
}: StatusZoneProps) => {
  if (transient !== null) {
    const color = severityColor(transient.severity);
    const bold = transient.severity !== "info";
    const textProps = color === undefined ? { bold, dimColor: transient.severity === "info" } : { bold, color };
    return (
      <Box>
        <Text {...textProps}>{transient.message}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Box flexGrow={1}>
        <Text dimColor>{DEFAULT_HINT}</Text>
      </Box>
      <Text inverse={clearFinishedEnabled && clearFinishedFocused} dimColor={!clearFinishedEnabled}>
        [Clear Finished]
      </Text>
      <Text> </Text>
      <Text inverse={clearAllEnabled && clearAllFocused} dimColor={!clearAllEnabled}>
        [Clear All]
      </Text>
    </Box>
  );
};
