import { Box, Text, useInput } from "ink";
import { useState } from "react";

export type SettingsValidity = "unverified" | "validating" | "valid" | "invalid";

export interface SettingsPopupProps {
  readonly initialPublicKey: string;
  readonly initialSecretKey: string;
  readonly initialValid: boolean | null;
  readonly onSave: (publicKey: string, secretKey: string) => Promise<boolean>;
  readonly onCancel: () => void;
}

type Focus = "public" | "secret" | "cancel" | "save";

const order: ReadonlyArray<Focus> = ["public", "secret", "cancel", "save"];

const validityFromFlag = (valid: boolean | null): SettingsValidity => (valid === null ? "unverified" : valid ? "valid" : "invalid");

const VALIDITY_LABEL: Record<SettingsValidity, string> = {
  unverified: "Not verified yet",
  validating: "Validating…",
  valid: "Keys valid",
  invalid: "Keys invalid",
};

const VALIDITY_COLOR: Record<SettingsValidity, string> = {
  unverified: "gray",
  validating: "cyan",
  valid: "green",
  invalid: "red",
};

const oneFilled = (pub: string, sec: string): boolean => (pub.trim() === "") !== (sec.trim() === "");

export const SettingsPopup = ({ initialPublicKey, initialSecretKey, initialValid, onSave, onCancel }: SettingsPopupProps) => {
  const [publicKey, setPublicKey] = useState(initialPublicKey);
  const [secretKey, setSecretKey] = useState(initialSecretKey);
  const [focus, setFocus] = useState<Focus>("public");
  const [validity, setValidity] = useState<SettingsValidity>(validityFromFlag(initialValid));

  const save = (): void => {
    const pub = publicKey.trim();
    const sec = secretKey.trim();
    // Both-empty clears; exactly-one-filled is incomplete and inert (never validated).
    if (oneFilled(pub, sec)) return;
    setValidity("validating");
    void onSave(pub, sec)
      .then((valid) => {
        const cleared = pub === "" && sec === "";
        setValidity(cleared ? "unverified" : valid ? "valid" : "invalid");
      })
      .catch(() => setValidity("unverified"));
  };

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
      if (focus === "cancel") onCancel();
      else save();
      return;
    }
    if (focus !== "public" && focus !== "secret") return;
    const setter = focus === "public" ? setPublicKey : setSecretKey;
    if (key.backspace || key.delete) {
      setter((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setter((v) => v + input);
    }
  });

  return (
    <Box borderStyle="round" paddingX={2} paddingY={1} flexDirection="column" width="100%">
      <Text bold>iLovePDF compression keys</Text>
      <Text dimColor>Downloads are uploaded to iLovePDF for compression when both keys are valid.</Text>
      <Field label="Public key" value={publicKey} focused={focus === "public"} />
      <Field label="Secret key" value={secretKey} focused={focus === "secret"} />
      <Box marginTop={1}>
        <Text color={VALIDITY_COLOR[validity]}>{VALIDITY_LABEL[validity]}</Text>
      </Box>
      <Box marginTop={1} gap={2}>
        <Button label="Cancel" focused={focus === "cancel"} />
        <Button label="Save" focused={focus === "save"} />
      </Box>
    </Box>
  );
};

const Field = ({ label, value, focused }: { label: string; value: string; focused: boolean }) => (
  <Box marginTop={1} flexDirection="column">
    <Text dimColor>{label}</Text>
    <Box paddingX={1} width="100%" borderStyle="single" borderColor={focused ? "cyan" : undefined} borderDimColor={!focused}>
      <Text>{value}</Text>
      <Text color="cyan">{focused ? "▎" : " "}</Text>
    </Box>
  </Box>
);

const Button = ({ label, focused }: { label: string; focused: boolean }) => {
  if (focused) {
    return (
      <Text color="cyan" bold>
        [{label}]
      </Text>
    );
  }
  return <Text dimColor>[{label}]</Text>;
};
