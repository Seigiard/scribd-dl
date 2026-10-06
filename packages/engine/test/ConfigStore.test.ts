import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Exit, Fiber, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigStore, makeConfigStore, type ConfigStoreIo, type Settings } from "../src/service/ConfigStore";
import { DEFAULT_CONFIG, makeConfigLoader } from "../src/utils/io/ConfigLoader";

const buildLayer = (baseDir: string) => Layer.provide(makeConfigStore(baseDir), makeConfigLoader(DEFAULT_CONFIG));

const defaults = (outputFolder: string): Settings => ({
  outputFolder,
  ilovepdfPublicKey: "",
  ilovepdfSecretKey: "",
  ilovepdfKeysValid: false,
});

const runRead = (baseDir: string) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const store = yield* ConfigStore;

        return yield* store.read;
      }),
      buildLayer(baseDir),
    ),
  );

const runWrite = (baseDir: string, settings: Settings) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const store = yield* ConfigStore;

        return yield* store.write(settings);
      }),
      buildLayer(baseDir),
    ),
  );

describe("ConfigStore", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-store-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("read", () => {
    test("returns parsed outputFolder when settings.json exists and is valid", async () => {
      // #given
      await fs.writeFile(path.join(tmpDir, "settings.json"), JSON.stringify({ outputFolder: "/tmp/foo" }));

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual(defaults("/tmp/foo"));
    });

    test("falls back to defaults when settings.json is missing", async () => {
      // #given
      // empty tmpDir; no file present

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual(defaults(DEFAULT_CONFIG.directory.output));
    });

    test("falls back to defaults and warns when JSON is malformed", async () => {
      // #given
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      await fs.writeFile(path.join(tmpDir, "settings.json"), "{ not valid json");

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual(defaults(DEFAULT_CONFIG.directory.output));
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test("falls back to defaults when outputFolder field is missing", async () => {
      // #given
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      await fs.writeFile(path.join(tmpDir, "settings.json"), "{}");

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual(defaults(DEFAULT_CONFIG.directory.output));
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test("falls back to defaults when outputFolder is not a string", async () => {
      // #given
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      await fs.writeFile(path.join(tmpDir, "settings.json"), JSON.stringify({ outputFolder: 42 }));

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual(defaults(DEFAULT_CONFIG.directory.output));
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test("expands ~ in outputFolder relative to homedir", async () => {
      // #given
      await fs.writeFile(path.join(tmpDir, "settings.json"), JSON.stringify({ outputFolder: "~/scribd-out" }));

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings.outputFolder).toBe(`${os.homedir()}/scribd-out`);
    });

    test("legacy settings.json with only outputFolder reads back with empty keys and valid false", async () => {
      // #given — a pre-feature settings file that predates the iLovePDF keys
      await fs.writeFile(path.join(tmpDir, "settings.json"), JSON.stringify({ outputFolder: "/tmp/legacy" }));

      // #when
      const settings = await runRead(tmpDir);

      // #then — no fallback to the default folder; keys default empty, validity false
      expect(settings).toEqual(defaults("/tmp/legacy"));
    });

    test("reads back persisted iLovePDF keys and validity", async () => {
      // #given
      await fs.writeFile(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({
          outputFolder: "/tmp/keys",
          ilovepdfPublicKey: "pub_123",
          ilovepdfSecretKey: "sec_456",
          ilovepdfKeysValid: true,
        }),
      );

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual({
        outputFolder: "/tmp/keys",
        ilovepdfPublicKey: "pub_123",
        ilovepdfSecretKey: "sec_456",
        ilovepdfKeysValid: true,
      });
    });

    test("coerces non-string keys and non-boolean validity to empty / false", async () => {
      // #given
      await fs.writeFile(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({
          outputFolder: "/tmp/coerce",
          ilovepdfPublicKey: 42,
          ilovepdfSecretKey: null,
          ilovepdfKeysValid: "yes",
        }),
      );

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual(defaults("/tmp/coerce"));
    });
  });

  describe("write", () => {
    test.each(["writeFile", "rename", "chmod"])(
      "canceling during %s waits for the filesystem transaction before another write can run",
      async (stage) => {
        // #given
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const finished = Promise.withResolvers<void>();
        const phases: string[] = [];
        let writes = 0;

        let renames = 0;
        let chmods = 0;

        const io: ConfigStoreIo = {
          mkdir: fs.mkdir,
          writeFile: async (...args) => {
            phases.push("write");
            await fs.writeFile(...args);

            if (++writes === 1 && stage === "writeFile") {
              entered.resolve();
              await release.promise;
            }
          },
          rename: async (...args) => {
            phases.push("rename");
            await fs.rename(...args);

            if (++renames === 1 && stage === "rename") {
              entered.resolve();
              await release.promise;
            }
          },
          chmod: async (...args) => {
            phases.push("chmod");
            await fs.chmod(...args);

            if (++chmods === 1 && stage === "chmod") {
              entered.resolve();
              await release.promise;
            }

            finished.resolve();
          },
        };

        const layer = Layer.provide(makeConfigStore(tmpDir, io), makeConfigLoader(DEFAULT_CONFIG));

        // #when
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const store = yield* ConfigStore;
            const first = yield* Effect.forkChild(store.write(defaults("/tmp/first")));
            yield* Effect.promise(() => entered.promise);
            const second = yield* Effect.forkChild(store.write(defaults("/tmp/second")));
            const interruption = Effect.runPromise(Fiber.interrupt(first));

            const canceledBeforeRelease = yield* Effect.promise(() =>
              Promise.race([interruption.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))]),
            );

            release.resolve();
            yield* Effect.promise(() => interruption);
            yield* Effect.promise(() => finished.promise);
            const secondExit = yield* Fiber.await(second);
            const persisted = yield* store.read;

            return {
              canceledBeforeRelease,
              phases,
              secondSucceeded: Exit.isSuccess(secondExit),
              folder: persisted.outputFolder,
            };
          }).pipe(Effect.provide(layer), Effect.scoped),
        );

        // #then
        expect(result).toEqual({
          canceledBeforeRelease: false,
          phases: ["write", "rename", "chmod", "write", "rename", "chmod"],
          secondSucceeded: true,
          folder: "/tmp/second",
        });
      },
    );

    test("concurrent writes all succeed and persist the final settings owner-only", async () => {
      // #given
      const writes: Settings[] = Array.from({ length: 24 }, (_, index) => ({
        outputFolder: `/tmp/concurrent-${index}`,
        ilovepdfPublicKey: "public".repeat(index + 1),
        ilovepdfSecretKey: "secret".repeat(25 - index),
        ilovepdfKeysValid: false,
      }));

      writes.push({
        outputFolder: "/tmp/final",
        ilovepdfPublicKey: "pub_final",
        ilovepdfSecretKey: "sec_final",
        ilovepdfKeysValid: true,
      });

      // #when
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* ConfigStore;

          const exits = yield* Effect.all(
            writes.map((settings) => Effect.exit(store.write(settings))),
            { concurrency: "unbounded" },
          );

          const persisted = yield* store.read;

          const stat = yield* Effect.promise(() => fs.stat(path.join(tmpDir, "settings.json")));

          return { allSucceeded: exits.every(Exit.isSuccess), persisted, mode: stat.mode & 0o777 };
        }).pipe(Effect.provide(buildLayer(tmpDir))),
      );

      // #then
      expect(result).toEqual({
        allSucceeded: true,
        persisted: {
          outputFolder: "/tmp/final",
          ilovepdfPublicKey: "pub_final",
          ilovepdfSecretKey: "sec_final",
          ilovepdfKeysValid: true,
        },
        mode: 0o600,
      });
    });

    test("creates the base directory when it does not exist", async () => {
      // #given
      const nestedBase = path.join(tmpDir, "deep", "nested");

      // #when
      const exit = await runWrite(nestedBase, defaults("/tmp/x"));

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      const written = await fs.readFile(path.join(nestedBase, "settings.json"), "utf8");
      expect(JSON.parse(written)).toEqual(defaults("/tmp/x"));
    });

    test("does not leave a .tmp file behind after a successful write", async () => {
      // #given/#when
      const exit = await runWrite(tmpDir, defaults("/tmp/x"));

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      await expect(fs.stat(path.join(tmpDir, "settings.json.tmp"))).rejects.toThrow();
    });

    test("round-trips outputFolder, both keys, and validity through write then read", async () => {
      // #given
      const full: Settings = {
        outputFolder: "/tmp/round-trip",
        ilovepdfPublicKey: "pub_abc",
        ilovepdfSecretKey: "sec_def",
        ilovepdfKeysValid: true,
      };

      await runWrite(tmpDir, full);

      // #when
      const settings = await runRead(tmpDir);

      // #then
      expect(settings).toEqual(full);
    });

    test("writes settings.json owner-only (mode 0o600)", async () => {
      // #given/#when
      const exit = await runWrite(tmpDir, defaults("/tmp/x"));

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      const stat = await fs.stat(path.join(tmpDir, "settings.json"));
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });
});
