import { Cause, Context, Effect, Exit, Fiber, Layer, Option, PubSub, Queue, Ref, Stream } from "effect";
import * as fs from "node:fs/promises";
import type { EngineSnapshot, Job, JobDomain, JobEvent, JobFailure, JobId, JobProgress } from "@scribd-dl/shared";
import { JobNotFound, NotRemovable, NotRetryable } from "../errors/DomainErrors";
import { ConfigLoader } from "../utils/io/ConfigLoader";
import { expandHome } from "../utils/io/path";
import { resolvePdfPath, scribdIdFromUrl } from "../utils/io/pdfPath";
import { normalizeUrl } from "../utils/url";
import { ConfigStore } from "./ConfigStore";
import { JobStore } from "./JobStore";
import { ScribdDownloader, type OnEvent } from "./ScribdDownloader";
import * as scribdRegex from "../const/ScribdRegex";

export interface DownloadEngineService {
  readonly enqueue: (text: string) => Effect.Effect<ReadonlyArray<Job>, never, never>;
  readonly remove: (id: JobId) => Effect.Effect<void, JobNotFound | NotRemovable, never>;
  readonly retry: (id: JobId) => Effect.Effect<void, JobNotFound | NotRetryable, never>;
  readonly clearCompleted: Effect.Effect<number, never, never>;
  readonly clearFailed: Effect.Effect<number, never, never>;
  readonly clearAll: Effect.Effect<number, never, never>;
  readonly snapshot: Effect.Effect<EngineSnapshot, never, never>;
  readonly events: Stream.Stream<JobEvent, never, never>;
  readonly outputFolder: Effect.Effect<string, never, never>;
  readonly setOutputFolder: (path: string) => Effect.Effect<void, never, never>;
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

export const DownloadEngineLive: Layer.Layer<DownloadEngine, never, ScribdDownloader | ConfigLoader | ConfigStore | JobStore> =
  Layer.scoped(
    DownloadEngine,
    Effect.gen(function* () {
      const scribd = yield* ScribdDownloader;
      const configStore = yield* ConfigStore;
      const jobStore = yield* JobStore;

      const restored = yield* jobStore.read;
      const settings = yield* configStore.read;

      const stateRef = yield* Ref.make(new Map<JobId, Job>(restored.map((j) => [j.id, j])));
      const folderRef = yield* Ref.make(settings.outputFolder);
      const queue = yield* Queue.unbounded<JobId>();
      const pubsub = yield* PubSub.unbounded<JobEvent>();
      type ActiveFiber = { readonly id: JobId; readonly fiber: Fiber.RuntimeFiber<unknown, unknown> };
      const activeFiberRef = yield* Ref.make<Option.Option<ActiveFiber>>(Option.none());

      for (const job of restored) {
        if (job.status === "Queued") {
          yield* Queue.offer(queue, job.id);
        }
      }

      const publish = (event: JobEvent): Effect.Effect<void, never, never> => PubSub.publish(pubsub, event).pipe(Effect.asVoid);

      const persistJobs: Effect.Effect<void, never, never> = Effect.gen(function* () {
        const map = yield* Ref.get(stateRef);
        yield* jobStore
          .write(Array.from(map.values()))
          .pipe(Effect.catchAll((cause) => Effect.sync(() => console.warn("[DownloadEngine] failed to persist jobs:", cause))));
      });

      const persistSettings = (folder: string): Effect.Effect<void, never, never> =>
        configStore
          .write({ outputFolder: folder })
          .pipe(Effect.catchAll((cause) => Effect.sync(() => console.warn("[DownloadEngine] failed to persist settings:", cause))));

      const setJob = (job: Job): Effect.Effect<void, never, never> =>
        Ref.update(stateRef, (m) => {
          const next = new Map(m);
          next.set(job.id, job);
          return next;
        });

      const currentSnapshot: Effect.Effect<EngineSnapshot, never, never> = Ref.get(stateRef).pipe(
        Effect.map((m) => ({ jobs: Array.from(m.values()) })),
      );

      const publishSnapshot: Effect.Effect<void, never, never> = Effect.gen(function* () {
        const snap = yield* currentSnapshot;
        yield* publish({ _tag: "SnapshotReplaced", snapshot: snap });
      });

      const fileExists = (path: string): Effect.Effect<boolean, never, never> =>
        Effect.tryPromise({
          try: () => fs.stat(path).then(() => true),
          catch: () => false as const,
        }).pipe(Effect.catchAll(() => Effect.succeed(false)));

      const prependTouched = (touched: ReadonlyArray<Job>): Effect.Effect<void, never, never> =>
        Ref.update(stateRef, (m) => {
          const next = new Map<JobId, Job>();
          const touchedIds = new Set(touched.map((j) => j.id));
          for (const job of touched) next.set(job.id, job);
          for (const [k, v] of m) {
            if (!touchedIds.has(k)) next.set(k, v);
          }
          return next;
        });

      const enqueue = (text: string): Effect.Effect<ReadonlyArray<Job>, never, never> =>
        Effect.gen(function* () {
          const urls = extractUrls(text);
          if (urls.length === 0) return [];

          const map = yield* Ref.get(stateRef);
          const byNormalizedUrl = new Map<string, Job>();
          for (const job of map.values()) {
            byNormalizedUrl.set(normalizeUrl(job.url), job);
          }

          const folder = yield* Ref.get(folderRef);
          const newJobs: Job[] = [];
          const movedJobs: Job[] = [];
          const result: Job[] = [];
          const pendingEvents: JobEvent[] = [];
          const queueOffers: JobId[] = [];

          for (const url of urls) {
            const normalized = normalizeUrl(url);
            const existing = byNormalizedUrl.get(normalized);

            if (!existing) {
              const domain = classify(url);
              const id = newId();
              const displayTitle = deriveTitle(url, domain);
              if (domain === "scribd") {
                const job: Job = { id, url, domain, displayTitle, status: "Queued" };
                newJobs.push(job);
                result.push(job);
                byNormalizedUrl.set(normalized, job);
                pendingEvents.push({ _tag: "JobAdded", job });
                queueOffers.push(id);
              } else {
                const failure: JobFailure = { reason: "Unsupported domain", retryable: false };
                const job: Job = { id, url, domain, displayTitle, status: "Failed", failure };
                newJobs.push(job);
                result.push(job);
                byNormalizedUrl.set(normalized, job);
                pendingEvents.push({ _tag: "JobAdded", job });
                pendingEvents.push({ _tag: "JobFailed", id, reason: failure.reason, retryable: failure.retryable });
              }
              continue;
            }

            // duplicate — branch by current status
            let nextJob: Job = existing;
            const fallbackId = scribdIdFromUrl(existing.url) ?? existing.id;

            if (existing.status === "Downloaded") {
              const path = resolvePdfPath({ folder, displayTitle: existing.displayTitle, fallbackId });
              const present = yield* fileExists(path);
              if (!present) {
                const { progress: _drop, failure: _f, ...rest } = existing;
                nextJob = { ...rest, status: "Queued" };
                queueOffers.push(existing.id);
                pendingEvents.push({ _tag: "JobRequeued", id: existing.id });
              }
            } else if (existing.status === "Failed" && existing.failure?.retryable === true) {
              const { progress: _drop, failure: _f, ...rest } = existing;
              nextJob = { ...rest, status: "Queued" };
              queueOffers.push(existing.id);
              pendingEvents.push({ _tag: "JobRequeued", id: existing.id });
            }

            movedJobs.push(nextJob);
            result.push(nextJob);
            byNormalizedUrl.set(normalized, nextJob);
          }

          const touched = [...newJobs, ...movedJobs];
          if (touched.length > 0) {
            yield* prependTouched(touched);
            for (const event of pendingEvents) {
              yield* publish(event);
            }
            yield* publishSnapshot;
            for (const id of queueOffers) {
              yield* Queue.offer(queue, id);
            }
            yield* persistJobs;
          }

          return result;
        });

      const remove = (id: JobId): Effect.Effect<void, JobNotFound | NotRemovable, never> =>
        Effect.gen(function* () {
          const map = yield* Ref.get(stateRef);
          const job = map.get(id);
          if (!job) {
            return yield* Effect.fail(new JobNotFound({ id }));
          }
          if (job.status === "Downloading") {
            return yield* Effect.fail(new NotRemovable({ id, status: job.status }));
          }
          yield* Ref.update(stateRef, (m) => {
            const next = new Map(m);
            next.delete(id);
            return next;
          });
          yield* publish({ _tag: "JobRemoved", id });
          yield* publishSnapshot;
          yield* persistJobs;
        });

      const clearByStatus = (target: Job["status"]): Effect.Effect<number, never, never> =>
        Effect.gen(function* () {
          const map = yield* Ref.get(stateRef);
          const toRemove: JobId[] = [];
          for (const job of map.values()) {
            if (job.status === target) toRemove.push(job.id);
          }
          if (toRemove.length === 0) return 0;
          yield* Ref.update(stateRef, (m) => {
            const next = new Map(m);
            for (const id of toRemove) next.delete(id);
            return next;
          });
          for (const id of toRemove) {
            yield* publish({ _tag: "JobRemoved", id });
          }
          yield* publishSnapshot;
          yield* persistJobs;
          return toRemove.length;
        });

      const clearCompleted = clearByStatus("Downloaded");
      const clearFailed = clearByStatus("Failed");

      const clearAll: Effect.Effect<number, never, never> = Effect.gen(function* () {
        const map = yield* Ref.get(stateRef);
        const ids = Array.from(map.keys());
        if (ids.length === 0) return 0;

        // interrupt active download fiber first; clearing state before interrupt
        // signals the worker's exit path to skip status mutation for that id.
        yield* Ref.set(stateRef, new Map());
        const active = yield* Ref.get(activeFiberRef);
        if (Option.isSome(active)) {
          yield* Fiber.interrupt(active.value.fiber);
          yield* Ref.set(activeFiberRef, Option.none());
        }

        for (const id of ids) {
          yield* publish({ _tag: "JobRemoved", id });
        }
        yield* publishSnapshot;
        yield* persistJobs;
        return ids.length;
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
          yield* publishSnapshot;
          yield* persistJobs;
        });

      const snapshot = currentSnapshot;

      const events: Stream.Stream<JobEvent, never, never> = Stream.fromPubSub(pubsub);

      const updateJob = (id: JobId, f: (j: Job) => Job): Effect.Effect<void, never, never> =>
        Ref.update(stateRef, (m) => {
          const j = m.get(id);
          if (!j) return m;
          const next = new Map(m);
          next.set(id, f(j));
          return next;
        });

      const makeOnEvent =
        (id: JobId): OnEvent =>
        (event) =>
          Effect.gen(function* () {
            if (event._tag === "TitleResolved") {
              yield* updateJob(id, (j) => ({ ...j, displayTitle: event.title }));
              yield* publish({ _tag: "JobTitleUpdated", id, title: event.title });
              yield* persistJobs;
            } else {
              const stage = event._tag === "ScrapeProgress" ? "scrape" : "render";
              const progress: JobProgress = { done: event.done, total: event.total, stage };
              yield* updateJob(id, (j) => ({ ...j, progress }));
              yield* publish({ _tag: "JobProgress", id, done: event.done, total: event.total, stage });
            }
          });

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
          yield* persistJobs;
          const folder = yield* Ref.get(folderRef);
          const fiber = yield* Effect.fork(scribd.execute(current.url, folder, makeOnEvent(id)));
          yield* Ref.set(activeFiberRef, Option.some({ id, fiber }));
          const exit = yield* Fiber.await(fiber);
          yield* Ref.set(activeFiberRef, Option.none());

          // If clearAll removed the job from state mid-flight, skip status update.
          const after = (yield* Ref.get(stateRef)).get(id);
          if (!after) return;

          const { progress: _drop, ...withoutProgress } = after;
          if (Exit.isSuccess(exit)) {
            yield* setJob({ ...withoutProgress, status: "Downloaded" });
            yield* publish({ _tag: "JobCompleted", id });
          } else if (Cause.isInterruptedOnly(exit.cause)) {
            // External interrupt (e.g. clearAll racing); state already adjusted.
            return;
          } else {
            const reason = formatCause(exit.cause);
            const failure: JobFailure = { reason, retryable: true };
            yield* setJob({ ...withoutProgress, status: "Failed", failure });
            yield* publish({ _tag: "JobFailed", id, reason, retryable: true });
          }
          yield* persistJobs;
        }),
      );

      yield* Effect.forkScoped(worker);

      const outputFolder: Effect.Effect<string, never, never> = Ref.get(folderRef);

      const setOutputFolder = (path: string): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const trimmed = path.trim();
          if (trimmed === "") return;
          const expanded = expandHome(trimmed);
          yield* Ref.set(folderRef, expanded);
          yield* publish({ _tag: "OutputFolderChanged", path: expanded });
          yield* persistSettings(expanded);
        });

      return DownloadEngine.of({
        enqueue,
        remove,
        retry,
        clearCompleted,
        clearFailed,
        clearAll,
        snapshot,
        events,
        outputFolder,
        setOutputFolder,
      });
    }),
  );
