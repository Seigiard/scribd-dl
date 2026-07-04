export type JobId = string;

export type JobStatus = "Queued" | "Downloading" | "Downloaded" | "Failed";

export type JobDomain = "scribd" | "unsupported";

export type ProgressStage = "scrape" | "render";

export interface JobFailure {
  readonly reason: string;
  readonly retryable: boolean;
}

export interface JobProgress {
  readonly done: number;
  readonly total: number;
  readonly stage: ProgressStage;
}

export type JobCompression = { readonly status: "compressing" } | { readonly status: "failed"; readonly reason: string };

export interface Job {
  readonly id: JobId;
  readonly url: string;
  readonly domain: JobDomain;
  readonly displayTitle: string;
  readonly status: JobStatus;
  readonly failure?: JobFailure;
  readonly progress?: JobProgress;
  readonly compression?: JobCompression;
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
  | { readonly _tag: "JobRequeued"; readonly id: JobId }
  | { readonly _tag: "JobTitleUpdated"; readonly id: JobId; readonly title: string }
  | { readonly _tag: "JobProgress"; readonly id: JobId; readonly done: number; readonly total: number; readonly stage: ProgressStage }
  | { readonly _tag: "JobCompressing"; readonly id: JobId }
  | { readonly _tag: "JobCompressionFailed"; readonly id: JobId; readonly reason: string }
  | { readonly _tag: "OutputFolderChanged"; readonly path: string }
  | { readonly _tag: "SnapshotReplaced"; readonly snapshot: EngineSnapshot };
