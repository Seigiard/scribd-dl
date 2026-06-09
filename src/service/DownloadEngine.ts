import { Context, type Effect, type Stream } from "effect";
import type { JobNotFound, NotRemovable, NotRetryable } from "../errors/DomainErrors";

export type JobId = string & { readonly _brand: "JobId" };

export type JobStatus = "Queued" | "Downloading" | "Downloaded" | "Failed";

export type JobDomain = "scribd" | "unsupported";

export interface JobFailure {
  readonly reason: string;
  readonly retryable: boolean;
}

export interface Job {
  readonly id: JobId;
  readonly url: string;
  readonly domain: JobDomain;
  readonly displayTitle: string;
  readonly status: JobStatus;
  readonly failure?: JobFailure;
}

export interface EngineSnapshot {
  readonly jobs: ReadonlyArray<Job>;
}

export type JobEvent =
  | { readonly _tag: "JobAdded"; readonly job: Job }
  | { readonly _tag: "JobStarted"; readonly id: JobId }
  | { readonly _tag: "JobCompleted"; readonly id: JobId }
  | { readonly _tag: "JobFailed"; readonly id: JobId; readonly reason: string; readonly retryable: boolean }
  | { readonly _tag: "JobRemoved"; readonly id: JobId }
  | { readonly _tag: "JobRequeued"; readonly id: JobId };

export interface DownloadEngineService {
  readonly enqueue: (text: string) => Effect.Effect<ReadonlyArray<Job>, never, never>;
  readonly remove: (id: JobId) => Effect.Effect<void, JobNotFound | NotRemovable, never>;
  readonly retry: (id: JobId) => Effect.Effect<void, JobNotFound | NotRetryable, never>;
  readonly snapshot: Effect.Effect<EngineSnapshot, never, never>;
  readonly events: Stream.Stream<JobEvent, never, never>;
}

export class DownloadEngine extends Context.Tag("DownloadEngine")<DownloadEngine, DownloadEngineService>() {}
