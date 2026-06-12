import { Box, Text } from "ink";

export interface ClearAllConfirmProps {
  readonly focus: number;
  readonly total: number;
}

export const ClearAllConfirm = ({ focus, total }: ClearAllConfirmProps) => {
  return (
    <Box borderStyle="round" paddingX={2} flexDirection="column">
      <Text>Remove all {total} jobs and cancel any active downloads? Files on disk are kept.</Text>
      <Box marginTop={1}>
        <Text inverse={focus === 0}>[Cancel]</Text>
        <Text> </Text>
        <Text inverse={focus === 1}>[Confirm]</Text>
      </Box>
    </Box>
  );
};
