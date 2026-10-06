import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import type { Job } from "@scribd-dl/shared";
import { PersistenceFailed } from "../errors/DomainErrors";

export interface JobStoreService {
  readonly read: Effect.Effect<ReadonlyArray<Job>, never, never>;
  readonly write: (jobs: ReadonlyArray<Job>) => Effect.Effect<void, PersistenceFailed, never>;
}

export class JobStore extends Context.Service<JobStore, JobStoreService>()("JobStore") {}

export const JobStoreTag = JobStore;

const JOBS_FILENAME = "jobs.jsonl";

export const defaultBaseDir = (): string => path.join(os.homedir(), ".config", "scribd-dl");

const StoredJob = Schema.Struct({
  id: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  domain: Schema.Literals(["scribd", "unsupported"]),
  displayTitle: Schema.String,
  status: Schema.Literals(["Queued", "Downloading", "Downloaded", "Failed"]),
  failure: Schema.optional(Schema.Unknown),
  compression: Schema.optional(Schema.Unknown),
});

const StoredFailure = Schema.Struct({ reason: Schema.String, retryable: Schema.Boolean });

const StoredCompressionFailure = Schema.Struct({
  status: Schema.Literal("failed"),
  reason: Schema.String,
});

// Only a terminal `failed` compression on a `Downloaded` job survives to disk (KTD4):
// a transient `compressing` flag is always dropped so a killed engine never resumes
// with a stale in-flight marker.
const isTerminalFailedCompression = (job: Job): boolean => job.status === "Downloaded" && job.compression?.status === "failed";

const parseJobLine = (raw: string): Job | null => {
  try {
    const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(StoredJob))(raw);
    const { failure, compression, ...base } = parsed;
    const decodedFailure = Schema.decodeUnknownOption(StoredFailure)(failure);
    const decodedCompression = Schema.decodeUnknownOption(StoredCompressionFailure)(compression);
    let job: Job = base;

    if (Option.isSome(decodedFailure)) job = { ...job, failure: decodedFailure.value };

    if (base.status === "Downloaded" && Option.isSome(decodedCompression)) {
      job = { ...job, compression: decodedCompression.value };
    }

    return job;
  } catch {
    return null;
  }
};

const forPersist = (job: Job): Job => {
  const { progress: _progress, ...withoutProgress } = job;

  if (isTerminalFailedCompression(job)) return withoutProgress;
  const { compression: _drop, ...rest } = withoutProgress;

  return rest;
};

const normalize = (job: Job): Job => {
  if (job.status !== "Downloading") return job;

  const { progress: _progress, compression: _compression, ...rest } = job;

  return { ...rest, status: "Queued" };
};

export type JobStoreIo = Pick<typeof fs, "mkdir" | "writeFile" | "rename">;

export const makeJobStore = (baseDir: string, io: JobStoreIo = fs): Layer.Layer<JobStore, never, never> =>
  Layer.effect(
    JobStore,
    Effect.gen(function* () {
      const filePath = path.join(baseDir, JOBS_FILENAME);
      const tmpPath = `${filePath}.tmp`;
      const writeLock = yield* Semaphore.make(1);

      const read: Effect.Effect<ReadonlyArray<Job>, never, never> = Effect.sync(() => {
        let raw: string;

        try {
          raw = fsSync.readFileSync(filePath, "utf8");
        } catch (cause) {
          const err = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }))(cause);

          if (Option.isNone(err) || err.value.code !== "ENOENT") {
            console.warn(`[JobStore] failed to read ${filePath}; starting empty`, cause);
          }

          return [];
        }

        const lines = raw.split("\n");
        const out: Job[] = [];
        lines.forEach((line, idx) => {
          const trimmed = line.trim();

          if (trimmed === "") return;
          const parsed = parseJobLine(trimmed);

          if (!parsed) {
            console.warn(`[JobStore] skipping malformed line ${idx + 1} in ${filePath}`);

            return;
          }

          out.push(normalize(parsed));
        });

        return out;
      });

      const performWrite = (jobs: ReadonlyArray<Job>): Effect.Effect<void, PersistenceFailed, never> =>
        Effect.tryPromise({
          try: async () => {
            await io.mkdir(baseDir, { recursive: true });
            const body = jobs.map((j) => JSON.stringify(forPersist(j))).join("\n");
            const payload = jobs.length === 0 ? "" : `${body}\n`;
            await io.writeFile(tmpPath, payload, "utf8");
            await io.rename(tmpPath, filePath);
          },
          catch: (cause) => new PersistenceFailed({ path: filePath, op: "write", cause }),
        });

      const write = (jobs: ReadonlyArray<Job>): Effect.Effect<void, PersistenceFailed, never> =>
        writeLock.withPermits(1)(Effect.uninterruptible(performWrite(jobs)));

      return { read, write };
    }),
  );

export const JobStoreLive: Layer.Layer<JobStore, never, never> = makeJobStore(defaultBaseDir());
