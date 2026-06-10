// Mirrors the JSON shape produced by src/service/DownloadEngine.ts.
// Kept duplicated rather than imported across project boundaries — the
// contract is the JSON wire format, not the TS module.

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

export interface Job {
  readonly id: string;
  readonly url: string;
  readonly domain: JobDomain;
  readonly displayTitle: string;
  readonly status: JobStatus;
  readonly failure?: JobFailure;
  readonly progress?: JobProgress;
}

export interface EngineSnapshot {
  readonly jobs: ReadonlyArray<Job>;
}

export type JobEvent =
  | { readonly _tag: "JobAdded"; readonly job: Job }
  | { readonly _tag: "JobStarted"; readonly id: string }
  | { readonly _tag: "JobCompleted"; readonly id: string }
  | { readonly _tag: "JobFailed"; readonly id: string; readonly reason: string; readonly retryable: boolean }
  | { readonly _tag: "JobRemoved"; readonly id: string }
  | { readonly _tag: "JobRequeued"; readonly id: string }
  | { readonly _tag: "JobTitleUpdated"; readonly id: string; readonly title: string }
  | { readonly _tag: "JobProgress"; readonly id: string; readonly done: number; readonly total: number; readonly stage: ProgressStage }
  | { readonly _tag: "OutputFolderChanged"; readonly path: string };
