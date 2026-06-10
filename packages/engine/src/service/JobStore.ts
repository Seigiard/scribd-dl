import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Context, Effect, Layer } from "effect";
import type { Job, JobDomain, JobFailure, JobStatus } from "@scribd-dl/shared";
import { PersistenceFailed } from "../errors/DomainErrors";

export interface JobStoreService {
  readonly read: Effect.Effect<ReadonlyArray<Job>, never, never>;
  readonly write: (jobs: ReadonlyArray<Job>) => Effect.Effect<void, PersistenceFailed, never>;
}

export class JobStore extends Context.Tag("JobStore")<JobStore, JobStoreService>() {}

const JOBS_FILENAME = "jobs.jsonl";

const VALID_DOMAINS: ReadonlyArray<JobDomain> = ["scribd", "unsupported"];
const VALID_STATUSES: ReadonlyArray<JobStatus> = ["Queued", "Downloading", "Downloaded", "Failed"];

export const defaultBaseDir = (): string => path.join(os.homedir(), ".config", "scribd-dl");

const isFailure = (value: unknown): value is JobFailure => {
  if (!value || typeof value !== "object") return false;
  const f = value as { reason?: unknown; retryable?: unknown };
  return typeof f.reason === "string" && typeof f.retryable === "boolean";
};

const parseJobLine = (raw: string): Job | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const j = parsed as {
    id?: unknown;
    url?: unknown;
    domain?: unknown;
    displayTitle?: unknown;
    status?: unknown;
    failure?: unknown;
  };
  if (typeof j.id !== "string" || j.id === "") return null;
  if (typeof j.url !== "string" || j.url === "") return null;
  if (typeof j.displayTitle !== "string") return null;
  if (typeof j.domain !== "string" || !VALID_DOMAINS.includes(j.domain as JobDomain)) return null;
  if (typeof j.status !== "string" || !VALID_STATUSES.includes(j.status as JobStatus)) return null;

  const base: Job = {
    id: j.id,
    url: j.url,
    domain: j.domain as JobDomain,
    displayTitle: j.displayTitle,
    status: j.status as JobStatus,
    ...(isFailure(j.failure) ? { failure: j.failure } : {}),
  };
  return base;
};

const normalize = (job: Job): Job => {
  if (job.status !== "Downloading") return job;
  return {
    id: job.id,
    url: job.url,
    domain: job.domain,
    displayTitle: job.displayTitle,
    status: "Queued",
    ...(job.failure ? { failure: job.failure } : {}),
  };
};

export const makeJobStore = (baseDir: string): Layer.Layer<JobStore, never, never> =>
  Layer.scoped(
    JobStore,
    Effect.gen(function* () {
      const filePath = path.join(baseDir, JOBS_FILENAME);
      const tmpPath = `${filePath}.tmp`;
      const writeLock = yield* Effect.makeSemaphore(1);

      const read: Effect.Effect<ReadonlyArray<Job>, never, never> = Effect.sync(() => {
        let raw: string;
        try {
          raw = fsSync.readFileSync(filePath, "utf8");
        } catch (cause) {
          const err = cause as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") {
            console.warn(`[JobStore] failed to read ${filePath} (${err.code}); starting empty`);
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
            await fs.mkdir(baseDir, { recursive: true });
            const body = jobs.map((j) => JSON.stringify(j)).join("\n");
            const payload = jobs.length === 0 ? "" : `${body}\n`;
            await fs.writeFile(tmpPath, payload, "utf8");
            await fs.rename(tmpPath, filePath);
          },
          catch: (cause) => new PersistenceFailed({ path: filePath, op: "write", cause }),
        });

      const write = (jobs: ReadonlyArray<Job>): Effect.Effect<void, PersistenceFailed, never> =>
        writeLock.withPermits(1)(performWrite(jobs));

      return { read, write };
    }),
  );

export const JobStoreLive: Layer.Layer<JobStore, never, never> = makeJobStore(defaultBaseDir());
