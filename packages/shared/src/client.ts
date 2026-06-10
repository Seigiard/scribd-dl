import type { EngineSnapshot, JobEvent } from "./jobs";
import type { EnqueueResponse, FolderResponse } from "./http";

const JSON_HEADERS = { "Content-Type": "application/json" };

export const toWsUrl = (httpUrl: string): string => httpUrl.replace(/^http/, "ws");

export const fetchSnapshot = async (baseUrl: string): Promise<EngineSnapshot> => {
  const res = await fetch(`${baseUrl}/snapshot`);
  if (!res.ok) throw new Error(`GET /snapshot failed: ${res.status}`);
  return (await res.json()) as EngineSnapshot;
};

export const enqueueText = async (baseUrl: string, text: string): Promise<EnqueueResponse> => {
  const res = await fetch(`${baseUrl}/enqueue`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`POST /enqueue failed: ${res.status}`);
  return (await res.json()) as EnqueueResponse;
};

export const removeJob = async (baseUrl: string, id: string): Promise<void> => {
  const res = await fetch(`${baseUrl}/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 409 && res.status !== 404) {
    throw new Error(`DELETE /jobs failed: ${res.status}`);
  }
};

export const retryJob = async (baseUrl: string, id: string): Promise<void> => {
  const res = await fetch(`${baseUrl}/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
  if (!res.ok && res.status !== 409 && res.status !== 404) {
    throw new Error(`POST /jobs/retry failed: ${res.status}`);
  }
};

export const fetchFolder = async (baseUrl: string): Promise<string> => {
  const res = await fetch(`${baseUrl}/folder`);
  if (!res.ok) throw new Error(`GET /folder failed: ${res.status}`);
  return ((await res.json()) as FolderResponse).path;
};

export const setFolder = async (baseUrl: string, path: string): Promise<void> => {
  const res = await fetch(`${baseUrl}/folder`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`POST /folder failed: ${res.status}`);
};

export interface EventsHandlers {
  readonly onOpen?: () => void;
  readonly onMessage: (event: JobEvent) => void;
  readonly onClose?: () => void;
  readonly onError?: (err?: unknown) => void;
}

export interface EventsSubscription {
  readonly close: () => void;
}

export const subscribeEvents = (baseUrl: string, handlers: EventsHandlers): EventsSubscription => {
  const ws = new WebSocket(`${toWsUrl(baseUrl)}/events`);
  ws.onopen = () => handlers.onOpen?.();
  ws.onmessage = (msg: MessageEvent) => {
    try {
      const event = JSON.parse(typeof msg.data === "string" ? msg.data : "") as JobEvent;
      handlers.onMessage(event);
    } catch (err) {
      handlers.onError?.(err);
    }
  };
  ws.onclose = () => handlers.onClose?.();
  ws.onerror = () => handlers.onError?.();
  return { close: () => ws.close() };
};
