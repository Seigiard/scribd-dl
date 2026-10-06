import { beforeEach, describe, expect, mock, test, type Mock } from "bun:test";
import {
  Cause,
  Chunk,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Schema,
  Stream,
} from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import ILovePDFFile from "@ilovepdf/ilovepdf-nodejs/ILovePDFFile";
import type { EngineSnapshot, Job, JobEvent } from "@scribd-dl/shared";
import { ConfigStore, type ConfigStoreService, type Settings } from "../src/service/ConfigStore";
import { DownloadEngine, DownloadEngineLive } from "../src/service/DownloadEngine";
import { JobStore, type JobStoreService } from "../src/service/JobStore";
import {
  makePdfCompressor,
  PdfCompressor,
  type PdfCompressorService,
} from "../src/service/PdfCompressor";
import { Scrapers, ScraperEvent, type OnEvent, type Scraper } from "../src/service/Scraper";
import { ConfigLoader, type ConfigData } from "../src/utils/io/ConfigLoader";
import { PdfGenerator, type PdfGeneratorService } from "../src/utils/io/PdfGenerator";
import {
  CompressionFailed,
  PageLoadFailed,
  PdfMetadataFailed,
  PersistenceFailed,
  UnsupportedUrl,
} from "../src/errors/DomainErrors";

const emptySettings: Settings = {
  outputFolder: "/tmp/out",
  ilovepdfPublicKey: "",
  ilovepdfSecretKey: "",
  ilovepdfKeysValid: false,
};

interface MockState {
  scribdExecute: Mock<Scraper["execute"]>;
  jobStoreWrite: Mock<JobStoreService["write"]>;
  configStoreWrite: Mock<ConfigStoreService["write"]>;
  compressCompress: Mock<PdfCompressorService["compress"]>;
  compressValidate: Mock<PdfCompressorService["validate"]>;
  pdfSetTitle: Mock<PdfGeneratorService["setTitle"]>;
  restoredJobs: ReadonlyArray<Job>;
  initialSettings: Settings;
}

const state: MockState = {
  scribdExecute: mock(),
  jobStoreWrite: mock(),
  configStoreWrite: mock(),
  compressCompress: mock(),
  compressValidate: mock(),
  pdfSetTitle: mock(),
  restoredJobs: [],
  initialSettings: emptySettings,
};

const resetState = () => {
  state.scribdExecute = mock(() => Effect.void);
  state.jobStoreWrite = mock(() => Effect.void);
  state.configStoreWrite = mock(() => Effect.void);
  state.compressCompress = mock(() => Effect.void);
  state.compressValidate = mock(() => Effect.succeed(true));
  state.pdfSetTitle = mock(() => Effect.void);
  state.restoredJobs = [];
  state.initialSettings = emptySettings;
};

const defaultConfig: ConfigData = {
  scribd: { rendertime: 100 },
  directory: { output: "/tmp/out", filename: "title" },
};

const buildLayer = (
  config: ConfigData = defaultConfig,
  extraScrapers: ReadonlyArray<Scraper> = [],
  compressorLayer: Layer.Layer<PdfCompressor> | undefined = undefined,
) => {
  const scribdScraper: Scraper = {
    id: "scribd",
    canHandle: (url) => /scribd\.com/.test(url),
    deriveDisplayTitle: (url) => {
      const doc = /scribd\.com\/document\/(\d+)/.exec(url);

      if (doc) return `Scribd document ${doc[1]}`;
      const embed = /scribd\.com\/embeds\/(\d+)/.exec(url);

      if (embed) return `Scribd document ${embed[1]}`;

      return "Scribd document";
    },
    execute: (url, folder, onEvent, debug) => state.scribdExecute(url, folder, onEvent, debug),
  };

  const configStoreSvc: ConfigStoreService = {
    read: Effect.sync(() => state.initialSettings),
    write: (s) => state.configStoreWrite(s),
  };

  const jobStoreSvc: JobStoreService = {
    read: Effect.sync(() => state.restoredJobs),
    write: (jobs) => state.jobStoreWrite(jobs),
  };

  const pdfCompressorSvc: PdfCompressorService = {
    compress: (pdfPath, keys) => state.compressCompress(pdfPath, keys),
    validate: (keys) => state.compressValidate(keys),
  };

  const pdfGeneratorSvc: PdfGeneratorService = {
    merge: () => Effect.void,
    setTitle: (pdfPath, title) => state.pdfSetTitle(pdfPath, title),
  };

  return Layer.provide(
    DownloadEngineLive,
    Layer.mergeAll(
      Layer.succeed(Scrapers, [scribdScraper, ...extraScrapers]),
      Layer.succeed(ConfigLoader, config),
      Layer.succeed(ConfigStore, configStoreSvc),
      Layer.succeed(JobStore, jobStoreSvc),
      compressorLayer ?? Layer.succeed(PdfCompressor, pdfCompressorSvc),
      Layer.succeed(PdfGenerator, pdfGeneratorSvc),
    ),
  );
};

const makeCustomScraper = (customExecute: Mock<Scraper["execute"]>): Scraper => ({
  // @ts-expect-error custom id outside current JobDomain union for test purposes
  id: "custom",
  canHandle: (url) => url.includes("example.com"),
  deriveDisplayTitle: (url) => `Custom ${url}`,
  execute: (url, folder, onEvent, debug) => customExecute(url, folder, onEvent, debug),
});

const runScoped = <A, E>(program: Effect.Effect<A, E, DownloadEngine>) =>
  Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(buildLayer()))));

const runScopedExit = <A, E>(program: Effect.Effect<A, E, DownloadEngine>) =>
  Effect.runPromiseExit(Effect.scoped(program.pipe(Effect.provide(buildLayer()))));

const waitForQuiet = (engine: ReturnType<typeof DownloadEngine.of>) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      const snap = yield* engine.snapshot;
      const pending = snap.jobs.filter((j) => j.status === "Queued" || j.status === "Downloading");

      if (pending.length === 0) {
        return snap;
      }

      yield* Effect.sleep("5 millis");
    }

    return yield* engine.snapshot;
  });

const firstFailureTag = (exit: Exit.Exit<unknown, unknown>): string | undefined => {
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);

    if (Option.isSome(failure)) {
      return Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.String }))(failure.value)._tag;
    }
  }

  return undefined;
};

describe("DownloadEngine", () => {
  beforeEach(() => {
    resetState();
  });

  describe("enqueue: URL extraction and classification", () => {
    test("single scribd URL → one Queued Job", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);
      const url = "https://www.scribd.com/document/123/foo";

      // #when
      const snap: EngineSnapshot = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const created = yield* engine.enqueue(url);
          expect(created).toHaveLength(1);
          expect(created[0]!.status).toBe("Queued");
          expect(created[0]!.url).toBe(url);
          expect(created[0]!.domain).toBe("scribd");

          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs).toHaveLength(1);
      expect(snap.jobs[0]!.url).toBe(url);
    });

    test("paste-blob with multiple URLs, comments, garbage → URLs extracted in order", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      const text = [
        "# comment line",
        "  https://www.scribd.com/document/1/a  ",
        "random non-link text",
        "https://www.scribd.com/document/2/b extra trailing",
        "",
        "- https://www.scribd.com/document/3/c",
      ].join("\n");

      // #when
      const created = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.enqueue(text);
        }),
      );

      // #then
      expect(created.map((j) => j.url)).toEqual([
        "https://www.scribd.com/document/1/a",
        "https://www.scribd.com/document/2/b",
        "https://www.scribd.com/document/3/c",
      ]);
    });

    test("unsupported URL → Failed Job with retryable: false", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const created = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.enqueue("https://example.com/foo");
        }),
      );

      // #then
      expect(created).toHaveLength(1);
      expect(created[0]!.status).toBe("Failed");
      expect(created[0]!.failure?.reason).toBe("Unsupported domain");
      expect(created[0]!.failure?.retryable).toBe(false);
      expect(state.scribdExecute).not.toHaveBeenCalled();
    });

    test("mixed scribd + unsupported → both created, only scribd queued for worker", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      const text =
        "https://www.scribd.com/document/1/a\nhttps://example.com/foo\nhttps://www.scribd.com/document/2/b";

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue(text);

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(snap.jobs).toHaveLength(3);
      expect(snap.jobs[0]!.status).toBe("Downloaded");
      expect(snap.jobs[1]!.status).toBe("Failed");
      expect(snap.jobs[1]!.failure?.reason).toBe("Unsupported domain");
      expect(snap.jobs[2]!.status).toBe("Downloaded");
      expect(state.scribdExecute).toHaveBeenCalledTimes(2);
    });

    test("empty / comments-only text → returns empty, snapshot empty", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const created = yield* engine.enqueue("\n\n# only comments\n   \n");
          const snap = yield* engine.snapshot;

          return { created, snap };
        }),
      );

      // #then
      expect(result.created).toHaveLength(0);
      expect(result.snap.jobs).toHaveLength(0);
    });

    test("displayTitle derived from document URL", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const created = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.enqueue("https://www.scribd.com/document/123/foo");
        }),
      );

      // #then
      expect(created[0]!.displayTitle).toBe("Scribd document 123");
    });

    test("displayTitle for unsupported URL", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const created = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.enqueue("https://example.com/foo");
        }),
      );

      // #then
      expect(created[0]!.displayTitle).toBe("Unsupported link");
    });
  });

  describe("worker behavior", () => {
    test("scribd URL drives through Queued → Downloading → Downloaded", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);
      const url = "https://www.scribd.com/document/1/a";

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue(url);

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(snap.jobs[0]!.status).toBe("Downloaded");
      expect(state.scribdExecute).toHaveBeenCalledTimes(1);
      expect(state.scribdExecute).toHaveBeenCalledWith(
        url,
        "/tmp/out",
        expect.any(Function),
        undefined,
      );
    });

    test("ScribdDownloader failure → Failed with retryable: true", async () => {
      // #given
      state.scribdExecute = mock((url: string) =>
        Effect.fail(new PageLoadFailed({ url, cause: "boom" })),
      );

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      const job = snap.jobs[0]!;
      expect(job.status).toBe("Failed");
      expect(job.failure?.retryable).toBe(true);
      expect(job.failure?.reason).toContain("PageLoadFailed");
    });

    test("jobs processed strictly sequentially (concurrency = 1)", async () => {
      // #given
      const observations: string[] = [];
      state.scribdExecute = mock((url: string) =>
        Effect.gen(function* () {
          observations.push(`start:${url}`);
          yield* Effect.sleep("20 millis");
          observations.push(`end:${url}`);
        }),
      );

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue(
            "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b",
          );
          yield* waitForQuiet(engine);
        }),
      );

      // #then — order must be start:1, end:1, start:2, end:2 (no overlap)
      expect(observations).toEqual([
        "start:https://www.scribd.com/document/1/a",
        "end:https://www.scribd.com/document/1/a",
        "start:https://www.scribd.com/document/2/b",
        "end:https://www.scribd.com/document/2/b",
      ]);
    });
  });

  describe("remove", () => {
    test("removes Queued job, snapshot no longer contains it", async () => {
      // #given — block worker by never-resolving scribd to leave second job Queued
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const created = yield* engine.enqueue(
            "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b",
          );

          yield* engine.remove(created[1]!.id);

          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs).toHaveLength(1);
      expect(snap.jobs[0]!.url).toBe("https://www.scribd.com/document/1/a");
    });

    test("remove on Downloaded succeeds", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* waitForQuiet(engine);
          yield* engine.remove(job!.id);

          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs).toHaveLength(0);
    });

    test("remove on Failed succeeds", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://example.com/foo");
          yield* engine.remove(job!.id);

          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs).toHaveLength(0);
    });

    test("remove on Downloading fails NotRemovable", async () => {
      // #given — never-resolving scribd keeps job in Downloading
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const exit = await runScopedExit(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://www.scribd.com/document/1/a");

          // wait until the job transitions to Downloading
          for (let i = 0; i < 100; i++) {
            const snap = yield* engine.snapshot;

            if (snap.jobs[0]?.status === "Downloading") break;
            yield* Effect.sleep("5 millis");
          }

          yield* engine.remove(job!.id);
        }),
      );

      // #then
      expect(firstFailureTag(exit)).toBe("NotRemovable");
    });

    test("remove on unknown id fails JobNotFound", async () => {
      // #when
      const exit = await runScopedExit(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.remove("nonexistent");
        }),
      );

      // #then
      expect(firstFailureTag(exit)).toBe("JobNotFound");
    });

    test("removed Queued job is skipped by worker (lazy invalidation)", async () => {
      // #given — first job blocks worker until a Deferred resolves; second remove-while-queued
      let firstCalled = false;
      let secondCalled = false;
      state.scribdExecute = mock((url: string) =>
        Effect.gen(function* () {
          if (url.includes("/1/")) {
            firstCalled = true;
            yield* Effect.sleep("30 millis");
          } else {
            secondCalled = true;
          }
        }),
      );

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const created = yield* engine.enqueue(
            "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b",
          );

          // wait until first is Downloading
          yield* Effect.sleep("10 millis");
          yield* engine.remove(created[1]!.id);
          yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(firstCalled).toBe(true);
      expect(secondCalled).toBe(false);
    });
  });

  describe("clear", () => {
    test("clearCompleted removes only Downloaded jobs and returns count", async () => {
      // #given
      let calls = 0;
      state.scribdExecute = mock((url: string) => {
        calls += 1;

        if (url.includes("/2/")) return Effect.fail(new PageLoadFailed({ url, cause: "x" }));

        return Effect.never; // /1/ stays Downloading
      });

      // Enqueue: /1/ blocks (Downloading), /2/ fails, plus an unsupported (immediately Failed)
      const text =
        "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b\nhttps://example.com/foo";

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue(text);

          // wait for /2/ to fail (one downloader call started)
          for (let i = 0; i < 100 && calls < 2; i++) yield* Effect.sleep("5 millis");
          // also wait a bit longer to ensure /1/ has transitioned to Downloading
          yield* Effect.sleep("10 millis");
          // make one job Downloaded by injecting via enqueue + waitForQuiet pattern: simpler — fake it
          // Instead: precreate a Downloaded via restoredJobs
          // (skip — we'll cover that path in HTTP test)
          const removed = yield* engine.clearCompleted;
          const snap = yield* engine.snapshot;

          return { removed, snap };
        }),
      );

      // #then — no Downloaded jobs in this scenario
      expect(result.removed).toBe(0);
    });

    test("clearCompleted removes restored Downloaded jobs", async () => {
      // #given — restore three jobs of different statuses
      state.scribdExecute = mock(() => Effect.never);
      state.restoredJobs = [
        {
          id: "a",
          url: "https://www.scribd.com/document/1/x",
          domain: "scribd",
          displayTitle: "1",
          status: "Queued",
        },
        {
          id: "b",
          url: "https://www.scribd.com/document/2/y",
          domain: "scribd",
          displayTitle: "2",
          status: "Downloaded",
        },
        {
          id: "c",
          url: "https://www.scribd.com/document/3/z",
          domain: "scribd",
          displayTitle: "3",
          status: "Downloaded",
        },
        {
          id: "d",
          url: "https://www.scribd.com/document/4/w",
          domain: "scribd",
          displayTitle: "4",
          status: "Failed",
          failure: { reason: "x", retryable: true },
        },
      ];

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const removed = yield* engine.clearCompleted;
          const snap = yield* engine.snapshot;

          return { removed, snap };
        }),
      );

      // #then
      expect(result.removed).toBe(2);
      const remaining = result.snap.jobs.map((j) => j.id);
      expect(remaining).not.toContain("b");
      expect(remaining).not.toContain("c");
      expect(remaining).toContain("a");
      expect(remaining).toContain("d");
    });

    test("clearFailed removes restored Failed jobs", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);
      state.restoredJobs = [
        {
          id: "a",
          url: "https://www.scribd.com/document/1/x",
          domain: "scribd",
          displayTitle: "1",
          status: "Queued",
        },
        {
          id: "b",
          url: "https://www.scribd.com/document/2/y",
          domain: "scribd",
          displayTitle: "2",
          status: "Downloaded",
        },
        {
          id: "c",
          url: "https://www.scribd.com/document/3/z",
          domain: "scribd",
          displayTitle: "3",
          status: "Failed",
          failure: { reason: "x", retryable: true },
        },
      ];

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const removed = yield* engine.clearFailed;
          const snap = yield* engine.snapshot;

          return { removed, snap };
        }),
      );

      // #then
      expect(result.removed).toBe(1);
      expect(result.snap.jobs.map((j) => j.id)).not.toContain("c");
    });

    test("clearCompleted publishes JobRemoved per removed job", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);
      state.restoredJobs = [
        {
          id: "a",
          url: "https://www.scribd.com/document/1/x",
          domain: "scribd",
          displayTitle: "1",
          status: "Downloaded",
        },
        {
          id: "b",
          url: "https://www.scribd.com/document/2/y",
          domain: "scribd",
          displayTitle: "2",
          status: "Downloaded",
        },
      ];

      // #when
      const tags = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const collector = yield* engine.events.pipe(
            Stream.take(2),
            Stream.runCollect,
            Effect.fork,
          );

          yield* Effect.sleep("10 millis");
          yield* engine.clearCompleted;
          const chunk = yield* collector;

          return Chunk.toReadonlyArray(chunk).map((e: JobEvent) => e._tag);
        }),
      );

      // #then
      expect(tags).toEqual(["JobRemoved", "JobRemoved"]);
    });

    test("clearAll on empty queue returns 0", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const removed = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.clearAll;
        }),
      );

      // #then
      expect(removed).toBe(0);
    });

    test("clearAll on Queued-only queue removes all and returns count", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue(
            "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b\nhttps://www.scribd.com/document/3/c",
          );
          const removed = yield* engine.clearAll;
          const snap = yield* engine.snapshot;

          return { removed, snap };
        }),
      );

      // #then
      expect(result.removed).toBe(3);
      expect(result.snap.jobs).toHaveLength(0);
    });

    test("clearAll with mixed statuses removes all", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);
      state.restoredJobs = [
        {
          id: "a",
          url: "https://www.scribd.com/document/1/x",
          domain: "scribd",
          displayTitle: "1",
          status: "Queued",
        },
        {
          id: "b",
          url: "https://www.scribd.com/document/2/y",
          domain: "scribd",
          displayTitle: "2",
          status: "Downloaded",
        },
        {
          id: "c",
          url: "https://www.scribd.com/document/3/z",
          domain: "scribd",
          displayTitle: "3",
          status: "Failed",
          failure: { reason: "x", retryable: true },
        },
      ];

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const removed = yield* engine.clearAll;
          const snap = yield* engine.snapshot;

          return { removed, snap };
        }),
      );

      // #then
      expect(result.removed).toBe(3);
      expect(result.snap.jobs).toHaveLength(0);
    });

    test("clearAll interrupts active Downloading and prevents Failed status from being written", async () => {
      // #given — execute hangs until interrupted
      const started = Effect.runSync(Deferred.make<void>());
      let interrupted = false;
      state.scribdExecute = mock((url) =>
        url.includes("/1/")
          ? Deferred.succeed(started, undefined).pipe(
              Effect.zipRight(Effect.never),
              Effect.onInterrupt(() =>
                Effect.sleep("5 millis").pipe(
                  Effect.zipRight(
                    Effect.sync(() => {
                      interrupted = true;
                    }),
                  ),
                ),
              ),
            )
          : Effect.void,
      );

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/active");

          yield* Deferred.await(started).pipe(Effect.timeout("1 second"));

          const removed = yield* engine.clearAll;
          // #then — cancellation must finish before clearAll returns, not at scope cleanup.
          expect(interrupted).toBe(true);
          const snap = yield* engine.snapshot;
          yield* engine.enqueue("https://www.scribd.com/document/2/next");
          const next = yield* waitForQuiet(engine);
          expect(next.jobs.map((job) => ({ url: job.url, status: job.status }))).toEqual([
            { url: "https://www.scribd.com/document/2/next", status: "Downloaded" },
          ]);

          return { removed, snap };
        }),
      );

      // #then — job removed, no zombie Failed status written
      expect(result.removed).toBe(1);
      expect(result.snap.jobs).toHaveLength(0);
    });

    test("clearAll cancels hanging compression before returning and the next download completes", async () => {
      // #given
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "engine-clear-compression-"));
      const started = Effect.runSync(Deferred.make<void>());
      let interrupted = false;
      state.initialSettings = {
        outputFolder: tmp,
        ilovepdfPublicKey: "public",
        ilovepdfSecretKey: "secret",
        ilovepdfKeysValid: true,
      };
      state.compressCompress = mock(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.zipRight(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sleep("5 millis").pipe(
              Effect.zipRight(
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
          ),
        ),
      );

      try {
        await fs.writeFile(path.join(tmp, "Scribd document 1.pdf"), "fake-pdf");
        // #when
        await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/active");
            yield* Deferred.await(started).pipe(Effect.timeout("1 second"));
            const removed = yield* engine.clearAll;

            // #then — inspect while the engine scope is still open.
            expect(interrupted).toBe(true);
            expect(removed).toBe(1);
            expect((yield* engine.snapshot).jobs).toEqual([]);
            expect(state.pdfSetTitle).not.toHaveBeenCalled();
            yield* engine.enqueue("https://www.scribd.com/document/2/next");
            const next = yield* waitForQuiet(engine);
            expect(next.jobs.map((job) => ({ url: job.url, status: job.status }))).toEqual([
              { url: "https://www.scribd.com/document/2/next", status: "Downloaded" },
            ]);
          }),
        );
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("clearAll with a real compressor prevents a late download overwriting the next job at the same path", async () => {
      // #given
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "engine-real-compressor-"));
      const target = path.join(tmp, "Scribd document 1.pdf");
      await fs.writeFile(target, "%PDF-original");
      state.initialSettings = {
        outputFolder: tmp,
        ilovepdfPublicKey: "public",
        ilovepdfSecretKey: "secret",
        ilovepdfKeysValid: true,
      };
      const entered = Promise.withResolvers<void>();
      const response = Promise.withResolvers<Uint8Array>();
      let tasks = 0;

      const compressor = makePdfCompressor(
        () => ({
          newTask: () => {
            const first = tasks++ === 0;

            return {
              start: async () => {},
              addFile: async () => {},
              process: async () => {},
              download: async () => {
                if (first) {
                  entered.resolve();

                  return await response.promise;
                }

                return new TextEncoder().encode("%PDF-new-job");
              },
            };
          },
        }),
        (absolutePath) => new ILovePDFFile(absolutePath),
      );

      try {
        // #when
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* DownloadEngine;
              yield* engine.enqueue("https://www.scribd.com/document/1/same");
              yield* Effect.promise(() => entered.promise);
              yield* engine.clearAll;
              yield* engine.enqueue("https://www.scribd.com/document/1/same");
              const next = yield* waitForQuiet(engine);
              expect(next.jobs.map((job) => job.status)).toEqual(["Downloaded"]);
              response.resolve(new TextEncoder().encode("%PDF-old-job"));
              yield* Effect.sleep("50 millis");

              // #then
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("%PDF-new-job");
            }).pipe(Effect.provide(buildLayer(defaultConfig, [], compressor))),
          ),
        );
      } finally {
        response.resolve(new TextEncoder().encode("%PDF-old-job"));
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("clearAll followed by enqueue keeps the worker functional", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* engine.clearAll;
          yield* engine.enqueue("https://www.scribd.com/document/2/b");
          yield* waitForQuiet(engine);

          return yield* engine.snapshot;
        }),
      );

      // #then — second enqueue progressed to Downloaded normally
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0]!.status).toBe("Downloaded");
    });
  });

  describe("retry", () => {
    test("retry on retryable Failed → status Queued, worker picks up", async () => {
      // #given
      let attempt = 0;
      state.scribdExecute = mock((_url: string) => {
        attempt += 1;

        return attempt === 1
          ? Effect.fail(new PageLoadFailed({ url: _url, cause: "first" }))
          : Effect.void;
      });

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* waitForQuiet(engine);
          yield* engine.retry(job!.id);

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(snap.jobs[0]!.status).toBe("Downloaded");
      expect(attempt).toBe(2);
    });

    test("retry on non-retryable Failed (unsupported) fails NotRetryable", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const exit = await runScopedExit(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://example.com/foo");
          yield* engine.retry(job!.id);
        }),
      );

      // #then
      expect(firstFailureTag(exit)).toBe("NotRetryable");
    });

    test("retry on Downloaded fails NotRetryable", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const exit = await runScopedExit(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* waitForQuiet(engine);
          yield* engine.retry(job!.id);
        }),
      );

      // #then
      expect(firstFailureTag(exit)).toBe("NotRetryable");
    });

    test("retry on unknown id fails JobNotFound", async () => {
      // #when
      const exit = await runScopedExit(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.retry("nonexistent");
        }),
      );

      // #then
      expect(firstFailureTag(exit)).toBe("JobNotFound");
    });
  });

  describe("enqueue: dedup", () => {
    test("same URL twice in one paste → same Job referenced twice, snapshot has 1", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);
      const url = "https://www.scribd.com/document/1/a";

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const created = yield* engine.enqueue(`${url}\n${url}`);
          const snap = yield* engine.snapshot;

          return { created, snap };
        }),
      );

      // #then
      expect(result.created).toHaveLength(2);
      expect(result.created[0]!.id).toBe(result.created[1]!.id);
      expect(result.snap.jobs).toHaveLength(1);
    });

    test("re-enqueue after Downloaded with file present → same id, no re-download", async () => {
      // #given — real tmp folder + pre-created PDF at the path resolvePdfPath would produce
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "engine-dedup-"));
      state.initialSettings = { ...emptySettings, outputFolder: tmp };
      state.scribdExecute = mock(() => Effect.void);
      const url = "https://www.scribd.com/document/1/a";

      try {
        // #when
        const result = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            const [first] = yield* engine.enqueue(url);
            yield* waitForQuiet(engine);
            // displayTitle defaults to "Scribd document 1" → sanitize keeps it
            const expectedPath = path.join(tmp, "Scribd document 1.pdf");
            yield* Effect.promise(() => fs.writeFile(expectedPath, "fake-pdf"));
            const second = yield* engine.enqueue(url);
            yield* waitForQuiet(engine);

            return { first, second, snap: yield* engine.snapshot };
          }),
        );

        // #then — file present, no second download triggered
        expect(result.second[0]!.id).toBe(result.first!.id);
        expect(result.snap.jobs).toHaveLength(1);
        expect(state.scribdExecute).toHaveBeenCalledTimes(1);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("re-enqueue after Downloaded with missing file → same id reused, re-queued for re-download", async () => {
      // #given — mock execute succeeds but writes nothing, so file-existence check fails
      state.scribdExecute = mock(() => Effect.void);
      const url = "https://www.scribd.com/document/1/a";

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [first] = yield* engine.enqueue(url);
          yield* waitForQuiet(engine);
          const second = yield* engine.enqueue(url);
          yield* waitForQuiet(engine);

          return { first, second, snap: yield* engine.snapshot };
        }),
      );

      // #then — same id, second download triggered because file missing
      expect(result.second).toHaveLength(1);
      expect(result.second[0]!.id).toBe(result.first!.id);
      expect(result.snap.jobs).toHaveLength(1);
      expect(state.scribdExecute).toHaveBeenCalledTimes(2);
    });

    test("re-enqueue after Failed retryable=true → same id, implicit retry", async () => {
      // #given
      state.scribdExecute = mock((u: string) =>
        Effect.fail(new PageLoadFailed({ url: u, cause: "boom" })),
      );
      const url = "https://www.scribd.com/document/1/a";

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [first] = yield* engine.enqueue(url);
          yield* waitForQuiet(engine);
          const [second] = yield* engine.enqueue(url);
          yield* waitForQuiet(engine);

          return { first, second };
        }),
      );

      // #then — implicit retry keeps the same job id
      expect(result.second!.id).toBe(result.first!.id);
      expect(state.scribdExecute).toHaveBeenCalledTimes(2);
    });

    test("re-enqueue after Remove → new Job", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);
      const url = "https://www.scribd.com/document/1/a";

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [first] = yield* engine.enqueue(url);
          yield* engine.remove(first!.id);
          const [second] = yield* engine.enqueue(url);

          return { first, second };
        }),
      );

      // #then
      expect(result.second!.id).not.toBe(result.first!.id);
    });

    test("enqueue while Queued → existing Job returned, no double download", async () => {
      // #given — never-resolves keeps the worker on first job, second remains Queued
      state.scribdExecute = mock(() => Effect.never);
      const url1 = "https://www.scribd.com/document/1/a";
      const url2 = "https://www.scribd.com/document/2/b";

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const first = yield* engine.enqueue(`${url1}\n${url2}`);
          const second = yield* engine.enqueue(url2);

          return { first, second };
        }),
      );

      // #then
      expect(result.second).toHaveLength(1);
      expect(result.second[0]!.id).toBe(result.first[1]!.id);
    });

    test("normalized URL dedup: trailing slash and case treated as same job", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* engine.enqueue("https://WWW.scribd.com/document/1/a/");

          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs).toHaveLength(1);
    });

    test("re-paste Failed retryable=false (unsupported) → status preserved, no implicit retry", async () => {
      // #given
      const url = "https://not-scribd.example/doc/1";

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [first] = yield* engine.enqueue(url);
          const [second] = yield* engine.enqueue(url);

          return { first, second, snap: yield* engine.snapshot };
        }),
      );

      // #then
      expect(result.second!.id).toBe(result.first!.id);
      expect(result.second!.status).toBe("Failed");
      expect(result.second!.failure?.retryable).toBe(false);
      expect(result.snap.jobs).toHaveLength(1);
    });
  });

  describe("enqueue: order", () => {
    test("newest-first: latest enqueued URL appears at index 0", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* engine.enqueue("https://www.scribd.com/document/2/b");

          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs[0]!.url).toBe("https://www.scribd.com/document/2/b");
      expect(snap.jobs[1]!.url).toBe("https://www.scribd.com/document/1/a");
    });

    test("batch paste: first URL in text ends up at top, others follow in paste order", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue(
            "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b\nhttps://www.scribd.com/document/3/c",
          );

          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs.map((j) => j.url)).toEqual([
        "https://www.scribd.com/document/1/a",
        "https://www.scribd.com/document/2/b",
        "https://www.scribd.com/document/3/c",
      ]);
    });

    test("mixed batch [new1, dup, new2]: snapshot order [new1, new2, dup, ...rest]", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          // seed: dup will be the older one, plus an untouched "rest"
          yield* engine.enqueue("https://www.scribd.com/document/dup/x");
          yield* engine.enqueue("https://www.scribd.com/document/rest/y");
          // now mixed paste
          yield* engine.enqueue(
            "https://www.scribd.com/document/new1/a\nhttps://www.scribd.com/document/dup/x\nhttps://www.scribd.com/document/new2/b",
          );

          return yield* engine.snapshot;
        }),
      );

      // #then — new1, new2 first (paste order among new), then dup, then untouched rest
      expect(snap.jobs.map((j) => j.url)).toEqual([
        "https://www.scribd.com/document/new1/a",
        "https://www.scribd.com/document/new2/b",
        "https://www.scribd.com/document/dup/x",
        "https://www.scribd.com/document/rest/y",
      ]);
    });
  });

  describe("downloader events: title + progress", () => {
    test("TitleResolved → JobTitleUpdated published + displayTitle updated", async () => {
      // #given
      state.scribdExecute = mock((_url: string, _folder: string, onEvent: OnEvent) =>
        Effect.gen(function* () {
          yield* onEvent(ScraperEvent.TitleResolved({ title: "Into the Odd" }));
        }),
      );

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const tagsFork = yield* engine.events.pipe(
            Stream.filter((e): e is Extract<JobEvent, { _tag: "JobTitleUpdated" }> =>
              Predicate.isTagged(e, "JobTitleUpdated"),
            ),
            Stream.take(1),
            Stream.runCollect,
            Effect.fork,
          );

          yield* Effect.sleep("10 millis");
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          const chunk = yield* tagsFork;
          const snap = yield* waitForQuiet(engine);

          return { events: Chunk.toReadonlyArray(chunk), snap };
        }),
      );

      // #then
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.title).toBe("Into the Odd");
      expect(result.snap.jobs[0]!.displayTitle).toBe("Into the Odd");
    });

    test("ScrapeProgress + RenderProgress → JobProgress published; progress cleared on Downloaded", async () => {
      // #given
      state.scribdExecute = mock((_url: string, _folder: string, onEvent: OnEvent) =>
        Effect.gen(function* () {
          yield* onEvent(ScraperEvent.ScrapeProgress({ done: 10, total: 10 }));
          yield* onEvent(ScraperEvent.RenderProgress({ done: 1, total: 3 }));
          yield* onEvent(ScraperEvent.RenderProgress({ done: 3, total: 3 }));
        }),
      );

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const progFork = yield* engine.events.pipe(
            Stream.filter((e): e is Extract<JobEvent, { _tag: "JobProgress" }> =>
              Predicate.isTagged(e, "JobProgress"),
            ),
            Stream.take(3),
            Stream.runCollect,
            Effect.fork,
          );

          yield* Effect.sleep("10 millis");
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          const chunk = yield* progFork;
          const snap = yield* waitForQuiet(engine);

          return { events: Chunk.toReadonlyArray(chunk), snap };
        }),
      );

      // #then
      expect(result.events).toHaveLength(3);
      expect(result.events[0]!.stage).toBe("scrape");
      expect(result.events[2]!.stage).toBe("render");
      expect(result.snap.jobs[0]!.status).toBe("Downloaded");
      expect(result.snap.jobs[0]!.progress).toBeUndefined();
    });

    test("progress cleared when job Fails", async () => {
      // #given
      state.scribdExecute = mock((url: string, _folder: string, onEvent: OnEvent) =>
        Effect.gen(function* () {
          yield* onEvent(ScraperEvent.RenderProgress({ done: 2, total: 5 }));

          return yield* Effect.fail(new PageLoadFailed({ url, cause: "boom" }));
        }),
      );

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(snap.jobs[0]!.status).toBe("Failed");
      expect(snap.jobs[0]!.progress).toBeUndefined();
    });
  });

  describe("output folder", () => {
    test("default folder comes from ConfigLoader; setOutputFolder updates it + publishes event", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const initial = yield* engine.outputFolder;

          const evtFork = yield* engine.events.pipe(
            Stream.filter((e): e is Extract<JobEvent, { _tag: "OutputFolderChanged" }> =>
              Predicate.isTagged(e, "OutputFolderChanged"),
            ),
            Stream.take(1),
            Stream.runCollect,
            Effect.fork,
          );

          yield* Effect.sleep("10 millis");
          yield* engine.setOutputFolder("/tmp/new");
          const chunk = yield* evtFork;
          const after = yield* engine.outputFolder;

          return { initial, after, events: Chunk.toReadonlyArray(chunk) };
        }),
      );

      // #then
      expect(result.initial).toBe("/tmp/out");
      expect(result.after).toBe("/tmp/new");
      expect(result.events[0]!.path).toBe("/tmp/new");
    });

    test("worker passes current folder to execute (read at take time)", async () => {
      // #given
      const folders: string[] = [];
      state.scribdExecute = mock((_url: string, folder: string) =>
        Effect.sync(() => {
          folders.push(folder);
        }),
      );

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.setOutputFolder("/tmp/new");
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(folders).toEqual(["/tmp/new"]);
    });

    test("in-flight job keeps original folder; subsequent job uses new folder", async () => {
      // #given
      const folders: string[] = [];
      let firstStarted = false;

      let release: () => void = () => {
        throw new Error("first job has not started");
      };

      state.scribdExecute = mock((url: string, folder: string) =>
        Effect.gen(function* () {
          folders.push(folder);

          if (url.includes("/1/")) {
            firstStarted = true;
            yield* Effect.async<void>((cb) => {
              release = () => cb(Effect.void);
            });
          }
        }),
      );

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue(
            "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b",
          );

          // wait until first job is in-flight
          for (let i = 0; i < 100 && !firstStarted; i++) yield* Effect.sleep("5 millis");
          yield* engine.setOutputFolder("/tmp/new");
          yield* Effect.sync(() => release());
          yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(folders[0]).toBe("/tmp/out");
      expect(folders[1]).toBe("/tmp/new");
    });

    test("setOutputFolder ignores empty / whitespace input", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const after = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.setOutputFolder("   ");

          return yield* engine.outputFolder;
        }),
      );

      // #then
      expect(after).toBe("/tmp/out");
    });
  });

  describe("persistence", () => {
    test("cold start with empty stores leaves snapshot empty and folder from settings", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const snap = yield* engine.snapshot;
          const folder = yield* engine.outputFolder;

          return { snap, folder };
        }),
      );

      // #then
      expect(result.snap.jobs).toEqual([]);
      expect(result.folder).toBe("/tmp/out");
    });

    test("restores jobs from JobStore on cold start", async () => {
      // #given — block worker so we observe restored state cleanly
      state.scribdExecute = mock(() => Effect.never);
      state.restoredJobs = [
        {
          id: "a",
          url: "https://www.scribd.com/document/1/x",
          domain: "scribd",
          displayTitle: "doc 1",
          status: "Queued",
        },
        {
          id: "b",
          url: "https://www.scribd.com/document/2/y",
          domain: "scribd",
          displayTitle: "doc 2",
          status: "Downloaded",
        },
        {
          id: "c",
          url: "https://www.scribd.com/document/3/z",
          domain: "scribd",
          displayTitle: "doc 3",
          status: "Failed",
          failure: { reason: "boom", retryable: true },
        },
      ];

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.snapshot;
        }),
      );

      // #then — order preserved; second/third remain as restored, first may already
      // be Downloading because the worker may have picked it up before snapshot read
      expect(snap.jobs.map((j) => j.id)).toEqual(["a", "b", "c"]);
      expect(["Queued", "Downloading"]).toContain(snap.jobs[0]!.status);
      expect(snap.jobs[1]!.status).toBe("Downloaded");
      expect(snap.jobs[2]!.status).toBe("Failed");
      expect(snap.jobs[2]!.failure).toEqual({ reason: "boom", retryable: true });
    });

    test("restores outputFolder from ConfigStore on cold start", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);
      state.initialSettings = { ...emptySettings, outputFolder: "/tmp/persisted" };

      // #when
      const folder = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.outputFolder;
        }),
      );

      // #then
      expect(folder).toBe("/tmp/persisted");
    });

    test("restored Queued jobs enter the worker queue in original order", async () => {
      // #given
      const observed: string[] = [];
      state.scribdExecute = mock((url: string) =>
        Effect.sync(() => {
          observed.push(url);
        }),
      );
      state.restoredJobs = [
        {
          id: "a",
          url: "https://www.scribd.com/document/1/x",
          domain: "scribd",
          displayTitle: "doc 1",
          status: "Queued",
        },
        {
          id: "b",
          url: "https://www.scribd.com/document/2/y",
          domain: "scribd",
          displayTitle: "doc 2",
          status: "Queued",
        },
      ];

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(observed).toEqual([
        "https://www.scribd.com/document/1/x",
        "https://www.scribd.com/document/2/y",
      ]);
    });

    test("enqueue triggers JobStore.write at least once", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
        }),
      );

      // #then
      expect(state.jobStoreWrite).toHaveBeenCalled();
    });

    test("remove triggers JobStore.write", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.never);

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const created = yield* engine.enqueue(
            "https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b",
          );

          state.jobStoreWrite.mockClear();
          yield* engine.remove(created[1]!.id);
        }),
      );

      // #then
      expect(state.jobStoreWrite).toHaveBeenCalled();
    });

    test("worker status transitions trigger JobStore.write", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          state.jobStoreWrite.mockClear();
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* waitForQuiet(engine);
        }),
      );

      // #then — at minimum: enqueue, Queued→Downloading, Downloading→Downloaded
      expect(state.jobStoreWrite.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    test("JobTitleUpdated triggers JobStore.write but JobProgress does not", async () => {
      // #given
      const allowTitle = Effect.runSync(Deferred.make<void>());
      const titleHandled = Effect.runSync(Deferred.make<void>());
      const allowProgress = Effect.runSync(Deferred.make<void>());
      const progressHandled = Effect.runSync(Deferred.make<void>());
      const finish = Effect.runSync(Deferred.make<void>());
      state.scribdExecute = mock((_url: string, _folder: string, onEvent: OnEvent) =>
        Effect.gen(function* () {
          yield* Deferred.await(allowTitle);
          yield* onEvent(ScraperEvent.TitleResolved({ title: "Real Title" }));
          yield* Deferred.succeed(titleHandled, undefined);
          yield* Deferred.await(allowProgress);
          yield* onEvent(ScraperEvent.ScrapeProgress({ done: 5, total: 10 }));
          yield* onEvent(ScraperEvent.RenderProgress({ done: 1, total: 3 }));
          yield* Deferred.succeed(progressHandled, undefined);
          yield* Deferred.await(finish);
        }),
      );

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* Deferred.succeed(allowTitle, undefined);
          yield* Deferred.await(titleHandled).pipe(Effect.timeout("1 second"));

          // #then — completion cannot supply the title persistence being checked.
          expect(state.jobStoreWrite.mock.calls.at(-1)?.[0]).toEqual([
            { ...job!, displayTitle: "Real Title", status: "Downloading" },
          ]);
          expect((yield* engine.snapshot).jobs[0]?.status).toBe("Downloading");
          const writesBeforeProgress = state.jobStoreWrite.mock.calls.length;
          yield* Deferred.succeed(allowProgress, undefined);
          yield* Deferred.await(progressHandled).pipe(Effect.timeout("1 second"));
          expect((yield* engine.snapshot).jobs[0]?.progress).toEqual({
            done: 1,
            total: 3,
            stage: "render",
          });
          expect(state.jobStoreWrite.mock.calls.length - writesBeforeProgress).toBe(0);
          yield* Deferred.succeed(finish, undefined);
          yield* waitForQuiet(engine);
        }),
      );
    });

    test("setOutputFolder triggers ConfigStore.write with the expanded path", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          state.configStoreWrite.mockClear();
          yield* engine.setOutputFolder("/tmp/new");
        }),
      );

      // #then
      expect(state.configStoreWrite).toHaveBeenCalledWith({
        outputFolder: "/tmp/new",
        ilovepdfPublicKey: "",
        ilovepdfSecretKey: "",
        ilovepdfKeysValid: false,
      });
    });

    test("persist failure does not crash the engine", async () => {
      // #given — JobStore.write always fails
      state.scribdExecute = mock(() => Effect.void);
      state.jobStoreWrite = mock(() =>
        Effect.fail(new PersistenceFailed({ path: "/x", op: "write", cause: "disk full" })),
      );

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");

          return yield* waitForQuiet(engine);
        }),
      );

      // #then — engine completed the job in memory despite persist errors
      expect(snap.jobs[0]!.status).toBe("Downloaded");
    });
  });

  describe("events stream", () => {
    test("subscribe → enqueue scribd URL → events include JobAdded, JobStarted, JobCompleted in order", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const tags = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const collector = yield* engine.events.pipe(
            Stream.take(4),
            Stream.runCollect,
            Effect.fork,
          );

          // yield to let the subscription register before publishing
          yield* Effect.sleep("10 millis");
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          const chunk = yield* collector;

          return Chunk.toReadonlyArray(chunk).map((e: JobEvent) => e._tag);
        }),
      );

      // #then
      expect(tags).toEqual(["JobAdded", "SnapshotReplaced", "JobStarted", "JobCompleted"]);
    });

    test("unsupported URL emits JobAdded + JobFailed without JobStarted", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const tags = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          const collector = yield* engine.events.pipe(
            Stream.take(2),
            Stream.runCollect,
            Effect.fork,
          );

          yield* Effect.sleep("10 millis");
          yield* engine.enqueue("https://example.com/foo");
          const chunk = yield* collector;

          return Chunk.toReadonlyArray(chunk).map((e: JobEvent) => e._tag);
        }),
      );

      // #then
      expect(tags).toEqual(["JobAdded", "JobFailed"]);
    });
  });

  describe("scrapers registry extensibility", () => {
    const runScopedWith = <A, E>(
      program: Effect.Effect<A, E, DownloadEngine>,
      extraScrapers: ReadonlyArray<Scraper>,
    ) =>
      Effect.runPromise(
        Effect.scoped(program.pipe(Effect.provide(buildLayer(defaultConfig, extraScrapers)))),
      );

    test("URL handled by extra scraper gets that scraper's id as domain", async () => {
      // #given
      const customExecute = mock(() => Effect.void);
      const custom = makeCustomScraper(customExecute);

      // #when
      const created = await runScopedWith(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.enqueue("https://example.com/foo");
        }),
        [custom],
      );

      // #then
      expect<string>(created[0]!.domain).toBe("custom");
      expect(created[0]!.status).toBe("Queued");
    });

    test("scribd URL still routes to scribd scraper when extra scrapers present", async () => {
      // #given
      const customExecute = mock(() => Effect.void);
      const custom = makeCustomScraper(customExecute);
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const snap = await runScopedWith(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");

          return yield* waitForQuiet(engine);
        }),
        [custom],
      );

      // #then
      expect(snap.jobs[0]!.domain).toBe("scribd");
      expect(state.scribdExecute).toHaveBeenCalledTimes(1);
      expect(customExecute).not.toHaveBeenCalled();
    });

    test("persisted job with domain no longer in registry → Failed retryable: true", async () => {
      // #given a restored Queued job for a domain that's gone from the registry
      const persistedJob: Job = {
        id: "j1",
        url: "https://gone.example.com/x",
        // @ts-expect-error 'gone' is outside JobDomain union; simulates registry shrinkage between restarts
        domain: "gone",
        displayTitle: "Gone document",
        status: "Queued",
      };

      state.restoredJobs = [persistedJob];

      // #when worker picks it up against a registry that doesn't include 'gone'
      const snap = await runScopedWith(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* waitForQuiet(engine);
        }),
        [],
      );

      // #then job fails as retryable so a future restart with the original registry recovers
      const failed = snap.jobs.find((j) => j.id === "j1")!;
      expect(failed.status).toBe("Failed");
      expect(failed.failure?.retryable).toBe(true);
      expect(failed.failure?.reason).toContain("No scraper registered for domain");
    });

    test("UnsupportedUrl scraper failure → retryable: false (non-transient)", async () => {
      // #given scraper that fails with UnsupportedUrl (e.g. extractId failure inside execute)
      state.scribdExecute = mock((url: string) => Effect.fail(new UnsupportedUrl({ url })));

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/something/weird");

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(snap.jobs[0]!.status).toBe("Failed");
      expect(snap.jobs[0]!.failure?.retryable).toBe(false);
    });

    test("transient scraper failure (PageLoadFailed) → retryable: true", async () => {
      // #given
      state.scribdExecute = mock((url: string) =>
        Effect.fail(new PageLoadFailed({ url, cause: "network blip" })),
      );

      // #when
      const snap = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(snap.jobs[0]!.status).toBe("Failed");
      expect(snap.jobs[0]!.failure?.retryable).toBe(true);
    });
  });

  describe("compression (best-effort, KTD1/KTD3/KTD9)", () => {
    const validKeysSettings = (outputFolder: string): Settings => ({
      outputFolder,
      ilovepdfPublicKey: "pub",
      ilovepdfSecretKey: "sec",
      ilovepdfKeysValid: true,
    });

    const writingScraper = (filename: string) =>
      mock((_url: string, folder: string) =>
        Effect.promise(() =>
          fs.writeFile(path.join(folder, filename), new Uint8Array([0x25, 0x50, 0x44, 0x46])),
        ),
      );

    const withTmp = async (run: (tmp: string) => Promise<void>) => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "engine-compress-"));

      try {
        await run(tmp);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    };

    test("valid keys + compress succeeds → Downloaded with no compression field; called with resolved path", async () => {
      await withTmp(async (tmp) => {
        // #given
        state.initialSettings = validKeysSettings(tmp);
        state.scribdExecute = writingScraper("Scribd document 1.pdf");
        state.compressCompress = mock(() => Effect.void);

        // #when
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(snap.jobs[0]!.status).toBe("Downloaded");
        expect(snap.jobs[0]!.compression).toBeUndefined();
        expect(state.compressCompress).toHaveBeenCalledWith(
          path.join(tmp, "Scribd document 1.pdf"),
          {
            publicKey: "pub",
            secretKey: "sec",
          },
        );
      });
    });

    test("valid keys + compress fails → Downloaded with compression failed + reason; never Failed", async () => {
      await withTmp(async (tmp) => {
        // #given
        state.initialSettings = validKeysSettings(tmp);
        state.scribdExecute = writingScraper("Scribd document 1.pdf");
        state.compressCompress = mock(() =>
          Effect.fail(new CompressionFailed({ path: "p", reason: "quota exceeded", cause: {} })),
        );

        // #when
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(snap.jobs[0]!.status).toBe("Downloaded");
        expect(snap.jobs[0]!.compression).toEqual({ status: "failed", reason: "quota exceeded" });
      });
    });

    test("keys present but ilovepdfKeysValid false → compress never invoked", async () => {
      await withTmp(async (tmp) => {
        // #given
        state.initialSettings = { ...validKeysSettings(tmp), ilovepdfKeysValid: false };
        state.scribdExecute = writingScraper("Scribd document 1.pdf");
        state.compressCompress = mock(() => Effect.void);

        // #when
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(snap.jobs[0]!.status).toBe("Downloaded");
        expect(snap.jobs[0]!.compression).toBeUndefined();
        expect(state.compressCompress).not.toHaveBeenCalled();
      });
    });

    test("empty keys → compress never invoked", async () => {
      await withTmp(async (tmp) => {
        // #given — default emptySettings, just point the folder at tmp
        state.initialSettings = { ...emptySettings, outputFolder: tmp };
        state.scribdExecute = writingScraper("Scribd document 1.pdf");
        state.compressCompress = mock(() => Effect.void);

        // #when
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(snap.jobs[0]!.compression).toBeUndefined();
        expect(state.compressCompress).not.toHaveBeenCalled();
      });
    });

    test("valid keys but output file missing → compress not called; reason 'output file not found'", async () => {
      await withTmp(async (tmp) => {
        // #given — scraper writes nothing, so the recomputed path won't exist (KTD1 guard)
        state.initialSettings = validKeysSettings(tmp);
        state.scribdExecute = mock(() => Effect.void);
        state.compressCompress = mock(() => Effect.void);

        // #when
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(snap.jobs[0]!.status).toBe("Downloaded");
        expect(snap.jobs[0]!.compression).toEqual({
          status: "failed",
          reason: "output file not found",
        });
        expect(state.compressCompress).not.toHaveBeenCalled();
      });
    });

    test.each([
      { publicKey: "new-public", secretKey: "new-secret" },
      { publicKey: "new-public", secretKey: "sec" },
      { publicKey: "pub", secretKey: "new-secret" },
    ])(
      "old compression credentials cannot invalidate a newly validated pair %j",
      async (newKeys) => {
        await withTmp(async (tmp) => {
          // #given — the first request remains pending while settings change.
          state.initialSettings = validKeysSettings(tmp);
          await fs.writeFile(path.join(tmp, "Scribd document 1.pdf"), "fake-pdf");
          await fs.writeFile(path.join(tmp, "Scribd document 2.pdf"), "fake-pdf");
          const started = Effect.runSync(Deferred.make<void>());
          const release = Effect.runSync(Deferred.make<void>());
          state.compressCompress = mock<PdfCompressorService["compress"]>(
            () => Effect.void,
          ).mockImplementationOnce((pdfPath) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);

              return yield* Effect.fail(
                new CompressionFailed({
                  path: pdfPath,
                  reason: "invalid credentials",
                  cause: new Error("old credentials rejected"),
                }),
              );
            }),
          );

          // #when
          await runScoped(
            Effect.gen(function* () {
              const engine = yield* DownloadEngine;
              const [first] = yield* engine.enqueue("https://www.scribd.com/document/1/a");
              yield* Deferred.await(started).pipe(Effect.timeout("1 second"));
              expect(state.compressCompress.mock.calls).toEqual([
                [path.join(tmp, "Scribd document 1.pdf"), { publicKey: "pub", secretKey: "sec" }],
              ]);
              expect(yield* engine.setSettings(newKeys)).toBe(true);
              yield* Deferred.succeed(release, undefined);
              const firstDone = yield* waitForQuiet(engine);

              // #then — validity belongs to the tested pair, not the previous request.
              expect(yield* engine.settings).toEqual({ ...newKeys, valid: true });
              expect(state.configStoreWrite.mock.calls).toEqual([
                [
                  {
                    outputFolder: tmp,
                    ilovepdfPublicKey: newKeys.publicKey,
                    ilovepdfSecretKey: newKeys.secretKey,
                    ilovepdfKeysValid: true,
                  },
                ],
              ]);
              expect(firstDone.jobs).toEqual([
                {
                  ...first!,
                  status: "Downloaded",
                  compression: { status: "failed", reason: "invalid credentials" },
                },
              ]);
              const [second] = yield* engine.enqueue("https://www.scribd.com/document/2/b");
              const secondDone = yield* waitForQuiet(engine);
              expect(secondDone.jobs.find((job) => job.id === second!.id)).toEqual({
                ...second!,
                status: "Downloaded",
              });
              expect(state.compressCompress.mock.calls).toEqual([
                [path.join(tmp, "Scribd document 1.pdf"), { publicKey: "pub", secretKey: "sec" }],
                [path.join(tmp, "Scribd document 2.pdf"), newKeys],
              ]);
            }),
          );
        });
      },
    );

    test("runtime 'invalid credentials' flips persisted validity; next download skips compression", async () => {
      await withTmp(async (tmp) => {
        // #given
        state.initialSettings = validKeysSettings(tmp);
        state.scribdExecute = mock((_url: string, folder: string) =>
          Effect.promise(async () => {
            const doc = /document\/(\d+)/.exec(_url)![1];
            await fs.writeFile(
              path.join(folder, `Scribd document ${doc}.pdf`),
              new Uint8Array([0x25, 0x50, 0x44, 0x46]),
            );
          }),
        );
        state.compressCompress = mock(() =>
          Effect.fail(
            new CompressionFailed({ path: "p", reason: "invalid credentials", cause: {} }),
          ),
        );

        // #when — first download flips validity, second (different URL) should skip
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");
            const firstDone = yield* waitForQuiet(engine);
            // #then — unchanged credentials still invalidate and persist before the next job.
            expect(yield* engine.settings).toEqual({
              publicKey: "pub",
              secretKey: "sec",
              valid: false,
            });
            expect(state.configStoreWrite.mock.calls).toEqual([
              [
                {
                  outputFolder: tmp,
                  ilovepdfPublicKey: "pub",
                  ilovepdfSecretKey: "sec",
                  ilovepdfKeysValid: false,
                },
              ],
            ]);
            expect(
              firstDone.jobs.map((job) => ({ status: job.status, compression: job.compression })),
            ).toEqual([
              {
                status: "Downloaded",
                compression: { status: "failed", reason: "invalid credentials" },
              },
            ]);
            yield* engine.enqueue("https://www.scribd.com/document/2/b");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(state.compressCompress).toHaveBeenCalledTimes(1);
        expect(state.configStoreWrite).toHaveBeenCalledWith({
          outputFolder: tmp,
          ilovepdfPublicKey: "pub",
          ilovepdfSecretKey: "sec",
          ilovepdfKeysValid: false,
        });
        const second = snap.jobs.find((j) => j.url.includes("/document/2/"))!;
        expect(second.status).toBe("Downloaded");
        expect(second.compression).toBeUndefined();
      });
    });

    test("compressing state is observable via snapshot during the call", async () => {
      await withTmp(async (tmp) => {
        // #given — compress blocks until we release it, so we can observe the interim state
        state.initialSettings = validKeysSettings(tmp);
        state.scribdExecute = writingScraper("Scribd document 1.pdf");
        let release: () => void = () => {};

        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });

        state.compressCompress = mock(() => Effect.promise(() => gate));

        // #when
        const observed = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");
            let seen: Job | undefined;

            for (let i = 0; i < 200; i++) {
              const snap = yield* engine.snapshot;
              const job = snap.jobs[0];

              if (job?.compression?.status === "compressing") {
                seen = job;
                break;
              }

              yield* Effect.sleep("5 millis");
            }

            yield* Effect.sync(() => release());
            yield* waitForQuiet(engine);

            return seen;
          }),
        );

        // #then
        expect(observed?.compression).toEqual({ status: "compressing" });
      });
    });

    test("setSettings with a complete pair persists keys + validity and returns the result", async () => {
      // #given
      state.compressValidate = mock(() => Effect.succeed(true));

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const valid = yield* engine.setSettings({ publicKey: "p", secretKey: "s" });
          const view = yield* engine.settings;

          return { valid, view };
        }),
      );

      // #then
      expect(result.valid).toBe(true);
      expect(result.view).toEqual({ publicKey: "p", secretKey: "s", valid: true });
      expect(state.configStoreWrite).toHaveBeenCalledWith({
        outputFolder: "/tmp/out",
        ilovepdfPublicKey: "p",
        ilovepdfSecretKey: "s",
        ilovepdfKeysValid: true,
      });
    });

    test("setSettings with both keys empty clears without validating and returns false", async () => {
      // #given
      state.initialSettings = validKeysSettings("/tmp/out");
      state.compressValidate = mock(() => Effect.succeed(true));

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const valid = yield* engine.setSettings({ publicKey: "", secretKey: "" });
          const view = yield* engine.settings;

          return { valid, view };
        }),
      );

      // #then
      expect(result.valid).toBe(false);
      expect(result.view).toEqual({ publicKey: "", secretKey: "", valid: null });
      expect(state.compressValidate).not.toHaveBeenCalled();
    });

    test("setSettings with exactly one key filled returns false and does not validate", async () => {
      // #given
      state.compressValidate = mock(() => Effect.succeed(true));

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;

          return yield* engine.setSettings({ publicKey: "p", secretKey: "" });
        }),
      );

      // #then
      expect(result).toBe(false);
      expect(state.compressValidate).not.toHaveBeenCalled();
    });
  });

  describe("title metadata stamp", () => {
    const writingScraper = (filename: string) =>
      mock((_url: string, folder: string) =>
        Effect.promise(() =>
          fs.writeFile(path.join(folder, filename), new Uint8Array([0x25, 0x50, 0x44, 0x46])),
        ),
      );

    const withTmp = async (run: (tmp: string) => Promise<void>) => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "engine-title-"));

      try {
        await run(tmp);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    };

    test("output file present → setTitle called with resolved displayTitle (even with no compression keys)", async () => {
      await withTmp(async (tmp) => {
        // #given — empty keys means compression is skipped; the stamp must still run
        state.initialSettings = { ...emptySettings, outputFolder: tmp };
        state.scribdExecute = writingScraper("Scribd document 1.pdf");

        // #when
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(snap.jobs[0]!.status).toBe("Downloaded");
        expect(state.pdfSetTitle).toHaveBeenCalledWith(
          path.join(tmp, "Scribd document 1.pdf"),
          "Scribd document 1",
        );
      });
    });

    test("setTitle failure never blocks the job from reaching Downloaded", async () => {
      await withTmp(async (tmp) => {
        // #given
        state.initialSettings = { ...emptySettings, outputFolder: tmp };
        state.scribdExecute = writingScraper("Scribd document 1.pdf");
        state.pdfSetTitle = mock(() =>
          Effect.fail(new PdfMetadataFailed({ path: "p", cause: new Error("boom") })),
        );

        // #when
        const snap = await runScoped(
          Effect.gen(function* () {
            const engine = yield* DownloadEngine;
            yield* engine.enqueue("https://www.scribd.com/document/1/a");

            return yield* waitForQuiet(engine);
          }),
        );

        // #then
        expect(snap.jobs[0]!.status).toBe("Downloaded");
        expect(state.pdfSetTitle).toHaveBeenCalledTimes(1);
      });
    });

    test("output file missing → setTitle not called", async () => {
      // #given — scraper writes nothing, so the resolved path does not exist
      state.scribdExecute = mock(() => Effect.void);

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a");

          return yield* waitForQuiet(engine);
        }),
      );

      // #then
      expect(state.pdfSetTitle).not.toHaveBeenCalled();
    });
  });
});
