import { useEffect, useState } from "react";
import { fetchSnapshot, subscribeEvents, type EngineSnapshot, type JobEvent } from "@scribd-dl/shared";

export interface UseEngineStateOptions {
  readonly onWsOpen?: () => void;
  readonly onWsClose?: () => void;
}

export interface UseEngineState {
  readonly snapshot: EngineSnapshot;
  readonly folder: string | null;
}

export const useEngineState = (
  baseUrl: string,
  initialFolder: string | null = null,
  options: UseEngineStateOptions = {},
): UseEngineState => {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>({ jobs: [] });
  const [folder, setFolder] = useState<string | null>(initialFolder);

  const { onWsOpen, onWsClose } = options;

  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      if (!alive) return;
      try {
        const snap = await fetchSnapshot(baseUrl);
        if (alive) setSnapshot(snap);
      } catch {
        // ignore — connection errors surface via onWsClose
      }
    };

    const onEvent = (event: JobEvent) => {
      if (!alive) return;
      if (event._tag === "OutputFolderChanged") {
        setFolder(event.path);
        return;
      }
      if (event._tag === "SnapshotReplaced") {
        setSnapshot(event.snapshot);
        return;
      }
      void refresh();
    };

    void refresh();

    const sub = subscribeEvents(baseUrl, {
      onMessage: onEvent,
      onOpen: () => {
        if (alive) onWsOpen?.();
      },
      onClose: () => {
        if (alive) onWsClose?.();
      },
    });

    return () => {
      alive = false;
      sub.close();
    };
  }, [baseUrl, onWsOpen, onWsClose]);

  return { snapshot, folder };
};
