import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import type { Page } from "puppeteer";
import { ScribdDownloader, ScribdDownloaderLive } from "../src/service/ScribdDownloader";
import { PuppeteerSg, type PuppeteerSgService } from "../src/utils/request/PuppeteerSg";
import { PdfGenerator, type PdfGeneratorService } from "../src/utils/io/PdfGenerator";
import { ConfigLoader, type ConfigData } from "../src/utils/io/ConfigLoader";
import { DirectoryIo, type DirectoryIoService } from "../src/utils/io/DirectoryIo";

interface FakePage {
  evaluate: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

interface MockState {
  page: FakePage;
  processPageResult: { title: string | null; pages: Array<{ id: string; width: number; height: number }> };
  processPageThrows: boolean;
  getPage: ReturnType<typeof mock>;
  generatePDF: ReturnType<typeof mock>;
  merge: ReturnType<typeof mock>;
  dirCreate: ReturnType<typeof mock>;
  dirRemove: ReturnType<typeof mock>;
  config: ConfigData;
}

const state: MockState = {
  page: { evaluate: mock(), close: mock() },
  processPageResult: { title: null, pages: [] },
  processPageThrows: false,
  getPage: mock(),
  generatePDF: mock(),
  merge: mock(),
  dirCreate: mock(),
  dirRemove: mock(),
  config: {
    scribd: { rendertime: 100 },
    directory: { output: "/tmp/out", filename: "title" },
  },
};

const resetState = () => {
  state.processPageResult = { title: null, pages: [] };
  state.processPageThrows = false;
  state.page = {
    evaluate: mock(async () => {
      if (state.processPageThrows) throw new Error("evaluate failed");
      return state.processPageResult;
    }),
    close: mock(async () => {}),
  };
  state.getPage = mock((_url: string) => Effect.succeed(state.page as unknown as Page));
  state.generatePDF = mock(() => Effect.void);
  state.merge = mock(() => Effect.void);
  state.dirCreate = mock(() => Effect.void);
  state.dirRemove = mock(() => Effect.void);
  state.config = {
    scribd: { rendertime: 100 },
    directory: { output: "/tmp/out", filename: "title" },
  };
};

const buildLayer = () => {
  const puppeteerSvc: PuppeteerSgService = {
    getPage: (url) => state.getPage(url) as ReturnType<PuppeteerSgService["getPage"]>,
    generatePDF: (page, path, opts) => state.generatePDF(page, path, opts) as ReturnType<PuppeteerSgService["generatePDF"]>,
  };
  const pdfSvc: PdfGeneratorService = {
    merge: (inputs, output) => state.merge(inputs, output) as ReturnType<PdfGeneratorService["merge"]>,
  };
  const dirSvc: DirectoryIoService = {
    create: (p) => state.dirCreate(p) as ReturnType<DirectoryIoService["create"]>,
    remove: (p) => state.dirRemove(p) as ReturnType<DirectoryIoService["remove"]>,
  };
  return Layer.provide(
    ScribdDownloaderLive,
    Layer.mergeAll(
      Layer.succeed(PuppeteerSg, puppeteerSvc),
      Layer.succeed(PdfGenerator, pdfSvc),
      Layer.succeed(ConfigLoader, state.config),
      Layer.succeed(DirectoryIo, dirSvc),
    ),
  );
};

const runExecute = (url: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const svc = yield* ScribdDownloader;
      yield* svc.execute(url);
    }).pipe(Effect.provide(buildLayer())),
  );

describe("ScribdDownloader", () => {
  beforeEach(() => {
    resetState();
  });

  test("routes DOCUMENT URL to embed URL", async () => {
    // #given
    state.processPageResult = { title: "doc", pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/document/123/foo");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.getPage).toHaveBeenCalledWith("https://www.scribd.com/embeds/123/content");
  });

  test("routes EMBED URL as-is", async () => {
    // #given
    state.processPageResult = { title: "doc", pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/456/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.getPage).toHaveBeenCalledWith("https://www.scribd.com/embeds/456/content");
  });

  test("unsupported URL fails with UnsupportedUrl", async () => {
    // #when
    const exit = await runExecute("https://example.com/foo");

    // #then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failures: Array<{ _tag: string }> = [];
      const walk = (c: { _tag: string } & Record<string, unknown>): void => {
        if (c._tag === "Fail") failures.push((c as { error: { _tag: string } }).error);
        else if (c._tag === "Sequential" || c._tag === "Parallel") {
          walk(c.left as never);
          walk(c.right as never);
        }
      };
      walk(exit.cause as never);
      expect(failures[0]!._tag).toBe("UnsupportedUrl");
    }
  });

  test("single-dimension path: one generatePDF, no merge, no temp dir", async () => {
    // #given
    state.processPageResult = {
      title: "doc",
      pages: [
        { id: "p1", width: 800, height: 600 },
        { id: "p2", width: 800, height: 600 },
        { id: "p3", width: 800, height: 600 },
      ],
    };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/123/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.generatePDF).toHaveBeenCalledTimes(1);
    expect(state.generatePDF).toHaveBeenCalledWith(state.page as unknown as Page, "/tmp/out/doc.pdf", {
      width: 800,
      height: 600,
    });
    expect(state.merge).not.toHaveBeenCalled();
    expect(state.dirCreate).not.toHaveBeenCalled();
  });

  test("multi-dimension path: create temp dir, multi generatePDF, merge, remove temp dir", async () => {
    // #given
    state.processPageResult = {
      title: "doc",
      pages: [
        { id: "p1", width: 800, height: 600 },
        { id: "p2", width: 800, height: 600 },
        { id: "p3", width: 1000, height: 700 },
        { id: "p4", width: 1000, height: 700 },
      ],
    };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/123/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.dirCreate).toHaveBeenCalledWith("/tmp/out/doc_temp");
    expect(state.generatePDF).toHaveBeenCalledTimes(2);
    expect(state.merge).toHaveBeenCalledTimes(1);
    expect(state.dirRemove).toHaveBeenCalledWith("/tmp/out/doc_temp");
  });

  test("filename strategy 'title' uses sanitized title", async () => {
    // #given
    state.config = { ...state.config, directory: { output: "/tmp/out", filename: "title" } };
    state.processPageResult = { title: "My Doc", pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/123/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.generatePDF.mock.calls[0]![1]).toBe("/tmp/out/My Doc.pdf");
  });

  test("filename strategy 'id' falls back to document id", async () => {
    // #given
    state.config = { ...state.config, directory: { output: "/tmp/out", filename: "id" } };
    state.processPageResult = { title: "My Doc", pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/789/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.generatePDF.mock.calls[0]![1]).toBe("/tmp/out/789.pdf");
  });

  test("title with unsafe chars is sanitized", async () => {
    // #given
    state.processPageResult = { title: "foo/bar*baz", pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/123/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    const pdfPath = state.generatePDF.mock.calls[0]![1] as string;
    expect(pdfPath).not.toContain("/bar");
    expect(pdfPath).not.toContain("*");
    expect(pdfPath).toContain("foobarbaz");
  });

  test("page is closed when processPage throws (Scope finalizer)", async () => {
    // #given
    state.processPageThrows = true;

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/123/content");

    // #then
    expect(Exit.isFailure(exit)).toBe(true);
    expect(state.page.close).toHaveBeenCalledTimes(1);
  });

  test("happy single-dim path runs to completion via runPromise", async () => {
    // #given
    state.processPageResult = { title: "doc", pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ScribdDownloader;
        yield* svc.execute("https://www.scribd.com/embeds/123/content");
      }).pipe(Effect.provide(buildLayer())),
    );

    // #then
    expect(state.generatePDF).toHaveBeenCalledTimes(1);
  });
});
