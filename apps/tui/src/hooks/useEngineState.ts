import { useEffect, useState } from "react";
import { fetchSnapshot, subscribeEvents, type EngineSnapshot, type JobEvent } from "@scribd-dl/shared";

export interface UseEngineState {
  readonly snapshot: EngineSnapshot;
  readonly folder: string | null;
}

export const useEngineState = (baseUrl: string, initialFolder: string | null = null): UseEngineState => {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>({ jobs: [] });
  const [folder, setFolder] = useState<string | null>(initialFolder);

  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      if (!alive) return;
      try {
        const snap = await fetchSnapshot(baseUrl);
        if (alive) setSnapshot(snap);
      } catch {
        // ignore — connection errors are non-fatal at runtime
      }
    };

    const onEvent = (event: JobEvent) => {
      if (!alive) return;
      if (event._tag === "OutputFolderChanged") {
        setFolder(event.path);
        return;
      }
      void refresh();
    };

    void refresh();

    const sub = subscribeEvents(baseUrl, {
      onMessage: onEvent,
    });

    return () => {
      alive = false;
      sub.close();
    };
  }, [baseUrl]);

  return { snapshot, folder };
};
