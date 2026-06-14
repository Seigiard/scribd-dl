import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import type { Page } from "puppeteer";
import { ScribdDownloader, ScribdDownloaderLive } from "../src/service/ScribdDownloader";
import { PuppeteerSg, type PuppeteerSgService } from "../src/utils/request/PuppeteerSg";
import { PdfGenerator, type PdfGeneratorService } from "../src/utils/io/PdfGenerator";
import { ConfigLoader, type ConfigData } from "../src/utils/io/ConfigLoader";
import { DirectoryIo, type DirectoryIoService } from "../src/utils/io/DirectoryIo";
import { TitleResolver, type TitleResolverService } from "../src/utils/request/TitleResolver";

interface FakePage {
  evaluate: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  content: ReturnType<typeof mock>;
}

interface MockState {
  page: FakePage;
  processPageResult: { pages: Array<{ id: string; width: number; height: number }> };
  processPageThrows: boolean;
  resolvedTitle: string;
  isSlideshow: boolean;
  slideshowVisible: Array<{ id: string; width: number; height: number } | null>;
  slideshowClickOutcomes: Array<"changed" | "disabled" | "no-next" | "no-change">;
  resolve: ReturnType<typeof mock>;
  getPage: ReturnType<typeof mock>;
  generatePDF: ReturnType<typeof mock>;
  merge: ReturnType<typeof mock>;
  dirCreate: ReturnType<typeof mock>;
  dirRemove: ReturnType<typeof mock>;
  config: ConfigData;
}

const state: MockState = {
  page: { evaluate: mock(), close: mock(), content: mock() },
  processPageResult: { pages: [] },
  processPageThrows: false,
  resolvedTitle: "doc",
  isSlideshow: false,
  slideshowVisible: [],
  slideshowClickOutcomes: [],
  resolve: mock(),
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
  state.processPageResult = { pages: [] };
  state.processPageThrows = false;
  state.resolvedTitle = "doc";
  state.isSlideshow = false;
  state.slideshowVisible = [];
  state.slideshowClickOutcomes = [];
  state.page = {
    evaluate: mock(async (fn: unknown, ..._args: unknown[]) => {
      if (state.processPageThrows) throw new Error("evaluate failed");
      // Dispatch by inspecting the evaluated function source. Each ScribdDownloader
      // page.evaluate site carries a unique marker substring; the mock returns the
      // matching fixture so unit tests don't need a real browser.
      const src = String(fn);
      if (src.includes("removeSelectorAll") || src.includes("removeMarginSelectorAll")) {
        return state.processPageResult;
      }
      if (src.includes("next.click()")) {
        return state.slideshowClickOutcomes.shift() ?? "no-next";
      }
      if (src.includes("naturalWidth")) {
        return undefined;
      }
      if (src.includes("getBoundingClientRect")) {
        return state.slideshowVisible.shift() ?? null;
      }
      if (src.includes("querySelector(selector)")) {
        return state.isSlideshow;
      }
      return state.processPageResult;
    }),
    close: mock(async () => {}),
    content: mock(async () => "<html><body>fake content</body></html>"),
  };
  state.resolve = mock((_url: string, _id: string) => Effect.succeed(state.resolvedTitle));
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
  const titleSvc: TitleResolverService = {
    resolve: (url, id) => state.resolve(url, id) as ReturnType<TitleResolverService["resolve"]>,
  };
  return Layer.provide(
    ScribdDownloaderLive,
    Layer.mergeAll(
      Layer.succeed(PuppeteerSg, puppeteerSvc),
      Layer.succeed(PdfGenerator, pdfSvc),
      Layer.succeed(ConfigLoader, state.config),
      Layer.succeed(DirectoryIo, dirSvc),
      Layer.succeed(TitleResolver, titleSvc),
    ),
  );
};

const noopOnEvent = () => Effect.void;

const runExecute = (url: string, folder = "/tmp/out", debug?: boolean) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const svc = yield* ScribdDownloader;
      yield* svc.execute(url, folder, noopOnEvent, debug);
    }).pipe(Effect.provide(buildLayer())),
  );

describe("ScribdDownloader", () => {
  beforeEach(() => {
    resetState();
  });

  test("routes DOCUMENT URL to embed URL", async () => {
    // #given
    state.resolvedTitle = "doc";
    state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/document/123/foo");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.getPage).toHaveBeenCalledWith("https://www.scribd.com/embeds/123/content");
  });

  test("routes EMBED URL as-is", async () => {
    // #given
    state.resolvedTitle = "doc";
    state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

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
        if (c._tag === "Fail") failures.push((c as unknown as { error: { _tag: string } }).error);
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
    state.resolvedTitle = "doc";
    state.processPageResult = {
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
    expect(state.dirCreate.mock.calls.some((c) => String(c[0]).includes("_temp"))).toBe(false);
  });

  test("multi-dimension path: create temp dir, multi generatePDF, merge, remove temp dir", async () => {
    // #given
    state.resolvedTitle = "doc";
    state.processPageResult = {
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

  test("filename strategy 'title' uses sanitized title from resolver", async () => {
    // #given
    state.config = { ...state.config, directory: { output: "/tmp/out", filename: "title" } };
    state.resolvedTitle = "My Doc";
    state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/123/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.generatePDF.mock.calls[0]![1]).toBe("/tmp/out/My Doc.pdf");
  });

  test("filename strategy 'id' skips resolver and uses document id", async () => {
    // #given
    state.config = { ...state.config, directory: { output: "/tmp/out", filename: "id" } };
    state.resolvedTitle = "My Doc"; // would be used if resolver were consulted
    state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    const exit = await runExecute("https://www.scribd.com/embeds/789/content");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.generatePDF.mock.calls[0]![1]).toBe("/tmp/out/789.pdf");
  });

  test("title with unsafe chars is sanitized", async () => {
    // #given
    state.resolvedTitle = "foo/bar*baz";
    state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

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

  test("emits TitleResolved + ScrapeProgress + RenderProgress for single-dim run", async () => {
    // #given
    state.resolvedTitle = "doc";
    state.processPageResult = {
      pages: [
        { id: "p1", width: 800, height: 600 },
        { id: "p2", width: 800, height: 600 },
      ],
    };
    const captured: Array<{ _tag: string }> = [];
    const onEvent = (e: { _tag: string }) => Effect.sync(() => void captured.push(e));

    // #when
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ScribdDownloader;
        yield* svc.execute("https://www.scribd.com/embeds/123/content", "/tmp/out", onEvent as Parameters<typeof svc.execute>[2]);
      }).pipe(Effect.provide(buildLayer())),
    );

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(captured.map((e) => e._tag)).toEqual(["TitleResolved", "ScrapeProgress", "RenderProgress"]);
  });

  test("emits RenderProgress N times for N groups (multi-dim)", async () => {
    // #given
    state.resolvedTitle = "doc";
    state.processPageResult = {
      pages: [
        { id: "p1", width: 800, height: 600 },
        { id: "p2", width: 1000, height: 700 },
        { id: "p3", width: 1200, height: 800 },
      ],
    };
    const captured: Array<{ _tag: string }> = [];
    const onEvent = (e: { _tag: string }) => Effect.sync(() => void captured.push(e));

    // #when
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ScribdDownloader;
        yield* svc.execute("https://www.scribd.com/embeds/123/content", "/tmp/out", onEvent as Parameters<typeof svc.execute>[2]);
      }).pipe(Effect.provide(buildLayer())),
    );

    // #then — 1 Title + 1 Scrape + 3 Render
    const renderCount = captured.filter((e) => e._tag === "RenderProgress").length;
    expect(renderCount).toBe(3);
  });

  test("does not write to stdout during execute", async () => {
    // #given
    state.resolvedTitle = "doc";
    state.processPageResult = {
      pages: [
        { id: "p1", width: 800, height: 600 },
        { id: "p2", width: 1000, height: 700 },
      ],
    };
    const originalWrite = process.stdout.write.bind(process.stdout);
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    // #when
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ScribdDownloader;
          yield* svc.execute("https://www.scribd.com/embeds/123/content", "/tmp/out", noopOnEvent);
        }).pipe(Effect.provide(buildLayer())),
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    // #then
    expect(writes).toHaveLength(0);
  });

  test("happy single-dim path runs to completion via runPromise", async () => {
    // #given
    state.resolvedTitle = "doc";
    state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

    // #when
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ScribdDownloader;
        yield* svc.execute("https://www.scribd.com/embeds/123/content", "/tmp/out", noopOnEvent);
      }).pipe(Effect.provide(buildLayer())),
    );

    // #then
    expect(state.generatePDF).toHaveBeenCalledTimes(1);
  });

  describe("canHandle", () => {
    const callCanHandle = (url: string) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ScribdDownloader;
          return svc.canHandle(url);
        }).pipe(Effect.provide(buildLayer())),
      );

    test("returns true for scribd document URL", async () => {
      // #given
      const url = "https://www.scribd.com/document/123/foo";

      // #when
      const result = await callCanHandle(url);

      // #then
      expect(result).toBe(true);
    });

    test("returns false for non-scribd URL", async () => {
      // #given
      const url = "https://example.com/foo";

      // #when
      const result = await callCanHandle(url);

      // #then
      expect(result).toBe(false);
    });

    test("id is 'scribd'", async () => {
      // #when
      const id = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ScribdDownloader;
          return svc.id;
        }).pipe(Effect.provide(buildLayer())),
      );

      // #then
      expect(id).toBe("scribd");
    });
  });

  describe("debug=true behavior", () => {
    const withBunWriteSpy = async (run: (writes: Array<{ path: string; data: string }>) => Promise<void>) => {
      const writes: Array<{ path: string; data: string }> = [];
      const originalBunWrite = Bun.write;
      Bun.write = (async (path: unknown, data: unknown) => {
        writes.push({ path: String(path), data: String(data) });
        return String(data).length;
      }) as typeof Bun.write;

      try {
        await run(writes);
      } finally {
        Bun.write = originalBunWrite;
      }
    };

    test("dumps page HTML to <folder>/<safeIdentifier>.debug.html", async () => {
      // #given
      state.resolvedTitle = "doc";
      state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };
      state.page.content = mock(async () => "<html><body>scribd page</body></html>");

      // #when
      await withBunWriteSpy(async (bunWrites) => {
        await runExecute("https://www.scribd.com/embeds/123/content", "/tmp/out", true);

        // #then
        const htmlWrite = bunWrites.find((w) => w.path.endsWith(".debug.html"));
        expect(htmlWrite).toBeDefined();
        expect(htmlWrite!.path).toBe("/tmp/out/doc.debug.html");
        expect(htmlWrite!.data).toBe("<html><body>scribd page</body></html>");
      });
    });

    test("multi-dim run preserves _temp directory (no dirRemove)", async () => {
      // #given
      state.resolvedTitle = "doc";
      state.processPageResult = {
        pages: [
          { id: "p1", width: 800, height: 600 },
          { id: "p2", width: 1000, height: 700 },
        ],
      };

      // #when
      await withBunWriteSpy(async () => {
        await runExecute("https://www.scribd.com/embeds/123/content", "/tmp/out", true);
      });

      // #then
      expect(state.dirCreate).toHaveBeenCalledWith("/tmp/out/doc_temp");
      expect(state.dirRemove).not.toHaveBeenCalled();
    });

    test("debug=false (default) removes _temp directory as before", async () => {
      // #given
      state.resolvedTitle = "doc";
      state.processPageResult = {
        pages: [
          { id: "p1", width: 800, height: 600 },
          { id: "p2", width: 1000, height: 700 },
        ],
      };

      // #when
      await withBunWriteSpy(async () => {
        await runExecute("https://www.scribd.com/embeds/123/content", "/tmp/out", false);
      });

      // #then
      expect(state.dirRemove).toHaveBeenCalledWith("/tmp/out/doc_temp");
    });

    test("debug omitted does not dump HTML", async () => {
      // #given
      state.resolvedTitle = "doc";
      state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

      // #when
      await withBunWriteSpy(async (bunWrites) => {
        await runExecute("https://www.scribd.com/embeds/123/content", "/tmp/out");

        // #then
        const htmlWrite = bunWrites.find((w) => w.path.endsWith(".debug.html"));
        expect(htmlWrite).toBeUndefined();
      });
    });
  });

  describe("slideshow detection and click-through", () => {
    test("slideshow path: per-page generatePDF + merge, scrollable processPage never runs", async () => {
      // #given
      state.resolvedTitle = "deck";
      state.isSlideshow = true;
      state.slideshowVisible = [
        { id: "outer_page_1", width: 1000, height: 773 },
        { id: "outer_page_2", width: 1000, height: 773 },
        { id: "outer_page_3", width: 1000, height: 773 },
      ];
      // After page 3, click returns no-next → loop ends.
      state.slideshowClickOutcomes = ["changed", "changed", "no-next"];

      // #when
      const exit = await runExecute("https://www.scribd.com/doc/999/deck");

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(state.generatePDF).toHaveBeenCalledTimes(3);
      expect(state.merge).toHaveBeenCalledTimes(1);
      const mergeCall = state.merge.mock.calls[0];
      expect((mergeCall![0] as string[]).length).toBe(3);
      // temp dir is created and removed (non-debug).
      const createCalls = state.dirCreate.mock.calls.map((c) => c[0]);
      expect(createCalls).toContain("/tmp/out");
      expect(createCalls.some((p) => (p as string).endsWith("_temp"))).toBe(true);
      expect(state.dirRemove).toHaveBeenCalledTimes(1);
    });

    test("scrollable path (no slideshow markers) still runs existing processPage flow", async () => {
      // #given
      state.resolvedTitle = "doc";
      state.isSlideshow = false;
      state.processPageResult = { pages: [{ id: "p1", width: 800, height: 600 }] };

      // #when
      const exit = await runExecute("https://www.scribd.com/document/123/foo");

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(state.generatePDF).toHaveBeenCalledTimes(1);
      expect(state.merge).toHaveBeenCalledTimes(0);
    });

    test("slideshow with zero captured pages fails with PageProcessFailed", async () => {
      // #given
      state.resolvedTitle = "empty";
      state.isSlideshow = true;
      // No visible page at all on first try.
      state.slideshowVisible = [null];
      state.slideshowClickOutcomes = [];

      // #when
      const exit = await runExecute("https://www.scribd.com/doc/0/empty");

      // #then
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failures = Array.from(
          (function* walk(c: { _tag: string } & Record<string, unknown>): Generator<unknown> {
            if (c._tag === "Fail") yield (c as unknown as { error: unknown }).error;
            else if (c._tag === "Sequential" || c._tag === "Parallel") {
              yield* walk(c.left as never);
              yield* walk(c.right as never);
            }
          })(exit.cause as never),
        );
        const first = failures[0] as { _tag: string };
        expect(first._tag).toBe("PageProcessFailed");
      }
      expect(state.merge).toHaveBeenCalledTimes(0);
    });

    test("slideshow respects same page id reappearing (loop guard)", async () => {
      // #given — Scribd returns to page 1 after page 2 → loop exits.
      state.resolvedTitle = "loop";
      state.isSlideshow = true;
      state.slideshowVisible = [
        { id: "outer_page_1", width: 800, height: 600 },
        { id: "outer_page_2", width: 800, height: 600 },
        { id: "outer_page_1", width: 800, height: 600 },
      ];
      state.slideshowClickOutcomes = ["changed", "changed", "changed"];

      // #when
      const exit = await runExecute("https://www.scribd.com/doc/777/loop");

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      // First two unique ids captured; third (repeat of outer_page_1) breaks the loop.
      expect(state.generatePDF).toHaveBeenCalledTimes(2);
    });
  });
});
