import { Data, Schema } from "effect";

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

export type JobCompression =
  | { readonly status: "compressing" }
  | { readonly status: "failed"; readonly reason: string };

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
  | {
      readonly _tag: "JobFailed";
      readonly id: JobId;
      readonly reason: string;
      readonly retryable: boolean;
    }
  | { readonly _tag: "JobRemoved"; readonly id: JobId }
  | { readonly _tag: "JobRequeued"; readonly id: JobId }
  | { readonly _tag: "JobTitleUpdated"; readonly id: JobId; readonly title: string }
  | {
      readonly _tag: "JobProgress";
      readonly id: JobId;
      readonly done: number;
      readonly total: number;
      readonly stage: ProgressStage;
    }
  | { readonly _tag: "JobCompressing"; readonly id: JobId }
  | { readonly _tag: "JobCompressionFailed"; readonly id: JobId; readonly reason: string }
  | { readonly _tag: "OutputFolderChanged"; readonly path: string }
  | { readonly _tag: "SnapshotReplaced"; readonly snapshot: EngineSnapshot };

export const JobSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  domain: Schema.Literal("scribd", "unsupported"),
  displayTitle: Schema.String,
  status: Schema.Literal("Queued", "Downloading", "Downloaded", "Failed"),
  failure: Schema.optionalWith(
    Schema.Struct({ reason: Schema.String, retryable: Schema.Boolean }),
    { exact: true },
  ),
  progress: Schema.optionalWith(
    Schema.Struct({
      done: Schema.Number,
      total: Schema.Number,
      stage: Schema.Literal("scrape", "render"),
    }),
    { exact: true },
  ),
  compression: Schema.optionalWith(
    Schema.Union(
      Schema.Struct({ status: Schema.Literal("compressing") }),
      Schema.Struct({ status: Schema.Literal("failed"), reason: Schema.String }),
    ),
    { exact: true },
  ),
}) satisfies Schema.Schema<Job>;

export const EngineSnapshotSchema = Schema.Struct({
  jobs: Schema.Array(JobSchema),
}) satisfies Schema.Schema<EngineSnapshot>;

export const JobEventSchema = Schema.Union(
  Schema.TaggedStruct("JobAdded", { job: JobSchema }),
  Schema.TaggedStruct("JobStarted", { id: Schema.String }),
  Schema.TaggedStruct("JobCompleted", { id: Schema.String }),
  Schema.TaggedStruct("JobFailed", {
    id: Schema.String,
    reason: Schema.String,
    retryable: Schema.Boolean,
  }),
  Schema.TaggedStruct("JobRemoved", { id: Schema.String }),
  Schema.TaggedStruct("JobRequeued", { id: Schema.String }),
  Schema.TaggedStruct("JobTitleUpdated", { id: Schema.String, title: Schema.String }),
  Schema.TaggedStruct("JobProgress", {
    id: Schema.String,
    done: Schema.Number,
    total: Schema.Number,
    stage: Schema.Literal("scrape", "render"),
  }),
  Schema.TaggedStruct("JobCompressing", { id: Schema.String }),
  Schema.TaggedStruct("JobCompressionFailed", { id: Schema.String, reason: Schema.String }),
  Schema.TaggedStruct("OutputFolderChanged", { path: Schema.String }),
  Schema.TaggedStruct("SnapshotReplaced", { snapshot: EngineSnapshotSchema }),
) satisfies Schema.Schema<JobEvent>;

export const JobEvents = Data.taggedEnum<JobEvent>();
