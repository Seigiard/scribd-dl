import { Header } from "@/components/Header";
import { Queue } from "@/components/Queue";
import { StatusBar } from "@/components/StatusBar";
import { useEngineState } from "@/hooks/useEngineState";
import { usePasteHandler } from "@/hooks/usePasteHandler";
import { enqueueText, fetchFolder } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

const NO_LINKS_MESSAGE = "No links found in clipboard";
const TRANSIENT_MS = 2000;

export const App = () => {
  const { snapshot, baseUrl } = useEngineState();
  const [folder, setFolder] = useState<string | null>(null);
  const [transientMessage, setTransientMessage] = useState<string | null>(null);
  const transientTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    fetchFolder(baseUrl)
      .then(setFolder)
      .catch(() => setFolder(null));
  }, [baseUrl, snapshot]);

  const showTransient = useCallback((msg: string) => {
    setTransientMessage(msg);
    if (transientTimerRef.current !== null) window.clearTimeout(transientTimerRef.current);
    transientTimerRef.current = window.setTimeout(() => setTransientMessage(null), TRANSIENT_MS);
  }, []);

  useEffect(
    () => () => {
      if (transientTimerRef.current !== null) window.clearTimeout(transientTimerRef.current);
    },
    [],
  );

  const handlePaste = useCallback(
    async (text: string) => {
      if (!baseUrl) return;
      try {
        const { jobs } = await enqueueText(baseUrl, text);
        if (jobs.length === 0) showTransient(NO_LINKS_MESSAGE);
      } catch {
        // transport errors surface via disconnect banner (U8), not transient toast
      }
    },
    [baseUrl, showTransient],
  );

  usePasteHandler({ onText: handlePaste });

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <Header folder={folder} />
      <Queue snapshot={snapshot} />
      <StatusBar transientMessage={transientMessage} />
    </div>
  );
};
