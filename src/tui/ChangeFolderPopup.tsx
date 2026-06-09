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

  return (
    <Box borderStyle="round" paddingX={2} flexDirection="column">
      <Text>Change download folder:</Text>
      <Box marginTop={1}>
        <Text inverse={focus === "input"}>{value || " "}</Text>
      </Box>
      <Box marginTop={1}>
        <Text inverse={focus === "cancel"}>[Cancel]</Text>
        <Text> </Text>
        <Text inverse={focus === "save"}>[Save]</Text>
      </Box>
    </Box>
  );
};
