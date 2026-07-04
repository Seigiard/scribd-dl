import { Box, Text } from "ink";

export interface HeaderProps {
  readonly folder: string;
  readonly changeFocused?: boolean;
}

export const Header = ({ folder, changeFocused }: HeaderProps) => {
  return (
    <Box>
      <Text>Download folder: </Text>
      <Text bold>{folder}</Text>
      <Text> </Text>
      <Text inverse={changeFocused === true}>[Change]</Text>
      <Text> </Text>
      <Text dimColor>[s Settings]</Text>
    </Box>
  );
};
