import type { EngineSnapshot, Job } from "./types";

interface EnqueueResponse {
  readonly jobs: ReadonlyArray<Job>;
}

interface FolderResponse {
  readonly path: string;
}

const json = { "Content-Type": "application/json" };

export const fetchSnapshot = async (baseUrl: string): Promise<EngineSnapshot> => {
  const res = await fetch(`${baseUrl}/snapshot`);
  if (!res.ok) throw new Error(`GET /snapshot failed: ${res.status}`);
  return (await res.json()) as EngineSnapshot;
};

export const enqueueText = async (baseUrl: string, text: string): Promise<EnqueueResponse> => {
  const res = await fetch(`${baseUrl}/enqueue`, { method: "POST", headers: json, body: JSON.stringify({ text }) });
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
  const res = await fetch(`${baseUrl}/folder`, { method: "POST", headers: json, body: JSON.stringify({ path }) });
  if (!res.ok) throw new Error(`POST /folder failed: ${res.status}`);
};
