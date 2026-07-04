import { useCallback, useEffect, useState } from "react";
import {
  fetchSettings,
  fetchSnapshot,
  subscribeEvents,
  type EngineSnapshot,
  type JobEvent,
  type SettingsResponse,
} from "@scribd-dl/shared";

export interface UseEngineStateOptions {
  readonly onWsOpen?: () => void;
  readonly onWsClose?: () => void;
}

export interface UseEngineState {
  readonly snapshot: EngineSnapshot;
  readonly folder: string | null;
  readonly settings: SettingsResponse | null;
  readonly reloadSettings: () => void;
}

export const useEngineState = (
  baseUrl: string,
  initialFolder: string | null = null,
  options: UseEngineStateOptions = {},
): UseEngineState => {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>({ jobs: [] });
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);

  const { onWsOpen, onWsClose } = options;

  const reloadSettings = useCallback(() => {
    void fetchSettings(baseUrl)
      .then(setSettings)
      .catch(() => {});
  }, [baseUrl]);

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

    const refreshSettings = async () => {
      if (!alive) return;
      try {
        const s = await fetchSettings(baseUrl);
        if (alive) setSettings(s);
      } catch {
        // ignore — settings are non-critical; the popup seeds from null
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
    void refreshSettings();

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

  return { snapshot, folder, settings, reloadSettings };
};
