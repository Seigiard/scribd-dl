import { Schema } from "effect";
import { JobSchema, type EngineSnapshot, type Job } from "./jobs";

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

export const EnqueueRequestSchema = Schema.Struct({
  text: Schema.String,
}) satisfies Schema.Schema<EnqueueRequest>;

export const FolderRequestSchema = Schema.Struct({
  path: Schema.String,
}) satisfies Schema.Schema<FolderRequest>;

export const SettingsRequestSchema = Schema.Struct({
  publicKey: Schema.String,
  secretKey: Schema.String,
}) satisfies Schema.Schema<SettingsRequest>;

export const EnqueueResponseSchema = Schema.Struct({
  jobs: Schema.Array(JobSchema),
}) satisfies Schema.Schema<EnqueueResponse>;

export const FolderResponseSchema = Schema.Struct({
  path: Schema.String,
}) satisfies Schema.Schema<FolderResponse>;

export const SettingsResponseSchema = Schema.Struct({
  publicKey: Schema.String,
  secretKey: Schema.String,
  valid: Schema.NullOr(Schema.Boolean),
}) satisfies Schema.Schema<SettingsResponse>;

export const SaveSettingsResponseSchema = Schema.Struct({
  valid: Schema.Boolean,
}) satisfies Schema.Schema<SaveSettingsResponse>;

export const ClearResponseSchema = Schema.Struct({
  removed: Schema.Number,
}) satisfies Schema.Schema<ClearResponse>;
