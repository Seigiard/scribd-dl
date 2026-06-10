import { Box, Text, useInput } from "ink";
import { useState } from "react";

export interface ChangeFolderPopupProps {
  readonly initial: string;
  readonly onSave: (path: string) => void;
  readonly onCancel: () => void;
}

type Focus = "input" | "cancel" | "save";

const order: ReadonlyArray<Focus> = ["input", "cancel", "save"];

export const ChangeFolderPopup = ({ initial, onSave, onCancel }: ChangeFolderPopupProps) => {
  const [value, setValue] = useState(initial);
  const [focus, setFocus] = useState<Focus>("input");

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      const idx = order.indexOf(focus);
      setFocus(order[(idx + 1) % order.length]!);
      return;
    }
    if (key.return) {
      if (focus === "cancel") {
        onCancel();
      } else {
        const trimmed = value.trim();
        if (trimmed !== "") onSave(trimmed);
      }
      return;
    }
    if (focus !== "input") return;
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  const inputFocused = focus === "input";

  return (
    <Box borderStyle="round" paddingX={2} paddingY={1} flexDirection="column" width="100%">
      <Text bold>Change download folder</Text>
      <Box
        marginTop={1}
        paddingX={1}
        width="100%"
        borderStyle="single"
        borderColor={inputFocused ? "cyan" : undefined}
        borderDimColor={!inputFocused}
      >
        <Text>{value}</Text>
        <Text color="cyan">{inputFocused ? "▎" : " "}</Text>
      </Box>
      <Box marginTop={1} gap={2}>
        <Button label="Cancel" focused={focus === "cancel"} />
        <Button label="Save" focused={focus === "save"} />
      </Box>
    </Box>
  );
};

const Button = ({ label, focused }: { label: string; focused: boolean }) => (
  <Text color={focused ? "cyan" : undefined} bold={focused} dimColor={!focused}>
    [{label}]
  </Text>
);
