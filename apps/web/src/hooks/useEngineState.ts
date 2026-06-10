import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSnapshot } from "@/lib/api";
import { getBackendUrl, toWsUrl } from "@/lib/backendUrl";
import type { EngineSnapshot } from "@scribd-dl/shared";

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
  const wsRef = useRef<WebSocket | null>(null);

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

      const ws = new WebSocket(`${toWsUrl(url)}/events`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) return;
        setIsConnected(true);
        void refresh();
      };
      ws.onmessage = () => {
        if (!alive) return;
        void refresh();
      };
      ws.onclose = () => {
        if (!alive) return;
        setIsConnected(false);
      };
      ws.onerror = () => {
        if (!alive) return;
        setIsConnected(false);
      };
    })();

    return () => {
      alive = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [reconnectKey]);

  return { snapshot, baseUrl, isConnected, reconnect };
};
