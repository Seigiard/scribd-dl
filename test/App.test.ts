import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { App, AppLive } from "../src/App.ts";
import { ScribdDownloader, type ScribdDownloaderService } from "../src/service/ScribdDownloader.ts";
import { ConfigLoader, type ConfigData } from "../src/utils/io/ConfigLoader.ts";
import { DirectoryIo, type DirectoryIoService } from "../src/utils/io/DirectoryIo.ts";

interface MockState {
  scribdExecute: ReturnType<typeof mock>;
  slideshareExecute: ReturnType<typeof mock>;
  everandExecute: ReturnType<typeof mock>;
  dirCreate: ReturnType<typeof mock>;
  dirRemove: ReturnType<typeof mock>;
  config: ConfigData;
}

const state: MockState = {
  scribdExecute: mock(),
  slideshareExecute: mock(),
  everandExecute: mock(),
  dirCreate: mock(),
  dirRemove: mock(),
  config: {
    scribd: { rendertime: 100 },
    slideshare: { rendertime: 100 },
    directory: { output: "/tmp/out", filename: "title" },
  },
};

mock.module("../src/service/SlideshareDownloader.js", () => ({
  slideshareDownloader: {
    execute: (url: string) => state.slideshareExecute(url) as Promise<void>,
  },
}));

mock.module("../src/service/EverandDownloader.js", () => ({
  everandDownloader: {
    execute: (url: string) => state.everandExecute(url) as Promise<void>,
  },
}));

const resetState = () => {
  state.scribdExecute = mock(() => Effect.void);
  state.slideshareExecute = mock(async () => {});
  state.everandExecute = mock(async () => {});
  state.dirCreate = mock(() => Effect.void);
  state.dirRemove = mock(() => Effect.void);
  state.config = {
    scribd: { rendertime: 100 },
    slideshare: { rendertime: 100 },
    directory: { output: "/tmp/out", filename: "title" },
  };
};

const buildLayer = () => {
  const scribdSvc: ScribdDownloaderService = {
    execute: (url) => state.scribdExecute(url) as ReturnType<ScribdDownloaderService["execute"]>,
  };
  const dirSvc: DirectoryIoService = {
    create: (p) => state.dirCreate(p) as ReturnType<DirectoryIoService["create"]>,
    remove: (p) => state.dirRemove(p) as ReturnType<DirectoryIoService["remove"]>,
  };
  return Layer.provide(
    AppLive,
    Layer.mergeAll(
      Layer.succeed(ScribdDownloader, scribdSvc),
      Layer.succeed(DirectoryIo, dirSvc),
      Layer.succeed(ConfigLoader, state.config),
    ),
  );
};

const runExecute = (url: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const svc = yield* App;
      yield* svc.execute(url);
    }).pipe(Effect.provide(buildLayer())),
  );

const runBatch = (urls: ReadonlyArray<string>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* App;
      return yield* svc.executeBatch(urls);
    }).pipe(Effect.provide(buildLayer())),
  );

const firstFailureTag = (exit: Exit.Exit<unknown, unknown>): string | undefined => {
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    if (failure._tag === "Some") {
      return (failure.value as { _tag: string })._tag;
    }
  }
  return undefined;
};

describe("App", () => {
  beforeEach(() => {
    resetState();
  });

  describe("execute routing", () => {
    test("routes scribd URL to ScribdDownloader and not legacy", async () => {
      // #given
      const url = "https://www.scribd.com/document/123/foo";

      // #when
      const exit = await runExecute(url);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(state.scribdExecute).toHaveBeenCalledTimes(1);
      expect(state.scribdExecute).toHaveBeenCalledWith(url);
      expect(state.slideshareExecute).not.toHaveBeenCalled();
      expect(state.everandExecute).not.toHaveBeenCalled();
    });

    test("routes slideshare URL to legacy slideshare singleton and not Scribd", async () => {
      // #given
      const url = "https://www.slideshare.net/foo/bar";

      // #when
      const exit = await runExecute(url);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(state.slideshareExecute).toHaveBeenCalledTimes(1);
      expect(state.slideshareExecute).toHaveBeenCalledWith(url);
      expect(state.scribdExecute).not.toHaveBeenCalled();
      expect(state.everandExecute).not.toHaveBeenCalled();
    });

    test("routes everand URL to legacy everand singleton", async () => {
      // #given
      const url = "https://www.everand.com/podcast/123/foo";

      // #when
      const exit = await runExecute(url);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(state.everandExecute).toHaveBeenCalledTimes(1);
      expect(state.everandExecute).toHaveBeenCalledWith(url);
      expect(state.scribdExecute).not.toHaveBeenCalled();
      expect(state.slideshareExecute).not.toHaveBeenCalled();
    });

    test("unsupported URL fails with UnsupportedUrl", async () => {
      // #when
      const exit = await runExecute("https://example.com/foo");

      // #then
      expect(Exit.isFailure(exit)).toBe(true);
      expect(firstFailureTag(exit)).toBe("UnsupportedUrl");
    });

    test("legacy slideshare throw maps to LegacyDownloaderFailed", async () => {
      // #given
      state.slideshareExecute = mock(async () => {
        throw new Error("legacy boom");
      });

      // #when
      const exit = await runExecute("https://www.slideshare.net/foo/bar");

      // #then
      expect(Exit.isFailure(exit)).toBe(true);
      expect(firstFailureTag(exit)).toBe("LegacyDownloaderFailed");
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          const e = failure.value as { domain: string; url: string };
          expect(e.domain).toBe("slideshare");
          expect(e.url).toBe("https://www.slideshare.net/foo/bar");
        }
      }
    });

    test("ensures output directory exists before downloading", async () => {
      // #when
      await runExecute("https://www.scribd.com/document/123/foo");

      // #then
      expect(state.dirCreate).toHaveBeenCalledWith("/tmp/out");
    });
  });

  describe("executeBatch", () => {
    test("returns zero-counts report for empty list and never invokes execute", async () => {
      // #when
      const report = await runBatch([]);

      // #then
      expect(report).toEqual({ total: 0, ok: 0, failed: 0, results: [] });
      expect(state.scribdExecute).not.toHaveBeenCalled();
    });

    test("aggregates all successes when every URL succeeds", async () => {
      // #given
      const urls = ["https://www.scribd.com/document/1/a", "https://www.scribd.com/document/2/b", "https://www.scribd.com/document/3/c"];

      // #when
      const report = await runBatch(urls);

      // #then
      expect(state.scribdExecute).toHaveBeenCalledTimes(3);
      expect(report.total).toBe(3);
      expect(report.ok).toBe(3);
      expect(report.failed).toBe(0);
      expect(report.results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    });

    test("continues after a failure and records error message for failed URL", async () => {
      // #given
      state.scribdExecute = mock((url: string) => {
        if (url.includes("/2/")) {
          return Effect.fail(
            new (class {
              readonly _tag = "PageLoadFailed";
              readonly url = url;
              readonly message = "boom";
            })(),
          );
        }
        return Effect.void;
      });
      const urls = ["https://www.scribd.com/document/1/a", "https://www.scribd.com/document/2/b", "https://www.scribd.com/document/3/c"];

      // #when
      const report = await runBatch(urls);

      // #then
      expect(state.scribdExecute).toHaveBeenCalledTimes(3);
      expect(report.total).toBe(3);
      expect(report.ok).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.results[1]!.status).toBe("fail");
      expect(report.results[1]!.url).toBe("https://www.scribd.com/document/2/b");
      expect(report.results[1]!.error).toContain("boom");
    });

    test("captures failures for all URLs when every URL fails", async () => {
      // #given - use unsupported URLs so every one fails with UnsupportedUrl
      const urls = ["https://nope.example/1", "https://nope.example/2"];

      // #when
      const report = await runBatch(urls);

      // #then
      expect(report.ok).toBe(0);
      expect(report.failed).toBe(2);
      expect(report.results.every((r) => r.status === "fail")).toBe(true);
      expect(report.results.every((r) => typeof r.error === "string" && r.error.length > 0)).toBe(true);
    });
  });
});
