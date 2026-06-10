import { Box, Text } from "ink";

export interface ExitConfirmProps {
  readonly focus: number;
}

export const ExitConfirm = ({ focus }: ExitConfirmProps) => {
  return (
    <Box borderStyle="round" paddingX={2} flexDirection="column">
      <Text>Active downloads are in progress. Close anyway?</Text>
      <Box marginTop={1}>
        <Text inverse={focus === 0}>[Cancel]</Text>
        <Text> </Text>
        <Text inverse={focus === 1}>[Close anyway]</Text>
      </Box>
    </Box>
  );
};
