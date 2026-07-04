import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigStore, makeConfigStore, type Settings } from "../src/service/ConfigStore";
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
