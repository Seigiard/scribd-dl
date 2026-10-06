import { beforeEach, describe, expect, mock, spyOn, test, type Mock } from "bun:test";
import { Cause, Effect, Exit, Layer, Predicate } from "effect";
import puppeteer, { type Page } from "puppeteer";
import type { ScraperEvent } from "../src/service/Scraper";
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
  resolve: Mock<TitleResolverService["resolve"]>;
  getPage: Mock<PuppeteerSgService["getPage"]>;
  generatePDF: Mock<PuppeteerSgService["generatePDF"]>;
  merge: Mock<PdfGeneratorService["merge"]>;
  dirCreate: Mock<DirectoryIoService["create"]>;
  dirRemove: Mock<DirectoryIoService["remove"]>;
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
    evaluate: mock(async (fn: Parameters<Page["evaluate"]>[0], ...args: Parameters<Page["evaluate"]>[1][]) => {
      if (state.processPageThrows) throw new Error("evaluate failed");
      // Dispatch by inspecting the evaluated function source. Each ScribdDownloader
      // page.evaluate site carries a unique marker substring; the mock returns the
      // matching fixture so unit tests don't need a real browser.
      const src = String(fn);

      if (src.includes("removeSelectorAll") || src.includes("removeMarginSelectorAll")) {
        return state.processPageResult;
      }

      if (src.includes("next.click()")) {
        return args.length === 0
          ? { visible: state.slideshowVisible.shift() ?? null, outcome: null }
          : { visible: null, outcome: state.slideshowClickOutcomes.shift() ?? "no-next" };
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
  const pageMethods: Partial<Page> = state.page;

  // SAFETY: The downloader only calls evaluate, content and close on this injected
  // page. The fixture implements those methods; no browser-owned Page APIs run.
  const page = pageMethods as Page;
  state.getPage = mock((_url: string) => Effect.succeed(page));
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
    getPage: (url) => state.getPage(url),
    generatePDF: (page, path, opts) => state.generatePDF(page, path, opts),
  };

  const pdfSvc: PdfGeneratorService = {
    merge: (inputs, output) => state.merge(inputs, output),
    setTitle: () => Effect.void,
  };

  const dirSvc: DirectoryIoService = {
    create: (p) => state.dirCreate(p),
    remove: (p) => state.dirRemove(p),
  };

  const titleSvc: TitleResolverService = {
    resolve: (url, id) => state.resolve(url, id),
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
      const failures = exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);
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
    expect(state.generatePDF).toHaveBeenCalledWith(state.page, "/tmp/out/doc.pdf", {
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
    const pdfPath = state.generatePDF.mock.calls[0]![1];
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
    const captured: ScraperEvent[] = [];
    const onEvent = (e: ScraperEvent) => Effect.sync(() => void captured.push(e));

    // #when
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ScribdDownloader;
        yield* svc.execute("https://www.scribd.com/embeds/123/content", "/tmp/out", onEvent);
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
    const captured: ScraperEvent[] = [];
    const onEvent = (e: ScraperEvent) => Effect.sync(() => void captured.push(e));

    // #when
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ScribdDownloader;
        yield* svc.execute("https://www.scribd.com/embeds/123/content", "/tmp/out", onEvent);
      }).pipe(Effect.provide(buildLayer())),
    );

    // #then — 1 Title + 1 Scrape + 3 Render
    const renderCount = captured.filter(Predicate.isTagged("RenderProgress")).length;
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
    const writes: string[] = [];

    const writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(Predicate.isString(chunk) ? chunk : Buffer.from(chunk).toString());

      return true;
    });

    // #when
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ScribdDownloader;
          yield* svc.execute("https://www.scribd.com/embeds/123/content", "/tmp/out", noopOnEvent);
        }).pipe(Effect.provide(buildLayer())),
      );
    } finally {
      writeSpy.mockRestore();
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

      const writeSpy = spyOn(Bun, "write").mockImplementation(async (path, data) => {
        writes.push({ path: String(path), data: String(data) });

        return String(data).length;
      });

      try {
        await run(writes);
      } finally {
        writeSpy.mockRestore();
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
    test("captures every visible slide once when Next changes the outer container asynchronously", async () => {
      // #given
      const browser = await puppeteer.launch({ headless: true });

      try {
        const page = await browser.newPage();
        await page.setContent(`
          <style>
            .not_visible { display: none !important; }
            .newpage { width: 800px; height: 600px; }
          </style>
          <div class="outer_page_container">
            <div class="outer_page not_visible" id="outer_page_0">
              <div class="newpage" id="hidden_content">Hidden preview</div>
            </div>
            <div class="outer_page" id="outer_page_1">
              <div class="newpage" id="content_a">Introduction</div>
            </div>
            <div class="outer_page not_visible" id="outer_page_2">
              <div class="newpage" id="content_b">Evidence</div>
            </div>
            <div class="outer_page not_visible" id="outer_page_3">
              <div class="newpage" id="content_c">Conclusion</div>
            </div>
          </div>
          <button class="right_arrow toolbar_btn" aria-label="Next page">Next</button>
          <script>
            const image = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
            document.querySelectorAll('.newpage').forEach(slide => {
              const img = document.createElement('img');
              img.src = image;
              slide.appendChild(img);
            });
            let current = 1;
            const next = document.querySelector('button');
            next.addEventListener('click', () => {
              setTimeout(() => {
                document.getElementById('outer_page_' + current).classList.add('not_visible');
                current += 1;
                document.getElementById('outer_page_' + current).classList.remove('not_visible');
                if (current === 3) next.setAttribute('aria-disabled', 'true');
              }, 200);
            });
          </script>
        `);
        state.getPage = mock(() => Effect.succeed(page));
        const captures = new Map<string, string>();
        let mergedSlides: string[] = [];
        state.generatePDF = mock((renderPage, path) =>
          Effect.promise(async () => {
            const text = await renderPage.evaluate(() => {
              const slide = document.querySelector(".outer_page:not(.not_visible) .newpage");

              return slide?.textContent ?? "";
            });

            captures.set(path, text);
          }),
        );
        state.merge = mock((inputs) =>
          Effect.sync(() => {
            mergedSlides = inputs.map((path) => captures.get(path) ?? "missing capture");
          }),
        );

        // #when
        const exit = await runExecute("https://www.scribd.com/doc/999/deck");

        // #then
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(mergedSlides).toEqual(["Introduction", "Evidence", "Conclusion"]);
      } finally {
        await browser.close();
      }
    });

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

      for (const call of state.generatePDF.mock.calls) {
        expect(call[2]).toEqual({ width: 1000, height: 773, pageRanges: "1" });
      }

      expect(state.merge).toHaveBeenCalledTimes(1);
      const mergeCall = state.merge.mock.calls[0];
      expect(mergeCall![0].length).toBe(3);
      // temp dir is created and removed (non-debug).
      const createCalls = state.dirCreate.mock.calls.map((c) => c[0]);
      expect(createCalls).toContain("/tmp/out");
      expect(createCalls.some((p) => p.endsWith("_temp"))).toBe(true);
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
        const failures = exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);

        const first = failures[0]!;
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
