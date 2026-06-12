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
} from "@scribd-dl/shared";
import { useEngineState } from "../hooks/useEngineState";
import { useTransient } from "../hooks/useTransient";
import { ChangeFolderPopup } from "./ChangeFolderPopup";
import { ClearAllConfirm } from "./ClearAllConfirm";
import { ExitConfirm } from "./ExitConfirm";
import { computeFocusable } from "./focus";
import { Header } from "./Header";
import { Queue, type ActionableControl } from "./Queue";
import { StatusZone } from "./StatusZone";

const DISCONNECT_MESSAGE = "Disconnected from engine";
const NO_LINKS_MESSAGE = "No links found in clipboard";
const URL_REGEX = /(https?:\/\/\S+)/g;

const extractUrls = (text: string): string[] => text.match(URL_REGEX) ?? [];

const hasActiveJobs = (snap: EngineSnapshot): boolean => snap.jobs.some((j) => j.status === "Queued" || j.status === "Downloading");

const looksLikePaste = (input: string): boolean => input.length > 5;

const totalJobCount = (snap: EngineSnapshot): number => snap.jobs.length;

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
  const [exitPopupOpen, setExitPopupOpen] = useState(false);
  const [exitPopupFocus, setExitPopupFocus] = useState(0);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearAllFocus, setClearAllFocus] = useState(0);
  const [changeFolderOpen, setChangeFolderOpen] = useState(false);

  const focusable = useMemo(() => computeFocusable(snapshot, transient), [snapshot, transient]);
  const focusCount = focusable.slots.length;
  const currentSlot = focusable.slots[focusIndex];

  const actionable = useMemo<ReadonlyArray<ActionableControl>>(
    () =>
      focusable.slots
        .filter((s): s is { kind: "remove" | "retry"; id: string } => s.kind === "remove" || s.kind === "retry")
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
    (jobs: ReadonlyArray<{ status: string; failure?: { reason?: string; retryable?: boolean } }>) => {
      if (jobs.length === 0) {
        showTransient("info", NO_LINKS_MESSAGE);
        return;
      }
      const rejected = jobs.filter((j) => j.status === "Failed" && j.failure?.retryable === false);
      if (rejected.length === jobs.length) {
        const reason = rejected[0]!.failure?.reason ?? "Unsupported link";
        const msg = rejected.length === 1 ? reason : `${reason} (${rejected.length} links)`;
        showTransient("warning", msg);
      } else if (rejected.length > 0) {
        showTransient("warning", `${rejected.length} of ${jobs.length} links rejected`);
      }
    },
    [showTransient],
  );

  useInput((input, key) => {
    if (changeFolderOpen) return;

    if (exitPopupOpen) {
      if (key.escape) {
        setExitPopupOpen(false);
        return;
      }
      if (key.tab) {
        setExitPopupFocus((i) => (i + 1) % 2);
        return;
      }
      if (key.return) {
        setExitPopupOpen(false);
        if (exitPopupFocus === 1) exit();
      }
      return;
    }

    if (clearAllOpen) {
      if (key.escape) {
        setClearAllOpen(false);
        return;
      }
      if (key.tab) {
        setClearAllFocus((i) => (i + 1) % 2);
        return;
      }
      if (key.return) {
        const shouldClear = clearAllFocus === 1;
        setClearAllOpen(false);
        if (shouldClear) {
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
        setExitPopupFocus(0);
        setExitPopupOpen(true);
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
        setClearAllFocus(0);
        setClearAllOpen(true);
        return;
      }
      if (currentSlot.kind === "remove") {
        void removeJob(baseUrl, currentSlot.id!).catch(() => {});
        return;
      }
      if (currentSlot.kind === "retry") {
        void retryJob(baseUrl, currentSlot.id!).catch(() => {});
        return;
      }
    }

    if (looksLikePaste(input)) {
      const links = extractUrls(input);
      if (links.length === 0) {
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
      {exitPopupOpen ? <ExitConfirm focus={exitPopupFocus} /> : null}
      {clearAllOpen ? <ClearAllConfirm focus={clearAllFocus} total={totalJobCount(snapshot)} /> : null}
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
