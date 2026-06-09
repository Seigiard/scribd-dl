import { Box, Text } from "ink";

export interface HeaderProps {
  readonly folder: string;
}

export const Header = ({ folder }: HeaderProps) => {
  return (
    <Box>
      <Text>Download folder: </Text>
      <Text bold>{folder}</Text>
    </Box>
  );
};
