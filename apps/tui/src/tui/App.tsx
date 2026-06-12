import { Box, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearAll,
  clearFinished,
  enqueueText,
  removeJob,
  retryJob,
  setFolder as apiSetFolder,
  type EngineSnapshot,
  type EnqueueResponse,
} from "@scribd-dl/shared";
import { useEngineState } from "../hooks/useEngineState";
import { useTransient } from "../hooks/useTransient";
import { ChangeFolderPopup } from "./ChangeFolderPopup";
import { ClearAllConfirm } from "./ClearAllConfirm";
import { ExitConfirm } from "./ExitConfirm";
import { computeFocusable, type FocusableSlot } from "./focus";
import { Header } from "./Header";
import { Queue, type ActionableControl } from "./Queue";
import { StatusZone } from "./StatusZone";

const DISCONNECT_MESSAGE = "Disconnected from engine";
const NO_LINKS_MESSAGE = "No links found in clipboard";
const URL_REGEX = /https?:\/\/\S+/;

const hasUrl = (text: string): boolean => URL_REGEX.test(text);

const hasActiveJobs = (snap: EngineSnapshot): boolean => snap.jobs.some((j) => j.status === "Queued" || j.status === "Downloading");

const looksLikePaste = (input: string): boolean => input.length > 5;

type ConfirmDialog = { readonly kind: "exit" | "clearAll"; readonly focus: 0 | 1 };

export interface AppProps {
  readonly baseUrl: string;
  readonly initialFolder: string;
  readonly onExit?: () => void;
}

export const App = ({ baseUrl, initialFolder, onExit }: AppProps) => {
  const { transient, showTransient, dismissSticky } = useTransient();

  const onWsClose = useCallback(() => {
    showTransient("error", DISCONNECT_MESSAGE, { sticky: true });
  }, [showTransient]);

  const onWsOpen = useCallback(() => {
    dismissSticky();
  }, [dismissSticky]);

  const { snapshot, folder: liveFolder } = useEngineState(baseUrl, initialFolder, { onWsOpen, onWsClose });
  const folder = liveFolder ?? initialFolder;
  const app = useApp();
  const exit = useCallback(() => (onExit ? onExit() : app.exit()), [app, onExit]);
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const [focusIndex, setFocusIndex] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [changeFolderOpen, setChangeFolderOpen] = useState(false);

  const focusable = useMemo(() => computeFocusable(snapshot, transient), [snapshot, transient]);
  const focusCount = focusable.slots.length;
  const currentSlot = focusable.slots[focusIndex];

  const actionable = useMemo<ReadonlyArray<ActionableControl>>(
    () =>
      focusable.slots
        .filter((s): s is Extract<FocusableSlot, { readonly kind: "remove" | "retry" }> => s.kind === "remove" || s.kind === "retry")
        .map((s) => ({ type: s.kind, id: s.id })),
    [focusable.slots],
  );

  const queueFocusIndex =
    currentSlot && (currentSlot.kind === "remove" || currentSlot.kind === "retry")
      ? actionable.findIndex((a) => a.id === currentSlot.id)
      : -1;

  useEffect(() => {
    if (focusIndex >= focusCount) {
      setFocusIndex(focusCount === 0 ? 0 : focusCount - 1);
    }
  }, [focusCount, focusIndex]);

  const handleEnqueueResult = useCallback(
    (jobs: EnqueueResponse["jobs"]) => {
      if (jobs.length === 0) {
        showTransient("info", NO_LINKS_MESSAGE);
        return;
      }

      let rejectedCount = 0;
      let firstReason = "Unsupported link";
      for (const job of jobs) {
        if (job.status === "Failed" && job.failure?.retryable === false) {
          rejectedCount += 1;
          if (rejectedCount === 1) firstReason = job.failure.reason;
        }
      }

      if (rejectedCount === jobs.length) {
        const msg = rejectedCount === 1 ? firstReason : `${firstReason} (${rejectedCount} links)`;
        showTransient("warning", msg);
      } else if (rejectedCount > 0) {
        showTransient("warning", `${rejectedCount} of ${jobs.length} links rejected`);
      }
    },
    [showTransient],
  );

  useInput((input, key) => {
    if (changeFolderOpen) return;

    if (confirmDialog) {
      if (key.escape) {
        setConfirmDialog(null);
        return;
      }
      if (key.tab) {
        setConfirmDialog((dialog) => (dialog ? { ...dialog, focus: dialog.focus === 0 ? 1 : 0 } : null));
        return;
      }
      if (key.return) {
        const accepted = confirmDialog.focus === 1;
        const kind = confirmDialog.kind;
        setConfirmDialog(null);
        if (accepted && kind === "exit") {
          exit();
        }
        if (accepted && kind === "clearAll") {
          void clearAll(baseUrl).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : "Failed to clear all jobs";
            showTransient("error", msg);
          });
        }
      }
      return;
    }

    if (key.escape || input === "q" || input === "й") {
      if (hasActiveJobs(snapshot)) {
        setConfirmDialog({ kind: "exit", focus: 0 });
      } else {
        exit();
      }
      return;
    }

    if (key.tab) {
      if (focusCount > 0) setFocusIndex((i) => (i + 1) % focusCount);
      return;
    }

    if (key.return) {
      if (!currentSlot) return;
      if (currentSlot.kind === "change") {
        setChangeFolderOpen(true);
        return;
      }
      if (currentSlot.kind === "clearFinished") {
        void clearFinished(baseUrl).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : "Failed to clear finished jobs";
          showTransient("error", msg);
        });
        return;
      }
      if (currentSlot.kind === "clearAll") {
        setConfirmDialog({ kind: "clearAll", focus: 0 });
        return;
      }
      if (currentSlot.kind === "remove") {
        void removeJob(baseUrl, currentSlot.id).catch(() => {});
        return;
      }
      if (currentSlot.kind === "retry") {
        void retryJob(baseUrl, currentSlot.id).catch(() => {});
        return;
      }
    }

    if (looksLikePaste(input)) {
      if (!hasUrl(input)) {
        showTransient("info", NO_LINKS_MESSAGE);
        return;
      }
      void enqueueText(baseUrl, input)
        .then(({ jobs }) => handleEnqueueResult(jobs))
        .catch(() => {});
    }
  });

  const changeFocused = currentSlot?.kind === "change";
  const clearFinishedFocused = currentSlot?.kind === "clearFinished";
  const clearAllFocused = currentSlot?.kind === "clearAll";

  return (
    <Box flexDirection="column" height={rows}>
      <Header folder={folder} changeFocused={changeFocused} />
      <StatusZone
        transient={transient}
        clearFinishedEnabled={focusable.hasTerminal}
        clearAllEnabled={focusable.hasAny}
        clearFinishedFocused={clearFinishedFocused}
        clearAllFocused={clearAllFocused}
      />
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        <Queue snapshot={snapshot} actionable={actionable} focusIndex={queueFocusIndex} />
      </Box>
      {confirmDialog?.kind === "exit" ? <ExitConfirm focus={confirmDialog.focus} /> : null}
      {confirmDialog?.kind === "clearAll" ? <ClearAllConfirm focus={confirmDialog.focus} total={snapshot.jobs.length} /> : null}
      {changeFolderOpen ? (
        <ChangeFolderPopup
          initial={folder}
          onSave={(path) => {
            void apiSetFolder(baseUrl, path).catch(() => {});
            setChangeFolderOpen(false);
          }}
          onCancel={() => setChangeFolderOpen(false)}
        />
      ) : null}
    </Box>
  );
};
