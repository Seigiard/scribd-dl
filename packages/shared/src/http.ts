import type { EngineSnapshot, Job } from "./jobs";

export interface EnqueueRequest {
  readonly text: string;
}

export interface EnqueueResponse {
  readonly jobs: ReadonlyArray<Job>;
}

export interface FolderRequest {
  readonly path: string;
}

export interface FolderResponse {
  readonly path: string;
}

export interface SettingsResponse {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly valid: boolean | null;
}

export interface SettingsRequest {
  readonly publicKey: string;
  readonly secretKey: string;
}

export interface SaveSettingsResponse {
  readonly valid: boolean;
}

export type SnapshotResponse = EngineSnapshot;

export interface ErrorResponse {
  readonly error: string;
  readonly status?: string;
}

export interface ClearResponse {
  readonly removed: number;
}
