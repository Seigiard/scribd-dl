import { Cause, Context, Effect, Exit, Layer, Option, PubSub, Queue, Ref, Stream } from "effect";
import { JobNotFound, NotRemovable, NotRetryable } from "../errors/DomainErrors";
import { ScribdDownloader } from "./ScribdDownloader";
import * as scribdRegex from "../const/ScribdRegex";

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

const URL_REGEX = /(https?:\/\/\S+)/;

const extractUrls = (text: string): ReadonlyArray<string> => {
  const urls: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = URL_REGEX.exec(line);
    if (match) {
      urls.push(match[1]!);
    }
  }
  return urls;
};

const classify = (url: string): JobDomain => (scribdRegex.DOMAIN.test(url) ? "scribd" : "unsupported");

const deriveTitle = (url: string, domain: JobDomain): string => {
  if (domain === "unsupported") {
    return "Unsupported link";
  }
  const doc = scribdRegex.DOCUMENT.exec(url);
  if (doc) {
    return `Scribd document ${doc[2]}`;
  }
  const embed = scribdRegex.EMBED.exec(url);
  if (embed) {
    return `Scribd document ${embed[1]}`;
  }
  return "Scribd document";
};

const formatCause = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    const err = failure.value as { _tag?: string; message?: string; url?: string; path?: string };
    if (typeof err.message === "string" && err.message.length > 0) {
      return `${err._tag ?? "Error"}: ${err.message}`;
    }
    const parts: string[] = [];
    if (err._tag) parts.push(err._tag);
    if (typeof err.url === "string") parts.push(`url=${err.url}`);
    if (typeof err.path === "string") parts.push(`path=${err.path}`);
    if (parts.length > 0) {
      return parts.join(" ");
    }
    try {
      return JSON.stringify(err);
    } catch {
      return err._tag ?? "Unknown";
    }
  }
  return Cause.pretty(cause);
};

const newId = (): JobId => crypto.randomUUID() as JobId;

export const DownloadEngineLive: Layer.Layer<DownloadEngine, never, ScribdDownloader> = Layer.scoped(
  DownloadEngine,
  Effect.gen(function* () {
    const scribd = yield* ScribdDownloader;
    const stateRef = yield* Ref.make(new Map<JobId, Job>());
    const queue = yield* Queue.unbounded<JobId>();
    const pubsub = yield* PubSub.unbounded<JobEvent>();

    const publish = (event: JobEvent): Effect.Effect<void, never, never> => PubSub.publish(pubsub, event).pipe(Effect.asVoid);

    const setJob = (job: Job): Effect.Effect<void, never, never> =>
      Ref.update(stateRef, (m) => {
        const next = new Map(m);
        next.set(job.id, job);
        return next;
      });

    const enqueue = (text: string): Effect.Effect<ReadonlyArray<Job>, never, never> =>
      Effect.gen(function* () {
        const urls = extractUrls(text);
        const created: Job[] = [];
        for (const url of urls) {
          const domain = classify(url);
          const id = newId();
          const displayTitle = deriveTitle(url, domain);
          if (domain === "scribd") {
            const job: Job = { id, url, domain, displayTitle, status: "Queued" };
            yield* setJob(job);
            yield* publish({ _tag: "JobAdded", job });
            yield* Queue.offer(queue, id);
            created.push(job);
          } else {
            const failure: JobFailure = { reason: "Unsupported domain", retryable: false };
            const job: Job = { id, url, domain, displayTitle, status: "Failed", failure };
            yield* setJob(job);
            yield* publish({ _tag: "JobAdded", job });
            yield* publish({ _tag: "JobFailed", id, reason: failure.reason, retryable: failure.retryable });
            created.push(job);
          }
        }
        return created;
      });

    const remove = (id: JobId): Effect.Effect<void, JobNotFound | NotRemovable, never> =>
      Effect.gen(function* () {
        const map = yield* Ref.get(stateRef);
        const job = map.get(id);
        if (!job) {
          return yield* Effect.fail(new JobNotFound({ id }));
        }
        if (job.status !== "Queued") {
          return yield* Effect.fail(new NotRemovable({ id, status: job.status }));
        }
        yield* Ref.update(stateRef, (m) => {
          const next = new Map(m);
          next.delete(id);
          return next;
        });
        yield* publish({ _tag: "JobRemoved", id });
      });

    const retry = (id: JobId): Effect.Effect<void, JobNotFound | NotRetryable, never> =>
      Effect.gen(function* () {
        const map = yield* Ref.get(stateRef);
        const job = map.get(id);
        if (!job) {
          return yield* Effect.fail(new JobNotFound({ id }));
        }
        if (job.status !== "Failed" || job.failure?.retryable !== true) {
          return yield* Effect.fail(new NotRetryable({ id, status: job.status }));
        }
        const requeued: Job = { id: job.id, url: job.url, domain: job.domain, displayTitle: job.displayTitle, status: "Queued" };
        yield* setJob(requeued);
        yield* Queue.offer(queue, id);
        yield* publish({ _tag: "JobRequeued", id });
      });

    const snapshot: Effect.Effect<EngineSnapshot, never, never> = Ref.get(stateRef).pipe(
      Effect.map((m) => ({ jobs: Array.from(m.values()) })),
    );

    const events: Stream.Stream<JobEvent, never, never> = Stream.fromPubSub(pubsub);

    const worker = Effect.forever(
      Effect.gen(function* () {
        const id = yield* Queue.take(queue);
        const map = yield* Ref.get(stateRef);
        const current = map.get(id);
        if (!current || current.status !== "Queued") {
          return;
        }
        const downloading: Job = { ...current, status: "Downloading" };
        yield* setJob(downloading);
        yield* publish({ _tag: "JobStarted", id });
        const exit = yield* Effect.exit(scribd.execute(current.url));
        if (Exit.isSuccess(exit)) {
          yield* setJob({ ...downloading, status: "Downloaded" });
          yield* publish({ _tag: "JobCompleted", id });
        } else {
          const reason = formatCause(exit.cause);
          const failure: JobFailure = { reason, retryable: true };
          yield* setJob({ ...downloading, status: "Failed", failure });
          yield* publish({ _tag: "JobFailed", id, reason, retryable: true });
        }
      }),
    );

    yield* Effect.forkScoped(worker);

    return DownloadEngine.of({ enqueue, remove, retry, snapshot, events });
  }),
);
