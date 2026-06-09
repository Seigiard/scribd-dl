import { Text } from "ink";

export const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links • q to quit • Tab to navigate";

export interface StatusBarProps {
  readonly transientMessage?: string;
}

export const StatusBar = ({ transientMessage }: StatusBarProps) => {
  return <Text dimColor>{transientMessage ?? DEFAULT_HINT}</Text>;
};
