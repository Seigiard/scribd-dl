import { Box, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
import { Effect, Fiber, Stream } from "effect";
import type { EngineSnapshot } from "@scribd-dl/shared";
import type { DownloadEngineService } from "../service/DownloadEngine";
import { ChangeFolderPopup } from "./ChangeFolderPopup";
import { ExitConfirm } from "./ExitConfirm";
import { Header } from "./Header";
import { Queue, type ActionableControl } from "./Queue";
import { StatusBar } from "./StatusBar";
import { useEngineState } from "./useEngineState";

const computeActionable = (snap: EngineSnapshot): ReadonlyArray<ActionableControl> => {
  const out: ActionableControl[] = [];
  for (const j of snap.jobs) {
    if (j.status === "Queued") {
      out.push({ type: "remove", id: j.id });
    }
  }
  for (const j of snap.jobs) {
    if (j.status === "Failed" && j.failure?.retryable === true) {
      out.push({ type: "retry", id: j.id });
    }
  }
  return out;
};

const useOutputFolder = (engine: DownloadEngineService, initial: string): string => {
  const [folder, setFolder] = useState(initial);
  useEffect(() => {
    Effect.runPromise(engine.outputFolder)
      .then(setFolder)
      .catch(() => {});
    const subscribe = Stream.runForEach(engine.events, (e) =>
      e._tag === "OutputFolderChanged" ? Effect.sync(() => setFolder(e.path)) : Effect.void,
    );
    const fiber = Effect.runFork(subscribe);
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [engine]);
  return folder;
};

const hasActiveJobs = (snap: EngineSnapshot): boolean => snap.jobs.some((j) => j.status === "Queued" || j.status === "Downloading");

const looksLikePaste = (input: string): boolean => input.length > 5;

export interface AppProps {
  readonly engine: DownloadEngineService;
  readonly folder: string;
  readonly onExit?: () => void;
}

export const App = ({ engine, folder: initialFolder, onExit }: AppProps) => {
  const snapshot = useEngineState(engine);
  const folder = useOutputFolder(engine, initialFolder);
  const app = useApp();
  const exit = onExit ?? (() => app.exit());
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const [focusIndex, setFocusIndex] = useState(0);
  const [transient, setTransient] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupFocus, setPopupFocus] = useState(0);
  const [changeFolderOpen, setChangeFolderOpen] = useState(false);

  const actionable = useMemo(() => computeActionable(snapshot), [snapshot]);
  const focusCount = actionable.length + 1; // index 0 = [Change]
  const changeFocused = focusIndex === 0;

  useEffect(() => {
    if (focusIndex >= focusCount) {
      setFocusIndex(focusCount - 1);
    }
  }, [focusCount, focusIndex]);

  useEffect(() => {
    if (transient === null) return;
    const t = setTimeout(() => setTransient(null), 2000);
    return () => clearTimeout(t);
  }, [transient]);

  useInput((input, key) => {
    if (changeFolderOpen) {
      return; // ChangeFolderPopup owns input while open
    }

    if (popupOpen) {
      if (key.escape) {
        setPopupOpen(false);
        return;
      }
      if (key.tab) {
        setPopupFocus((i) => (i + 1) % 2);
        return;
      }
      if (key.return) {
        if (popupFocus === 0) {
          setPopupOpen(false);
        } else {
          setPopupOpen(false);
          exit();
        }
      }
      return;
    }

    if (key.escape || input === "q" || input === "й") {
      if (hasActiveJobs(snapshot)) {
        setPopupFocus(0);
        setPopupOpen(true);
      } else {
        exit();
      }
      return;
    }

    if (key.tab) {
      setFocusIndex((i) => (i + 1) % focusCount);
      return;
    }

    if (key.return) {
      if (changeFocused) {
        setChangeFolderOpen(true);
        return;
      }
      const target = actionable[focusIndex - 1];
      if (!target) return;
      if (target.type === "remove") {
        Effect.runPromise(engine.remove(target.id)).catch(() => {});
      } else {
        Effect.runPromise(engine.retry(target.id)).catch(() => {});
      }
      return;
    }

    if (looksLikePaste(input)) {
      Effect.runPromise(engine.enqueue(input))
        .then((created) => {
          if (created.length === 0) {
            setTransient("No links found in clipboard");
          }
        })
        .catch(() => {});
    }
  });

  const queueFocusIndex = focusIndex - 1;

  return (
    <Box flexDirection="column" height={rows}>
      <Header folder={folder} changeFocused={changeFocused} />
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        <Queue snapshot={snapshot} actionable={actionable} focusIndex={queueFocusIndex} />
      </Box>
      <StatusBar transientMessage={transient ?? undefined} />
      {popupOpen ? <ExitConfirm focus={popupFocus} /> : null}
      {changeFolderOpen ? (
        <ChangeFolderPopup
          initial={folder}
          onSave={(path) => {
            Effect.runPromise(engine.setOutputFolder(path)).catch(() => {});
            setChangeFolderOpen(false);
          }}
          onCancel={() => setChangeFolderOpen(false)}
        />
      ) : null}
    </Box>
  );
};
