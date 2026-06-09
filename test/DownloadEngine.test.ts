import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Cause, Chunk, Effect, Exit, Layer, Stream } from "effect";
import { DownloadEngine, DownloadEngineLive, type EngineSnapshot, type Job, type JobEvent } from "../src/service/DownloadEngine";
import { ScribdDownloader, type ScribdDownloaderService } from "../src/service/ScribdDownloader";
import { ConfigLoader, type ConfigData } from "../src/utils/io/ConfigLoader";
import { PageLoadFailed } from "../src/errors/DomainErrors";

interface MockState {
  scribdExecute: ReturnType<typeof mock>;
}

const state: MockState = {
  scribdExecute: mock(),
};

const resetState = () => {
  state.scribdExecute = mock(() => Effect.void);
};

const defaultConfig: ConfigData = {
  scribd: { rendertime: 100 },
  directory: { output: "/tmp/out", filename: "title" },
};

const buildLayer = (config: ConfigData = defaultConfig) => {
  const scribdSvc: ScribdDownloaderService = {
    execute: (url, folder, onEvent) => state.scribdExecute(url, folder, onEvent) as ReturnType<ScribdDownloaderService["execute"]>,
  };
  return Layer.provide(DownloadEngineLive, Layer.mergeAll(Layer.succeed(ScribdDownloader, scribdSvc), Layer.succeed(ConfigLoader, config)));
};

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
    if (failure._tag === "Some") {
      return (failure.value as { _tag: string })._tag;
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
      const text = "https://www.scribd.com/document/1/a\nhttps://example.com/foo\nhttps://www.scribd.com/document/2/b";

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
      expect(state.scribdExecute).toHaveBeenCalledWith(url, "/tmp/out", expect.any(Function));
    });

    test("ScribdDownloader failure → Failed with retryable: true", async () => {
      // #given
      state.scribdExecute = mock((url: string) => Effect.fail(new PageLoadFailed({ url, cause: "boom" })));

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
          yield* engine.enqueue("https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b");
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
          const created = yield* engine.enqueue("https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b");
          yield* engine.remove(created[1]!.id);
          return yield* engine.snapshot;
        }),
      );

      // #then
      expect(snap.jobs).toHaveLength(1);
      expect(snap.jobs[0]!.url).toBe("https://www.scribd.com/document/1/a");
    });

    test("remove on Downloaded fails NotRemovable", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const exit = await runScopedExit(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://www.scribd.com/document/1/a");
          yield* waitForQuiet(engine);
          yield* engine.remove(job!.id);
        }),
      );

      // #then
      expect(firstFailureTag(exit)).toBe("NotRemovable");
    });

    test("remove on Failed fails NotRemovable", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const exit = await runScopedExit(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const [job] = yield* engine.enqueue("https://example.com/foo");
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
          yield* engine.remove("nonexistent" as Job["id"]);
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
          const created = yield* engine.enqueue("https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b");
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

  describe("retry", () => {
    test("retry on retryable Failed → status Queued, worker picks up", async () => {
      // #given
      let attempt = 0;
      state.scribdExecute = mock((_url: string) => {
        attempt += 1;
        return attempt === 1 ? Effect.fail(new PageLoadFailed({ url: _url, cause: "first" })) : Effect.void;
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
          yield* engine.retry("nonexistent" as Job["id"]);
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

    test("re-enqueue after Downloaded → same id reused, no second download triggered", async () => {
      // #given
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

      // #then
      expect(result.second).toHaveLength(1);
      expect(result.second[0]!.id).toBe(result.first!.id);
      expect(result.snap.jobs).toHaveLength(1);
      expect(state.scribdExecute).toHaveBeenCalledTimes(1);
    });

    test("re-enqueue after Failed → new Job (different id)", async () => {
      // #given
      state.scribdExecute = mock((u: string) => Effect.fail(new PageLoadFailed({ url: u, cause: "boom" })));
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

      // #then
      expect(result.second!.id).not.toBe(result.first!.id);
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
  });

  describe("downloader events: title + progress", () => {
    test("TitleResolved → JobTitleUpdated published + displayTitle updated", async () => {
      // #given
      state.scribdExecute = mock(
        (_url: string, _folder: string, onEvent: (e: { _tag: string; title?: string }) => Effect.Effect<void, never, never>) =>
          Effect.gen(function* () {
            yield* onEvent({ _tag: "TitleResolved", title: "Into the Odd" });
          }),
      );

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const tagsFork = yield* engine.events.pipe(
            Stream.filter((e) => e._tag === "JobTitleUpdated"),
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
      expect((result.events[0]! as { title: string }).title).toBe("Into the Odd");
      expect(result.snap.jobs[0]!.displayTitle).toBe("Into the Odd");
    });

    test("ScrapeProgress + RenderProgress → JobProgress published; progress cleared on Downloaded", async () => {
      // #given
      state.scribdExecute = mock(
        (
          _url: string,
          _folder: string,
          onEvent: (e: { _tag: string; done?: number; total?: number }) => Effect.Effect<void, never, never>,
        ) =>
          Effect.gen(function* () {
            yield* onEvent({ _tag: "ScrapeProgress", done: 10, total: 10 });
            yield* onEvent({ _tag: "RenderProgress", done: 1, total: 3 });
            yield* onEvent({ _tag: "RenderProgress", done: 3, total: 3 });
          }),
      );

      // #when
      const result = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const progFork = yield* engine.events.pipe(
            Stream.filter((e) => e._tag === "JobProgress"),
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
      expect((result.events[0]! as { stage: string }).stage).toBe("scrape");
      expect((result.events[2]! as { stage: string; done: number }).stage).toBe("render");
      expect(result.snap.jobs[0]!.status).toBe("Downloaded");
      expect(result.snap.jobs[0]!.progress).toBeUndefined();
    });

    test("progress cleared when job Fails", async () => {
      // #given
      state.scribdExecute = mock(
        (
          url: string,
          _folder: string,
          onEvent: (e: { _tag: string; done?: number; total?: number }) => Effect.Effect<void, never, never>,
        ) =>
          Effect.gen(function* () {
            yield* onEvent({ _tag: "RenderProgress", done: 2, total: 5 });
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
            Stream.filter((e) => e._tag === "OutputFolderChanged"),
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
      expect((result.events[0]! as { path: string }).path).toBe("/tmp/new");
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
      const release: { resolve?: () => void } = {};
      state.scribdExecute = mock((url: string, folder: string) =>
        Effect.gen(function* () {
          folders.push(folder);
          if (url.includes("/1/")) {
            firstStarted = true;
            yield* Effect.async<void>((cb) => {
              release.resolve = () => cb(Effect.void);
            });
          }
        }),
      );

      // #when
      await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* engine.enqueue("https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b");
          // wait until first job is in-flight
          for (let i = 0; i < 100 && !firstStarted; i++) yield* Effect.sleep("5 millis");
          yield* engine.setOutputFolder("/tmp/new");
          yield* Effect.sync(() => release.resolve?.());
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

  describe("events stream", () => {
    test("subscribe → enqueue scribd URL → events include JobAdded, JobStarted, JobCompleted in order", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const tags = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const collector = yield* engine.events.pipe(Stream.take(3), Stream.runCollect, Effect.fork);
          // yield to let the subscription register before publishing
          yield* Effect.sleep("10 millis");
          yield* engine.enqueue("https://www.scribd.com/document/1/a");
          const chunk = yield* collector;
          return Chunk.toReadonlyArray(chunk).map((e: JobEvent) => e._tag);
        }),
      );

      // #then
      expect(tags).toEqual(["JobAdded", "JobStarted", "JobCompleted"]);
    });

    test("unsupported URL emits JobAdded + JobFailed without JobStarted", async () => {
      // #given
      state.scribdExecute = mock(() => Effect.void);

      // #when
      const tags = await runScoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          const collector = yield* engine.events.pipe(Stream.take(2), Stream.runCollect, Effect.fork);
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
});
