import { Schema } from "effect";
import { EngineSnapshotSchema, JobEventSchema } from "./jobs";
import {
  ClearResponseSchema,
  EnqueueResponseSchema,
  FolderResponseSchema,
  SaveSettingsResponseSchema,
  SettingsResponseSchema,
} from "./http";
import type { EngineSnapshot, JobEvent } from "./jobs";
import type { EnqueueResponse, SaveSettingsResponse, SettingsRequest, SettingsResponse } from "./http";

const JSON_HEADERS = { "Content-Type": "application/json" };

export const toWsUrl = (httpUrl: string): string => httpUrl.replace(/^http/, "ws");

export const fetchSnapshot = async (baseUrl: string): Promise<EngineSnapshot> => {
  const res = await fetch(`${baseUrl}/snapshot`);

  if (!res.ok) throw new Error(`GET /snapshot failed: ${res.status}`);

  return Schema.decodeUnknownSync(EngineSnapshotSchema)(await res.json());
};

export const enqueueText = async (baseUrl: string, text: string): Promise<EnqueueResponse> => {
  const res = await fetch(`${baseUrl}/enqueue`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ text }),
  });

  if (!res.ok) throw new Error(`POST /enqueue failed: ${res.status}`);

  return Schema.decodeUnknownSync(EnqueueResponseSchema)(await res.json());
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

  return Schema.decodeUnknownSync(FolderResponseSchema)(await res.json()).path;
};

export const setFolder = async (baseUrl: string, path: string): Promise<void> => {
  const res = await fetch(`${baseUrl}/folder`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path }),
  });

  if (!res.ok) throw new Error(`POST /folder failed: ${res.status}`);
};

export const fetchSettings = async (baseUrl: string): Promise<SettingsResponse> => {
  const res = await fetch(`${baseUrl}/settings`);

  if (!res.ok) throw new Error(`GET /settings failed: ${res.status}`);

  return Schema.decodeUnknownSync(SettingsResponseSchema)(await res.json());
};

export const saveSettings = async (baseUrl: string, req: SettingsRequest): Promise<SaveSettingsResponse> => {
  const res = await fetch(`${baseUrl}/settings`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(req),
  });

  if (!res.ok) throw new Error(`POST /settings failed: ${res.status}`);

  return Schema.decodeUnknownSync(SaveSettingsResponseSchema)(await res.json());
};

const clearByScope = async (baseUrl: string, scope: "completed" | "failed"): Promise<number> => {
  const res = await fetch(`${baseUrl}/jobs/${scope}`, { method: "DELETE" });

  if (!res.ok) throw new Error(`DELETE /jobs/${scope} failed: ${res.status}`);

  return Schema.decodeUnknownSync(ClearResponseSchema)(await res.json()).removed;
};

export const clearFinished = async (baseUrl: string): Promise<number> => {
  const [completed, failed] = await Promise.all([clearByScope(baseUrl, "completed"), clearByScope(baseUrl, "failed")]);

  return completed + failed;
};

export const clearAll = async (baseUrl: string): Promise<number> => {
  const res = await fetch(`${baseUrl}/jobs`, { method: "DELETE" });

  if (!res.ok) throw new Error(`DELETE /jobs failed: ${res.status}`);

  return Schema.decodeUnknownSync(ClearResponseSchema)(await res.json()).removed;
};

export interface EventsHandlers {
  readonly onOpen?: () => void;
  readonly onMessage: (event: JobEvent) => void;
  readonly onClose?: () => void;
  readonly onError?: (err: Error) => void;
}

export interface EventsSubscription {
  readonly close: () => void;
}

export const subscribeEvents = (baseUrl: string, handlers: EventsHandlers): EventsSubscription => {
  const ws = new WebSocket(`${toWsUrl(baseUrl)}/events`);
  ws.onopen = () => handlers.onOpen?.();
  ws.onmessage = (msg: MessageEvent<unknown>) => {
    try {
      const event = Schema.decodeUnknownSync(Schema.fromJsonString(JobEventSchema))(msg.data);

      handlers.onMessage(event);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  ws.onclose = () => handlers.onClose?.();
  ws.onerror = () => handlers.onError?.(new Error("WebSocket /events failed"));

  return { close: () => ws.close() };
};
