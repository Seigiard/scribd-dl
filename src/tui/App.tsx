import { Box, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
import { Effect } from "effect";
import type { DownloadEngineService, EngineSnapshot } from "../service/DownloadEngine";
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

const hasActiveJobs = (snap: EngineSnapshot): boolean => snap.jobs.some((j) => j.status === "Queued" || j.status === "Downloading");

const looksLikePaste = (input: string): boolean => input.length > 5;

export interface AppProps {
  readonly engine: DownloadEngineService;
  readonly folder: string;
  readonly onExit?: () => void;
}

export const App = ({ engine, folder, onExit }: AppProps) => {
  const snapshot = useEngineState(engine);
  const app = useApp();
  const exit = onExit ?? (() => app.exit());
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const [focusIndex, setFocusIndex] = useState(0);
  const [transient, setTransient] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupFocus, setPopupFocus] = useState(0);

  const actionable = useMemo(() => computeActionable(snapshot), [snapshot]);

  useEffect(() => {
    if (actionable.length === 0) {
      if (focusIndex !== 0) setFocusIndex(0);
    } else if (focusIndex >= actionable.length) {
      setFocusIndex(actionable.length - 1);
    }
  }, [actionable.length, focusIndex]);

  useEffect(() => {
    if (transient === null) return;
    const t = setTimeout(() => setTransient(null), 2000);
    return () => clearTimeout(t);
  }, [transient]);

  useInput((input, key) => {
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
      if (actionable.length > 0) {
        setFocusIndex((i) => (i + 1) % actionable.length);
      }
      return;
    }

    if (key.return) {
      const target = actionable[focusIndex];
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

  return (
    <Box flexDirection="column" height={rows}>
      <Header folder={folder} />
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        <Queue snapshot={snapshot} actionable={actionable} focusIndex={focusIndex} />
      </Box>
      <StatusBar transientMessage={transient ?? undefined} />
      {popupOpen ? <ExitConfirm focus={popupFocus} /> : null}
    </Box>
  );
};
