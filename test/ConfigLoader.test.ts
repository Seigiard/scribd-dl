import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Exit } from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigLoader, ConfigLoaderLive } from "../src/utils/io/ConfigLoader.ts";

const VALID_INI = `[SCRIBD]
rendertime=100

[SLIDESHARE]
rendertime=200

[DIRECTORY]
output=output
filename=title
`;

const runLoad = () =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        return yield* ConfigLoader;
      }),
      ConfigLoaderLive,
    ),
  );

const isConfigInvalid = (exit: Exit.Exit<unknown, unknown>): boolean => {
  if (!Exit.isFailure(exit)) {
    return false;
  }
  const failures = Array.from(exit.cause.failures ?? []);
  if (failures.length === 0) {
    const error = (exit.cause as { error?: { _tag?: string } }).error;
    return error?._tag === "ConfigInvalid";
  }
  return failures.some((f) => (f as { _tag?: string })._tag === "ConfigInvalid");
};

describe("ConfigLoader", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-loader-test-"));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("returns typed ConfigData on a valid config.ini", async () => {
    // #given
    await fs.writeFile(path.join(tmpDir, "config.ini"), VALID_INI);

    // #when
    const exit = await runLoad();

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        scribd: { rendertime: 100 },
        slideshare: { rendertime: 200 },
        directory: { output: "output", filename: "title" },
      });
    }
  });

  test("fails with ConfigInvalid when rendertime is not a number", async () => {
    // #given
    const bad = VALID_INI.replace("rendertime=100", "rendertime=abc");
    await fs.writeFile(path.join(tmpDir, "config.ini"), bad);

    // #when
    const exit = await runLoad();

    // #then
    expect(isConfigInvalid(exit)).toBe(true);
  });

  test("fails with ConfigInvalid when DIRECTORY.output is missing", async () => {
    // #given
    const missing = `[SCRIBD]
rendertime=100

[SLIDESHARE]
rendertime=200

[DIRECTORY]
filename=title
`;
    await fs.writeFile(path.join(tmpDir, "config.ini"), missing);

    // #when
    const exit = await runLoad();

    // #then
    expect(isConfigInvalid(exit)).toBe(true);
  });

  test("fails with ConfigInvalid when config.ini does not exist", async () => {
    // #given no config.ini written

    // #when
    const exit = await runLoad();

    // #then
    expect(isConfigInvalid(exit)).toBe(true);
  });

  test("Layer memoizes config: Bun.file called only once across multiple consumers", async () => {
    // #given
    await fs.writeFile(path.join(tmpDir, "config.ini"), VALID_INI);
    const spy = spyOn(Bun, "file");

    try {
      // #when
      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const first = yield* ConfigLoader;
            const second = yield* ConfigLoader;
            return { first, second };
          }),
          ConfigLoaderLive,
        ),
      );

      // #then
      const configFileCalls = spy.mock.calls.filter((args) => typeof args[0] === "string" && (args[0] as string).endsWith("config.ini"));
      expect(configFileCalls.length).toBe(1);
      expect(result.first).toBe(result.second);
    } finally {
      spy.mockRestore();
    }
  });
});
