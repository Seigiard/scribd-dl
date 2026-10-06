import { Cause, Context, Data, Effect, Result, Exit, Fiber, Layer, Option, Predicate, PubSub, Queue, Ref, Semaphore, Stream } from "effect";
import * as fs from "node:fs/promises";
import type { EngineSnapshot, Job, JobCompression, JobDomain, JobEvent, JobFailure, JobId, JobProgress } from "@scribd-dl/shared";
import { JobNotFound, NotRemovable, NotRetryable } from "../errors/DomainErrors";
import type { ConfigLoader } from "../utils/io/ConfigLoader";
import { expandHome } from "../utils/io/path";
import { PdfGeneratorTag, type PdfGenerator } from "../utils/io/PdfGenerator";
import { resolvePdfPath, scribdIdFromUrl } from "../utils/io/pdfPath";
import { normalizeUrl } from "../utils/url";
import { ConfigStoreTag, type ConfigStore } from "./ConfigStore";
import { JobStoreTag, type JobStore } from "./JobStore";
import { PdfCompressorTag, type PdfCompressor } from "./PdfCompressor";
import { findScraperForUrl, ScrapersTag, type Scrapers, type OnEvent, type Scraper, type ScraperError } from "./Scraper";

const Events = Data.taggedEnum<JobEvent>();

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
  readonly settings: Effect.Effect<SettingsView, never, never>;
  readonly setSettings: (req: { publicKey: string; secretKey: string }) => Effect.Effect<boolean, never, never>;
}

export interface SettingsView {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly valid: boolean | null;
}

interface KeysState {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly valid: boolean;
}

export class DownloadEngine extends Context.Service<DownloadEngine, DownloadEngineService>()("DownloadEngine") {}

export const DownloadEngineTag = DownloadEngine;

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

const classifyWith =
  (scrapers: ReadonlyArray<Scraper>) =>
  (url: string): JobDomain => {
    const match = findScraperForUrl(scrapers, url);

    return match ? match.id : "unsupported";
  };

const deriveTitleWith =
  (scrapers: ReadonlyArray<Scraper>) =>
  (url: string, domain: JobDomain): string => {
    if (domain === "unsupported") {
      return "Unsupported link";
    }

    const scraper = scrapers.find((s) => s.id === domain);

    return scraper ? scraper.deriveDisplayTitle(url) : "Unknown document";
  };

// Non-transient failures: retrying the same URL will reproduce the same error.
// Everything else (network, browser, IO) is treated as transient and retryable.
const isRetryable = (cause: Cause.Cause<ScraperError>): boolean => {
  const failure = Cause.findErrorOption(cause);

  if (Option.isNone(failure)) return true;

  return !Predicate.isTagged(failure.value, "UnsupportedUrl");
};

const formatCause = (cause: Cause.Cause<ScraperError>): string => {
  const failure = Cause.findErrorOption(cause);

  if (Option.isSome(failure)) {
    const err = failure.value;

    if (err.message.length > 0) {
      return `${err._tag}: ${err.message}`;
    }

    const parts: string[] = [];

    if (err._tag) parts.push(err._tag);

    if ("url" in err) parts.push(`url=${err.url}`);

    if ("path" in err) parts.push(`path=${err.path}`);

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

const newId = (): JobId => crypto.randomUUID();

export const DownloadEngineLive: Layer.Layer<
  DownloadEngine,
  never,
  Scrapers | ConfigLoader | ConfigStore | JobStore | PdfCompressor | PdfGenerator
> = Layer.effect(
  DownloadEngine,
  Effect.gen(function* () {
    const scrapers = yield* ScrapersTag;
    const classify = classifyWith(scrapers);
    const deriveTitle = deriveTitleWith(scrapers);
    const configStore = yield* ConfigStoreTag;
    const jobStore = yield* JobStoreTag;
    const pdfCompressor = yield* PdfCompressorTag;
    const pdfGenerator = yield* PdfGeneratorTag;

    const restored = yield* jobStore.read;
    const settings = yield* configStore.read;

    const stateRef = yield* Ref.make(new Map<JobId, Job>(restored.map((j) => [j.id, j])));
    const folderRef = yield* Ref.make(settings.outputFolder);

    const keysRef = yield* Ref.make<KeysState>({
      publicKey: settings.ilovepdfPublicKey,
      secretKey: settings.ilovepdfSecretKey,
      valid: settings.ilovepdfKeysValid,
    });

    const queue = yield* Queue.unbounded<JobId>();
    const pubsub = yield* PubSub.unbounded<JobEvent>();

    type ActiveFiber = {
      readonly id: JobId;
      readonly fiber: Fiber.Fiber<void, never>;
    };

    const activeFiberRef = yield* Ref.make<Option.Option<ActiveFiber>>(Option.none());
    const lifecycleLock = yield* Semaphore.make(1);

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
        .pipe(Effect.catch((cause) => Effect.sync(() => console.warn("[DownloadEngine] failed to persist jobs:", cause))));
    });

    const persistSettings: Effect.Effect<void, never, never> = Effect.gen(function* () {
      const folder = yield* Ref.get(folderRef);
      const keys = yield* Ref.get(keysRef);
      yield* configStore
        .write({
          outputFolder: folder,
          ilovepdfPublicKey: keys.publicKey,
          ilovepdfSecretKey: keys.secretKey,
          ilovepdfKeysValid: keys.valid,
        })
        .pipe(Effect.catch((cause) => Effect.sync(() => console.warn("[DownloadEngine] failed to persist settings:", cause))));
    });

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
      yield* publish(Events.SnapshotReplaced({ snapshot: snap }));
    });

    const fileExists = (path: string): Effect.Effect<boolean, never, never> =>
      Effect.tryPromise({
        try: () => fs.stat(path).then(() => true),
        catch: () => false as const,
      }).pipe(Effect.catch(() => Effect.succeed(false)));

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

            if (domain !== "unsupported") {
              const job: Job = { id, url, domain, displayTitle, status: "Queued" };
              newJobs.push(job);
              result.push(job);
              byNormalizedUrl.set(normalized, job);
              pendingEvents.push(Events.JobAdded({ job }));
              queueOffers.push(id);
            } else {
              const failure: JobFailure = { reason: "Unsupported domain", retryable: false };
              const job: Job = { id, url, domain, displayTitle, status: "Failed", failure };
              newJobs.push(job);
              result.push(job);
              byNormalizedUrl.set(normalized, job);
              pendingEvents.push(Events.JobAdded({ job }));
              pendingEvents.push(
                Events.JobFailed({
                  id,
                  reason: failure.reason,
                  retryable: failure.retryable,
                }),
              );
            }

            continue;
          }

          // duplicate — branch by current status
          let nextJob: Job = existing;
          const fallbackId = scribdIdFromUrl(existing.url) ?? existing.id;

          if (existing.status === "Downloaded") {
            const path = resolvePdfPath({
              folder,
              displayTitle: existing.displayTitle,
              fallbackId,
            });

            const present = yield* fileExists(path);

            if (!present) {
              const { progress: _drop, failure: _f, ...rest } = existing;
              nextJob = { ...rest, status: "Queued" };
              queueOffers.push(existing.id);
              pendingEvents.push(Events.JobRequeued({ id: existing.id }));
            }
          } else if (existing.status === "Failed" && existing.failure?.retryable === true) {
            const { progress: _drop, failure: _f, ...rest } = existing;
            nextJob = { ...rest, status: "Queued" };
            queueOffers.push(existing.id);
            pendingEvents.push(Events.JobRequeued({ id: existing.id }));
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
        yield* publish(Events.JobRemoved({ id }));
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
          yield* publish(Events.JobRemoved({ id }));
        }

        yield* publishSnapshot;
        yield* persistJobs;

        return toRemove.length;
      });

    const clearCompleted = clearByStatus("Downloaded");
    const clearFailed = clearByStatus("Failed");

    const clearAll: Effect.Effect<number, never, never> = Effect.gen(function* () {
      const { ids, active } = yield* lifecycleLock.withPermits(1)(
        Effect.gen(function* () {
          const map = yield* Ref.get(stateRef);
          const ids = Array.from(map.keys());
          // Clear state before interrupt so the job cannot write a terminal status.
          yield* Ref.set(stateRef, new Map());
          const active = yield* Ref.get(activeFiberRef);

          return { ids, active };
        }).pipe(Effect.uninterruptible),
      );

      if (ids.length === 0) return 0;

      if (Option.isSome(active)) {
        yield* Fiber.interrupt(active.value.fiber);
      }

      for (const id of ids) {
        yield* publish(Events.JobRemoved({ id }));
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

        const requeued: Job = {
          id: job.id,
          url: job.url,
          domain: job.domain,
          displayTitle: job.displayTitle,
          status: "Queued",
        };

        yield* setJob(requeued);
        yield* Queue.offer(queue, id);
        yield* publish(Events.JobRequeued({ id }));
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
          if (Predicate.isTagged(event, "TitleResolved")) {
            yield* updateJob(id, (j) => ({ ...j, displayTitle: event.title }));
            yield* publish(Events.JobTitleUpdated({ id, title: event.title }));
            yield* persistJobs;
          } else {
            const stage = Predicate.isTagged(event, "ScrapeProgress") ? "scrape" : "render";
            const progress: JobProgress = { done: event.done, total: event.total, stage };
            yield* updateJob(id, (j) => ({ ...j, progress }));
            yield* publish(
              Events.JobProgress({
                id,
                done: event.done,
                total: event.total,
                stage,
              }),
            );
          }
        });

    // Best-effort in-place compression of a freshly-downloaded PDF (KTD1/KTD3/KTD9).
    // Returns the resulting compression state to stamp on the terminal Downloaded job,
    // or undefined on success / when compression is skipped. Never fails the worker.
    const compressJob = (id: JobId, job: Job, folder: string): Effect.Effect<JobCompression | undefined, never, never> =>
      Effect.gen(function* () {
        const keys = yield* Ref.get(keysRef);
        const eligible = keys.publicKey !== "" && keys.secretKey !== "" && keys.valid;

        if (!eligible) return undefined;

        const pdfPath = resolvePdfPath({
          folder,
          displayTitle: job.displayTitle,
          fallbackId: scribdIdFromUrl(job.url) ?? job.id,
        });

        const present = yield* fileExists(pdfPath);

        if (!present) {
          // The recompute diverged from the scraper's actual output path (KTD1 guard):
          // don't call the API on a missing file.
          return { status: "failed", reason: "output file not found" };
        }

        yield* updateJob(id, (j) => {
          const { compression: _drop, ...rest } = j;

          return { ...rest, compression: { status: "compressing" } };
        });
        yield* publish(Events.JobCompressing({ id }));
        yield* publishSnapshot;

        const result = yield* Effect.result(pdfCompressor.compress(pdfPath, { publicKey: keys.publicKey, secretKey: keys.secretKey }));

        if (Result.isFailure(result)) {
          const reason = result.failure.reason;
          yield* publish(Events.JobCompressionFailed({ id, reason }));

          if (reason === "invalid credentials") {
            // Runtime 401 invalidates only the pair used by this request (KTD9).
            const invalidated = yield* Ref.modify(keysRef, (current): [boolean, KeysState] => {
              if (current.publicKey !== keys.publicKey || current.secretKey !== keys.secretKey || !current.valid) {
                return [false, current];
              }

              return [true, { ...current, valid: false }];
            });

            if (invalidated) yield* persistSettings;
          }

          return { status: "failed", reason };
        }

        return undefined;
      });

    // Chrome's print-to-PDF stamps the page <title> ("Scribd") as the document Title, and
    // neither the pdf-lib merge nor the compression pass overwrites it. Restamp the final
    // file (post-compression, so it wins regardless of what compression wrote) with the
    // resolved title that the filename is derived from. Best-effort: a stamp failure never
    // blocks the job from reaching Downloaded.
    const stampTitle = (job: Job, folder: string): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const pdfPath = resolvePdfPath({
          folder,
          displayTitle: job.displayTitle,
          fallbackId: scribdIdFromUrl(job.url) ?? job.id,
        });

        const present = yield* fileExists(pdfPath);

        if (!present) return;
        yield* pdfGenerator
          .setTitle(pdfPath, job.displayTitle)
          .pipe(Effect.catch((e) => Effect.sync(() => console.warn(`[title] metadata stamp failed for ${pdfPath}:`, e.cause))));
      });

    const runJob = (current: Job, folder: string): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const id = current.id;
        yield* publish(Events.JobStarted({ id }));
        yield* persistJobs;
        const scraper = scrapers.find((s) => s.id === current.domain);

        if (!scraper) {
          // Domain was supported at enqueue time but the registry no longer carries it —
          // typically a persisted job from a previous engine build. Retryable so a
          // restoring the original registry allows the user to retry the failed job.
          const failure: JobFailure = {
            reason: `No scraper registered for domain '${current.domain}'`,
            retryable: true,
          };

          yield* updateJob(id, (job) => ({ ...job, status: "Failed", failure }));
          yield* publish(
            Events.JobFailed({
              id,
              reason: failure.reason,
              retryable: failure.retryable,
            }),
          );
          yield* persistJobs;

          return;
        }

        const exit = yield* Effect.exit(scraper.execute(current.url, folder, makeOnEvent(id)));

        // If clearAll removed the job from state mid-flight, skip status update.
        const after = (yield* Ref.get(stateRef)).get(id);

        if (!after) return;

        const { progress: _drop, ...withoutProgress } = after;

        if (Exit.isSuccess(exit)) {
          const compression = yield* compressJob(id, after, folder);
          yield* stampTitle(after, folder);
          // Compression is async — the job may have been cleared mid-compress. If so,
          // don't resurrect it.
          const stillPresent = (yield* Ref.get(stateRef)).get(id);

          if (!stillPresent) return;
          yield* updateJob(id, (j) => {
            const { progress: _p, compression: _c, ...rest } = j;

            const downloaded: Job = { ...rest, status: "Downloaded" };

            return compression ? { ...downloaded, compression } : downloaded;
          });
          yield* publish(Events.JobCompleted({ id }));
        } else if (Cause.hasInterruptsOnly(exit.cause)) {
          // External interrupt (e.g. clearAll racing); state already adjusted.
          return;
        } else {
          const reason = formatCause(exit.cause);
          const retryable = isRetryable(exit.cause);
          const failure: JobFailure = { reason, retryable };
          yield* updateJob(id, () => ({ ...withoutProgress, status: "Failed", failure }));
          yield* publish(Events.JobFailed({ id, reason, retryable }));
        }

        yield* persistJobs;
      });

    const worker = Effect.forever(
      Effect.gen(function* () {
        const id = yield* Queue.take(queue);

        const active = yield* lifecycleLock.withPermits(1)(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const current = (yield* Ref.get(stateRef)).get(id);

              if (!current || current.status !== "Queued") return Option.none<ActiveFiber>();

              yield* updateJob(id, (job) => ({ ...job, status: "Downloading" }));
              const folder = yield* Ref.get(folderRef);
              const fiber = yield* Effect.forkChild(restore(runJob(current, folder)));
              const active: ActiveFiber = { id, fiber };
              yield* Ref.set(activeFiberRef, Option.some(active));

              return Option.some(active);
            }),
          ),
        );

        if (Option.isNone(active)) return;

        yield* Fiber.await(active.value.fiber).pipe(
          Effect.ensuring(
            Ref.update(activeFiberRef, (registered) =>
              Option.isSome(registered) && registered.value.fiber === active.value.fiber ? Option.none() : registered,
            ),
          ),
        );
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
        yield* publish(Events.OutputFolderChanged({ path: expanded }));
        yield* persistSettings;
      });

    const settingsView: Effect.Effect<SettingsView, never, never> = Ref.get(keysRef).pipe(
      Effect.map((keys) => ({
        publicKey: keys.publicKey,
        secretKey: keys.secretKey,
        valid: keys.publicKey === "" && keys.secretKey === "" ? null : keys.valid,
      })),
    );

    const setSettings = (req: { publicKey: string; secretKey: string }): Effect.Effect<boolean, never, never> =>
      Effect.gen(function* () {
        const publicKey = req.publicKey.trim();
        const secretKey = req.secretKey.trim();
        const bothFilled = publicKey !== "" && secretKey !== "";
        // Both-empty is a valid clear; exactly-one-filled is incomplete. Neither probes
        // the API — only a complete pair is validated (U5, KTD9).
        const valid = bothFilled ? yield* pdfCompressor.validate({ publicKey, secretKey }) : false;
        yield* Ref.set(keysRef, { publicKey, secretKey, valid });
        yield* persistSettings;

        return valid;
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
      settings: settingsView,
      setSettings,
    });
  }),
);
