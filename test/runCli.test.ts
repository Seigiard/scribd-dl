import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer } from "effect";
import { runCli } from "../run";
import { DownloadEngineLive } from "../src/service/DownloadEngine";
import { ScribdDownloader, type ScribdDownloaderService } from "../src/service/ScribdDownloader";
import { ConfigLoader, type ConfigData } from "../src/utils/io/ConfigLoader";
import { DirectoryIo, type DirectoryIoService } from "../src/utils/io/DirectoryIo";
import { PageLoadFailed } from "../src/errors/DomainErrors";

interface CapturedExit {
  code?: number;
  thrown: boolean;
}

interface MockState {
  scribdExecute: ReturnType<typeof mock>;
  dirCreate: ReturnType<typeof mock>;
  dirRemove: ReturnType<typeof mock>;
  config: ConfigData;
  logs: string[];
  errs: string[];
  exit: CapturedExit;
}

const state: MockState = {
  scribdExecute: mock(),
  dirCreate: mock(),
  dirRemove: mock(),
  config: { scribd: { rendertime: 100 }, directory: { output: "/tmp/out", filename: "title" } },
  logs: [],
  errs: [],
  exit: { thrown: false },
};

const originalExit = process.exit;
const originalLog = console.log;
const originalErr = console.error;

class ExitSentinel extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`__exit__:${code}`);
    this.code = code;
  }
}

beforeAll(() => {
  // @ts-expect-error replaced for tests
  process.exit = (code?: number) => {
    state.exit = { thrown: true, code: code ?? 0 };
    throw new ExitSentinel(code ?? 0);
  };
  console.log = (...args: unknown[]) => {
    state.logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    state.errs.push(args.map(String).join(" "));
  };
});

afterAll(() => {
  process.exit = originalExit;
  console.log = originalLog;
  console.error = originalErr;
});

beforeEach(() => {
  state.scribdExecute = mock(() => Effect.void);
  state.dirCreate = mock(() => Effect.void);
  state.dirRemove = mock(() => Effect.void);
  state.config = { scribd: { rendertime: 100 }, directory: { output: "/tmp/out", filename: "title" } };
  state.logs = [];
  state.errs = [];
  state.exit = { thrown: false };
});

const buildLayer = () => {
  const scribdSvc: ScribdDownloaderService = {
    execute: (url) => state.scribdExecute(url) as ReturnType<ScribdDownloaderService["execute"]>,
  };
  const dirSvc: DirectoryIoService = {
    create: (p) => state.dirCreate(p) as ReturnType<DirectoryIoService["create"]>,
    remove: (p) => state.dirRemove(p) as ReturnType<DirectoryIoService["remove"]>,
  };
  const EngineLayer = Layer.provide(DownloadEngineLive, Layer.succeed(ScribdDownloader, scribdSvc));
  return Layer.mergeAll(EngineLayer, Layer.succeed(DirectoryIo, dirSvc), Layer.succeed(ConfigLoader, state.config));
};

const runProgram = async (arg: string): Promise<{ ok: boolean; exitCode?: number }> => {
  const exit = await Effect.runPromiseExit(runCli(arg).pipe(Effect.provide(buildLayer())));
  if (Exit.isSuccess(exit)) {
    return { ok: true };
  }
  if (state.exit.thrown) {
    return { ok: false, exitCode: state.exit.code };
  }
  throw new Error(`Effect failed without process.exit; exit=${JSON.stringify(exit)}`);
};

describe("runCli", () => {
  describe("single URL", () => {
    test("scribd URL success: scribdExecute called, no exit, no batch summary", async () => {
      // #given
      const url = "https://www.scribd.com/document/123/foo";

      // #when
      const result = await runProgram(url);

      // #then
      expect(result.ok).toBe(true);
      expect(state.scribdExecute).toHaveBeenCalledTimes(1);
      expect(state.scribdExecute).toHaveBeenCalledWith(url);
      expect(state.logs.some((l) => l.includes("Batch summary"))).toBe(false);
      expect(state.dirCreate).toHaveBeenCalledWith("/tmp/out");
    });

    test("scribd URL failure: process.exit(1), [FAIL] line to stderr", async () => {
      // #given
      state.scribdExecute = mock((url: string) => Effect.fail(new PageLoadFailed({ url, cause: "boom" })));

      // #when
      const result = await runProgram("https://www.scribd.com/document/1/a");

      // #then
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(state.errs.some((e) => e.includes("[FAIL]") && e.includes("PageLoadFailed"))).toBe(true);
    });

    test("unsupported URL: no scribdExecute, process.exit(1), Unsupported domain reason", async () => {
      // #when
      const result = await runProgram("https://example.com/foo");

      // #then
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(state.scribdExecute).not.toHaveBeenCalled();
      expect(state.errs.some((e) => e.includes("Unsupported domain"))).toBe(true);
    });
  });

  describe("batch file", () => {
    let batchFile: string;

    afterEach(() => {
      if (batchFile) {
        try {
          unlinkSync(batchFile);
        } catch {
          // ignore
        }
      }
    });

    test("3 URLs (2 scribd + 1 unsupported): summary printed, process.exit(1)", async () => {
      // #given
      batchFile = join(tmpdir(), `scribd-dl-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
      writeFileSync(
        batchFile,
        ["# header comment", "https://www.scribd.com/document/1/a", "https://example.com/foo", "https://www.scribd.com/document/2/b"].join(
          "\n",
        ),
      );

      // #when
      const result = await runProgram(batchFile);

      // #then
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(state.scribdExecute).toHaveBeenCalledTimes(2);
      expect(state.logs.some((l) => l.includes("Batch summary"))).toBe(true);
      expect(state.logs.some((l) => l.includes("Total: 3, OK: 2, Failed: 1"))).toBe(true);
      expect(state.logs.some((l) => l.includes("Unsupported domain"))).toBe(true);
    });

    test("batch file with only comments: 'No URLs found', process.exit(1)", async () => {
      // #given
      batchFile = join(tmpdir(), `scribd-dl-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
      writeFileSync(batchFile, ["# only", "# comments", "   ", ""].join("\n"));

      // #when
      const result = await runProgram(batchFile);

      // #then
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(state.errs.some((e) => e.includes("No URLs found in"))).toBe(true);
      expect(state.scribdExecute).not.toHaveBeenCalled();
    });

    test("batch file all success: summary OK count, no process.exit", async () => {
      // #given
      batchFile = join(tmpdir(), `scribd-dl-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
      writeFileSync(batchFile, ["https://www.scribd.com/document/1/a", "https://www.scribd.com/document/2/b"].join("\n"));

      // #when
      const result = await runProgram(batchFile);

      // #then
      expect(result.ok).toBe(true);
      expect(state.scribdExecute).toHaveBeenCalledTimes(2);
      expect(state.logs.some((l) => l.includes("Total: 2, OK: 2, Failed: 0"))).toBe(true);
    });
  });
});
