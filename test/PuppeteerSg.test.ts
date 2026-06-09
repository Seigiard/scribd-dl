import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";

interface FakePage {
  goto: ReturnType<typeof mock>;
  emulateMediaType: ReturnType<typeof mock>;
  evaluate: ReturnType<typeof mock>;
  pdf: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

interface FakeBrowser {
  newPage: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

interface MockState {
  launch: ReturnType<typeof mock>;
  lastLaunchOptions: unknown;
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
  state.browser = {
    newPage: mock(async () => state.page),
    close: mock(async () => {}),
  };
  state.launch = mock(async (opts: unknown) => {
    state.lastLaunchOptions = opts;
    return state.browser;
  });
  state.lastLaunchOptions = undefined;
  state.gotoShouldThrow = false;
};

resetState();

await mock.module("puppeteer", () => ({
  default: {
    launch: (opts: unknown) => state.launch(opts),
  },
  launch: (opts: unknown) => state.launch(opts),
}));

const { PuppeteerSg, PuppeteerSgLive } = await import("../src/utils/request/PuppeteerSg.ts");

describe("PuppeteerSg", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    resetState();
    savedEnv.PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;
    savedEnv.PUPPETEER_NO_SANDBOX = process.env.PUPPETEER_NO_SANDBOX;
    savedEnv.CI = process.env.CI;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_NO_SANDBOX;
    delete process.env.CI;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("getPage happy path returns page and closes browser when scope exits", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const page = yield* svc.getPage("about:blank");
        expect(page).toBe(state.page as never);
        return page;
      }).pipe(Effect.provide(PuppeteerSgLive)),
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
      }).pipe(Effect.provide(PuppeteerSgLive)),
    );
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failures = Array.from(
        (function* walk(c: { _tag: string } & Record<string, unknown>): Generator<unknown> {
          if (c._tag === "Fail") yield (c as { error: unknown }).error;
          else if (c._tag === "Sequential" || c._tag === "Parallel") {
            yield* walk(c.left as never);
            yield* walk(c.right as never);
          }
        })(exit.cause as never),
      );
      const first = failures[0] as { _tag: string };
      expect(first._tag).toBe("PageLoadFailed");
    }
    expect(state.browser.close).toHaveBeenCalledTimes(1);
  });

  test("interrupt invokes browser cleanup", async () => {
    state.browser.newPage = mock(() => new Promise(() => {}));
    const program = Effect.scoped(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        return yield* svc.getPage("about:blank");
      }).pipe(Effect.provide(PuppeteerSgLive)),
    );
    const fiber = Effect.runFork(program);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(state.browser.close).toHaveBeenCalledTimes(1);
  });

  test("PUPPETEER_EXECUTABLE_PATH passed through to launch options", async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = "/fake/chrome";
    const program = Effect.scoped(Effect.void.pipe(Effect.provide(PuppeteerSgLive)));
    await Effect.runPromise(program);
    expect((state.lastLaunchOptions as { executablePath?: string }).executablePath).toBe("/fake/chrome");
  });

  test("PUPPETEER_NO_SANDBOX adds sandbox args", async () => {
    process.env.PUPPETEER_NO_SANDBOX = "true";
    const program = Effect.scoped(Effect.void.pipe(Effect.provide(PuppeteerSgLive)));
    await Effect.runPromise(program);
    const opts = state.lastLaunchOptions as { args: string[] };
    expect(opts.args).toEqual(["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]);
  });

  test("generatePDF passes through options", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const svc = yield* PuppeteerSg;
        const page = yield* svc.getPage("about:blank");
        yield* svc.generatePDF(page, "/tmp/out.pdf", { width: 100, height: 200 });
      }).pipe(Effect.provide(PuppeteerSgLive)),
    );
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.page.pdf).toHaveBeenCalledWith({
      path: "/tmp/out.pdf",
      printBackground: true,
      timeout: 0,
      width: 100,
      height: 200,
    });
  });
});
