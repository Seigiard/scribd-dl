import { afterEach, beforeEach, describe, expect, mock, test, type Mock } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect";
import type { LaunchOptions, Page } from "puppeteer";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  PuppeteerSg,
  makePuppeteerSgLive,
  type BrowserLauncher,
  type BrowserSession,
  type PuppeteerPdfIo,
} from "../src/utils/request/PuppeteerSg";

interface FakePage {
  goto: ReturnType<typeof mock>;
  emulateMediaType: ReturnType<typeof mock>;
  evaluate: ReturnType<typeof mock>;
  pdf: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

interface FakeBrowser {
  newPage: Mock<BrowserSession["newPage"]>;
  close: Mock<BrowserSession["close"]>;
}

interface MockState {
  launch: Mock<BrowserLauncher>;
  lastLaunchOptions: LaunchOptions | undefined;
  page: FakePage;
  browser: FakeBrowser;
  gotoShouldThrow: boolean;
}

const state: MockState = {
  launch: mock(),
  lastLaunchOptions: undefined,
  page: {
    goto: mock(),
    emulateMediaType: mock(),
    evaluate: mock(),
    pdf: mock(),
    close: mock(),
  },
  browser: {
    newPage: mock(),
    close: mock(),
  },
  gotoShouldThrow: false,
};

const resetState = () => {
  state.page = {
    goto: mock(async () => {
      if (state.gotoShouldThrow) throw new Error("goto failed");

      return null;
    }),
    emulateMediaType: mock(async () => {}),
    evaluate: mock(async () => {}),
    pdf: mock(async () => new Uint8Array()),
    close: mock(async () => {}),
  };
  const pageMethods: Partial<Page> = state.page;

  // SAFETY: This injected page implements every Page method the real layer calls:
  // goto, emulateMediaType, evaluate, pdf and close. All other Page APIs remain unused.
  const page = pageMethods as Page;
  state.browser = {
    newPage: mock(async () => page),
    close: mock(async () => {}),
  };
  state.launch = mock(async (opts: LaunchOptions) => {
    state.lastLaunchOptions = opts;

    return state.browser;
  });
  state.lastLaunchOptions = undefined;
  state.gotoShouldThrow = false;
};

const makeTestLayer = () => makePuppeteerSgLive({ headful: false }, state.launch);

type InitializationStage = "goto" | "emulateMediaType" | "evaluate";

const initializationStages: InitializationStage[] = ["goto", "emulateMediaType", "evaluate"];

describe("PuppeteerSg", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "puppeteer-pdf-test-"));
    resetState();
    savedEnv.PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;
    savedEnv.PUPPETEER_NO_SANDBOX = process.env.PUPPETEER_NO_SANDBOX;
    savedEnv.CI = process.env.CI;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_NO_SANDBOX;
    delete process.env.CI;
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("getPage happy path returns page and closes browser when scope exits", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const page = yield* svc.getPage("about:blank");
        expect<Page | FakePage>(page).toBe(state.page);

        return page;
      }).pipe(Effect.provide(makeTestLayer())),
    );

    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.browser.close).toHaveBeenCalledTimes(1);
    expect(state.page.goto).toHaveBeenCalledTimes(1);
    expect(state.page.emulateMediaType).toHaveBeenCalledWith("screen");
    expect(state.page.evaluate).toHaveBeenCalledTimes(1);
  });

  test("getPage error still triggers browser cleanup", async () => {
    state.gotoShouldThrow = true;

    const program = Effect.scoped(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;

        return yield* svc.getPage("about:blank");
      }).pipe(Effect.provide(makeTestLayer())),
    );

    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      const failures = exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);

      const first = failures[0]!;
      expect(first._tag).toBe("PageLoadFailed");
    }

    expect(state.browser.close).toHaveBeenCalledTimes(1);
  });

  test.each(initializationStages)("getPage closes its page when %s fails and preserves that failure if close fails", async (stage) => {
    // #given
    const original = new Error(`${stage} failed`);
    state.page[stage].mockImplementation(async () => {
      throw original;
    });
    state.page.close.mockImplementation(async () => {
      throw new Error("close failed");
    });

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const exit = yield* Effect.exit(svc.getPage("about:blank"));

        if (!Exit.isFailure(exit)) throw new Error("expected initialization failure");
        const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));

        return {
          tag: failure._tag,
          url: failure.url,
          sameCause: Object.is(failure.cause, original),
          closeCalls: state.page.close.mock.calls.length,
        };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({
      tag: "PageLoadFailed",
      url: "about:blank",
      sameCause: true,
      closeCalls: 1,
    });
  });

  test("getPage closes its page when initialization is interrupted", async () => {
    // #given
    const entered = await Effect.runPromise(Deferred.make<void>());
    state.page.goto.mockImplementation(() => {
      Effect.runSync(Deferred.succeed(entered, undefined));

      return new Promise(() => {});
    });

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const fiber = yield* Effect.forkChild(svc.getPage("about:blank"));
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);

        if (!Exit.isFailure(exit)) throw new Error("expected interruption");

        return {
          interrupted: Cause.hasInterruptsOnly(exit.cause),
          closeCalls: state.page.close.mock.calls.length,
        };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({ interrupted: true, closeCalls: 1 });
  });

  test("getPage transfers a successfully initialized page to its caller without closing it", async () => {
    // #given
    const program = Effect.gen(function* () {
      const svc = yield* PuppeteerSg;
      const page = yield* svc.getPage("about:blank");

      return {
        samePage: Object.is(page, state.page),
        closeCalls: state.page.close.mock.calls.length,
      };
    }).pipe(Effect.provide(makeTestLayer()), Effect.scoped);

    // #when
    const result = await Effect.runPromise(program);

    // #then
    expect(result).toEqual({ samePage: true, closeCalls: 0 });
  });

  test.each(initializationStages)(
    "production acquireRelease nesting can interrupt pending %s and close the page promptly",
    async (stage) => {
      // #given
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      state.page[stage].mockImplementation(() => {
        entered.resolve();

        return release.promise;
      });

      // #when
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PuppeteerSg;

          const fiber = yield* Effect.forkChild(
            Effect.scoped(Effect.acquireRelease(svc.getPage("about:blank"), (page) => Effect.promise(() => page.close()))),
          );

          yield* Effect.promise(() => entered.promise);
          const interruption = Effect.runPromise(Fiber.interrupt(fiber));

          const prompt = yield* Effect.promise(() =>
            Promise.race([interruption.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))]),
          );

          const closeCallsAtCancellation = state.page.close.mock.calls.length;
          release.resolve();
          yield* Effect.promise(() => interruption);

          return { prompt, closeCallsAtCancellation };
        }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
      );

      // #then
      expect(result).toEqual({ prompt: true, closeCallsAtCancellation: 1 });
    },
  );

  test.each(["direct", "acquireRelease"])("late newPage is closed without blocking cancellation for the %s caller", async (caller) => {
    // #given
    const entered = Promise.withResolvers<void>();
    const allocation = Promise.withResolvers<Page>();
    const closed = Promise.withResolvers<void>();
    const page = await state.browser.newPage();
    state.browser.newPage.mockImplementation(() => {
      entered.resolve();

      return allocation.promise;
    });
    state.page.close.mockImplementation(async () => {
      closed.resolve();
    });

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const getPage = svc.getPage("about:blank");

        const acquire =
          caller === "acquireRelease"
            ? Effect.scoped(Effect.acquireRelease(getPage, (allocated) => Effect.promise(() => allocated.close())))
            : getPage;

        const fiber = yield* Effect.forkChild(acquire);
        yield* Effect.promise(() => entered.promise);
        const interruption = Effect.runPromise(Fiber.interrupt(fiber));

        const prompt = yield* Effect.promise(() =>
          Promise.race([interruption.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))]),
        );

        allocation.resolve(page);
        yield* Effect.promise(() => interruption);

        const latePageClosed = yield* Effect.promise(() =>
          Promise.race([closed.promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))]),
        );

        return { prompt, latePageClosed, closeCalls: state.page.close.mock.calls.length };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({ prompt: true, latePageClosed: true, closeCalls: 1 });
  });

  test("interrupt invokes browser cleanup", async () => {
    state.browser.newPage = mock(() => new Promise(() => {}));

    const program = Effect.scoped(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;

        return yield* svc.getPage("about:blank");
      }).pipe(Effect.provide(makeTestLayer())),
    );

    const fiber = Effect.runFork(program);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(state.browser.close).toHaveBeenCalledTimes(1);
  });

  test("PUPPETEER_EXECUTABLE_PATH passed through to launch options", async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = "/fake/chrome";
    const program = Effect.scoped(Effect.void.pipe(Effect.provide(makeTestLayer())));
    await Effect.runPromise(program);
    expect(state.lastLaunchOptions!.executablePath).toBe("/fake/chrome");
  });

  test("PUPPETEER_NO_SANDBOX adds sandbox args", async () => {
    process.env.PUPPETEER_NO_SANDBOX = "true";
    const program = Effect.scoped(Effect.void.pipe(Effect.provide(makeTestLayer())));
    await Effect.runPromise(program);
    const opts = state.lastLaunchOptions!;
    expect(opts.args).toEqual(["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]);
  });

  describe("headful parameterization", () => {
    test("headless layer uses headless: true", async () => {
      // #given
      const program = Effect.scoped(Effect.void.pipe(Effect.provide(makeTestLayer())));

      // #when
      await Effect.runPromise(program);

      // #then
      expect(state.lastLaunchOptions!.headless).toBe(true);
    });

    test("makePuppeteerSgLive({ headful: true }) uses headless: false", async () => {
      // #given
      const program = Effect.scoped(Effect.void.pipe(Effect.provide(makePuppeteerSgLive({ headful: true }, state.launch))));

      // #when
      await Effect.runPromise(program);

      // #then
      expect(state.lastLaunchOptions!.headless).toBe(false);
    });

    test("makePuppeteerSgLive({ headful: false }) uses headless: true", async () => {
      // #given
      const program = Effect.scoped(Effect.void.pipe(Effect.provide(makePuppeteerSgLive({ headful: false }, state.launch))));

      // #when
      await Effect.runPromise(program);

      // #then
      expect(state.lastLaunchOptions!.headless).toBe(true);
    });
  });

  test("generatePDF commits returned bytes to the requested path and preserves rendering options", async () => {
    // #given
    const pdfPath = path.join(tmpDir, "result.pdf");
    const bytes = new TextEncoder().encode("%PDF-1.7\nrendered\n");

    const render: Page["pdf"] = async (options) => {
      if (options?.path) await fs.writeFile(options.path, bytes);

      return bytes;
    };

    state.page.pdf.mockImplementation(render);
    const page = await state.browser.newPage();

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        yield* svc.generatePDF(page, pdfPath, { width: 100, height: 200, pageRanges: "1" });
        const contents = yield* Effect.promise(() => fs.readFile(pdfPath, "utf8"));

        return { contents, pdfOptions: state.page.pdf.mock.calls[0]?.[0] };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({
      contents: "%PDF-1.7\nrendered\n",
      pdfOptions: {
        printBackground: true,
        timeout: 0,
        width: 100,
        height: 200,
        pageRanges: "1",
      },
    });
  });

  test("canceling pending rendering cannot overwrite the next PDF when the old browser promise resolves", async () => {
    // #given
    const pdfPath = path.join(tmpDir, "same-document.pdf");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const rendered = Promise.withResolvers<void>();
    const oldBytes = new TextEncoder().encode("%PDF-1.7\nold\n");
    const newBytes = new TextEncoder().encode("%PDF-1.7\nnew\n");

    const oldRender: Page["pdf"] = async (options) => {
      entered.resolve();
      await release.promise;

      if (options?.path) await fs.writeFile(options.path, oldBytes);
      rendered.resolve();

      return oldBytes;
    };

    state.page.pdf.mockImplementation(oldRender);
    const page = await state.browser.newPage();

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const first = yield* Effect.forkChild(svc.generatePDF(page, pdfPath));
        yield* Effect.promise(() => entered.promise);
        yield* Fiber.interrupt(first);
        const exit = yield* Fiber.await(first);

        if (!Exit.isFailure(exit)) throw new Error("expected interrupted rendering");

        const newRender: Page["pdf"] = async (options) => {
          if (options?.path) await fs.writeFile(options.path, newBytes);

          return newBytes;
        };

        state.page.pdf.mockImplementation(newRender);
        yield* svc.generatePDF(page, pdfPath);
        release.resolve();
        yield* Effect.promise(() => rendered.promise);
        const contents = yield* Effect.promise(() => fs.readFile(pdfPath, "utf8"));

        return { interrupted: Cause.hasInterruptsOnly(exit.cause), contents };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({ interrupted: true, contents: "%PDF-1.7\nnew\n" });
  });

  test("wider rendering options cannot create a PDF at an incidental path", async () => {
    // #given
    const pdfPath = path.join(tmpDir, "requested.pdf");
    const incidentalPath = path.join(tmpDir, "incidental.pdf");
    const options = { width: 100, height: 200, pageRanges: "1", path: incidentalPath };
    const bytes = new TextEncoder().encode("%PDF-1.7\nrequested\n");

    const render: Page["pdf"] = async (renderOptions) => {
      if (renderOptions?.path) await fs.writeFile(renderOptions.path, bytes);

      return bytes;
    };

    state.page.pdf.mockImplementation(render);
    const page = await state.browser.newPage();

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        yield* svc.generatePDF(page, pdfPath, options);
        const contents = yield* Effect.promise(() => fs.readFile(pdfPath, "utf8"));
        const files = yield* Effect.promise(() => fs.readdir(tmpDir));

        return { contents, files };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({ contents: "%PDF-1.7\nrequested\n", files: ["requested.pdf"] });
  });

  test("canceling a started PDF write waits until its bytes are committed", async () => {
    // #given
    const pdfPath = path.join(tmpDir, "writing.pdf");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const bytes = new TextEncoder().encode("%PDF-1.7\ncommitted\n");

    const io: PuppeteerPdfIo = {
      writeFile: async (...args) => {
        entered.resolve();
        await release.promise;
        await fs.writeFile(...args);
        finished.resolve();
      },
    };

    const render: Page["pdf"] = async (options) => {
      if (options?.path) await io.writeFile(options.path, bytes);

      return bytes;
    };

    state.page.pdf.mockImplementation(render);
    const page = await state.browser.newPage();
    const layer = makePuppeteerSgLive({ headful: false }, state.launch, io);

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const fiber = yield* Effect.forkChild(svc.generatePDF(page, pdfPath));
        yield* Effect.promise(() => entered.promise);
        const interruption = Effect.runPromise(Fiber.interrupt(fiber));

        const canceledBeforeCommit = yield* Effect.promise(() =>
          Promise.race([interruption.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))]),
        );

        release.resolve();
        yield* Effect.promise(() => interruption);
        const exit = yield* Fiber.await(fiber);
        yield* Effect.promise(() => finished.promise);

        if (!Exit.isFailure(exit)) throw new Error("expected interrupted PDF generation");
        const contents = yield* Effect.promise(() => fs.readFile(pdfPath, "utf8"));

        return { canceledBeforeCommit, interrupted: Cause.hasInterruptsOnly(exit.cause), contents };
      }).pipe(Effect.provide(layer), Effect.scoped),
    );

    // #then
    expect(result).toEqual({
      canceledBeforeCommit: false,
      interrupted: true,
      contents: "%PDF-1.7\ncommitted\n",
    });
  });

  test("generatePDF preserves a rendering failure and its requested output path", async () => {
    // #given
    const pdfPath = path.join(tmpDir, "render-failed.pdf");
    const cause = new Error("render failed");
    state.page.pdf.mockImplementation(async () => {
      throw cause;
    });
    const page = await state.browser.newPage();

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const exit = yield* Effect.exit(svc.generatePDF(page, pdfPath));

        if (!Exit.isFailure(exit)) throw new Error("expected PDF generation failure");
        const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));

        return {
          tag: failure._tag,
          path: failure.path,
          sameCause: Object.is(failure.cause, cause),
        };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({ tag: "PdfGenerationFailed", path: pdfPath, sameCause: true });
  });

  test("generatePDF exposes an output filesystem failure through its typed error channel", async () => {
    // #given
    const pdfPath = path.join(tmpDir, "missing", "write-failed.pdf");
    const bytes = new TextEncoder().encode("%PDF-1.7\nrendered\n");

    const render: Page["pdf"] = async (options) => {
      if (options?.path) await fs.writeFile(options.path, bytes);

      return bytes;
    };

    state.page.pdf.mockImplementation(render);
    const page = await state.browser.newPage();

    // #when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const exit = yield* Effect.exit(svc.generatePDF(page, pdfPath));

        if (!Exit.isFailure(exit)) throw new Error("expected PDF output write failure");
        const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));

        const errno = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(failure.cause);

        return { tag: failure._tag, path: failure.path, code: errno.code };
      }).pipe(Effect.provide(makeTestLayer()), Effect.scoped),
    );

    // #then
    expect(result).toEqual({ tag: "PdfGenerationFailed", path: pdfPath, code: "ENOENT" });
  });
});
