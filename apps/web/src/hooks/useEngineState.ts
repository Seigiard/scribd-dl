import { useCallback, useEffect, useRef, useState } from "react";
import { getBackendUrl } from "@/lib/backendUrl";
import { fetchSnapshot, subscribeEvents, type EngineSnapshot, type EventsSubscription } from "@scribd-dl/shared";

const EMPTY_SNAPSHOT: EngineSnapshot = { jobs: [] };

export interface UseEngineState {
  readonly snapshot: EngineSnapshot;
  readonly baseUrl: string | null;
  readonly isConnected: boolean;
  readonly reconnect: () => void;
}

export const useEngineState = (): UseEngineState => {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY_SNAPSHOT);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const subRef = useRef<EventsSubscription | null>(null);

  const reconnect = useCallback(() => setReconnectKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    let url = "";

    const refresh = async () => {
      if (!alive || !url) return;
      try {
        const snap = await fetchSnapshot(url);
        if (alive) setSnapshot(snap);
      } catch {
        // ignore — disconnect-banner surfaces transport issues separately
      }
    };

    (async () => {
      url = await getBackendUrl();
      if (!alive) return;
      setBaseUrl(url);

      subRef.current = subscribeEvents(url, {
        onOpen: () => {
          if (!alive) return;
          setIsConnected(true);
          void refresh();
        },
        onMessage: () => {
          if (!alive) return;
          void refresh();
        },
        onClose: () => {
          if (!alive) return;
          setIsConnected(false);
        },
        onError: () => {
          if (!alive) return;
          setIsConnected(false);
        },
      });
    })();

    return () => {
      alive = false;
      subRef.current?.close();
      subRef.current = null;
    };
  }, [reconnectKey]);

  return { snapshot, baseUrl, isConnected, reconnect };
};
