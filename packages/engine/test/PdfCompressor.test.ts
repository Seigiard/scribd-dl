import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CompressionFailed } from "../src/errors/DomainErrors";
import { makePdfCompressor, PdfCompressor, type ApiFactory, type FileFactory } from "../src/service/PdfCompressor";

const KEYS = { publicKey: "pub_x", secretKey: "sec_y" };
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"

interface FakeConfig {
  readonly startError?: unknown;
  readonly processError?: unknown;
  readonly downloadBytes?: Uint8Array;
  readonly downloadError?: unknown;
  readonly remainingFiles?: number;
}

const fakeApiFactory = (cfg: FakeConfig): { factory: ApiFactory; starts: () => number; addFiles: () => number } => {
  let started = 0;
  let addFiles = 0;
  const factory: ApiFactory = () => ({
    newTask: () => ({
      remainingFiles: cfg.remainingFiles,
      start: async () => {
        started += 1;
        if (cfg.startError) throw cfg.startError;
        return "task-id";
      },
      addFile: async () => {
        addFiles += 1;
        return undefined;
      },
      process: async () => {
        if (cfg.processError) throw cfg.processError;
        return {};
      },
      download: async () => {
        if (cfg.downloadError) throw cfg.downloadError;
        return cfg.downloadBytes ?? PDF_BYTES;
      },
    }),
  });
  return { factory, starts: () => started, addFiles: () => addFiles };
};

const recordingFileFactory = (): { factory: FileFactory; paths: () => ReadonlyArray<string> } => {
  const paths: string[] = [];
  const factory: FileFactory = (absolutePath) => {
    paths.push(absolutePath);
    return { __fake: absolutePath };
  };
  return { factory, paths: () => paths };
};

const runCompress = (makeApi: ApiFactory, makeFile: FileFactory, pdfPath: string) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const compressor = yield* PdfCompressor;
        return yield* compressor.compress(pdfPath, KEYS);
      }),
      makePdfCompressor(makeApi, makeFile),
    ),
  );

const runValidate = (makeApi: ApiFactory) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const compressor = yield* PdfCompressor;
        return yield* compressor.validate(KEYS);
      }),
      makePdfCompressor(makeApi, recordingFileFactory().factory),
    ),
  );

const failureOf = (exit: Exit.Exit<void, CompressionFailed>): CompressionFailed => {
  if (!Exit.isFailure(exit)) throw new Error("expected failure exit");
  const opt = Cause.failureOption(exit.cause);
  if (Option.isNone(opt)) throw new Error("expected a typed failure");
  return opt.value;
};

const axiosLike = (status: number): Record<string, unknown> => ({
  message: `Request failed with status code ${status}`,
  response: { status },
  config: { headers: { Authorization: "Bearer SECRET_JWT_TOKEN_ABC" } },
});

describe("PdfCompressor", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-compressor-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("compress", () => {
    test("happy path writes compressed bytes over the resolved absolute path", async () => {
      // #given
      const target = path.join(tmpDir, "doc.pdf");
      await fs.writeFile(target, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
      const { factory } = fakeApiFactory({ downloadBytes: PDF_BYTES });
      const file = recordingFileFactory();

      // #when
      const exit = await runCompress(factory, file.factory, target);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(new Uint8Array(await fs.readFile(target))).toEqual(PDF_BYTES);
      expect(file.paths()).toEqual([target]);
      await expect(fs.stat(`${target}.tmp`)).rejects.toThrow();
    });

    test("resolves a relative pdfPath to an absolute path before constructing the file", async () => {
      // #given — invalid download bytes so no file is written to cwd
      const { factory } = fakeApiFactory({ downloadBytes: new Uint8Array([0x00, 0x01]) });
      const file = recordingFileFactory();

      // #when
      await runCompress(factory, file.factory, "output/rel.pdf");

      // #then
      const captured = file.paths();
      expect(captured).toHaveLength(1);
      expect(path.isAbsolute(captured[0]!)).toBe(true);
      expect(captured[0]).toBe(path.resolve("output/rel.pdf"));
    });

    test("aborts before uploading when start() reports zero remaining files", async () => {
      // #given — quota is spent; pre-flight should bail before addFile/process
      const target = path.join(tmpDir, "d.pdf");
      const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x99]);
      await fs.writeFile(target, original);
      const fake = fakeApiFactory({ remainingFiles: 0 });

      // #when
      const exit = await runCompress(fake.factory, recordingFileFactory().factory, target);

      // #then — mapped to quota, no upload attempted, original untouched
      expect(failureOf(exit).reason).toBe("quota exceeded");
      expect(fake.addFiles()).toBe(0);
      expect(new Uint8Array(await fs.readFile(target))).toEqual(original);
    });

    test("proceeds when start() reports remaining files above zero", async () => {
      // #given
      const target = path.join(tmpDir, "d.pdf");
      await fs.writeFile(target, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00]));
      const fake = fakeApiFactory({ remainingFiles: 5, downloadBytes: PDF_BYTES });

      // #when
      const exit = await runCompress(fake.factory, recordingFileFactory().factory, target);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.addFiles()).toBe(1);
    });

    test("maps a thrown 401 to reason 'invalid credentials'", async () => {
      // #given
      const { factory } = fakeApiFactory({ startError: axiosLike(401) });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, path.join(tmpDir, "d.pdf"));

      // #then
      expect(failureOf(exit).reason).toBe("invalid credentials");
    });

    test("maps a thrown 402 to reason 'quota exceeded'", async () => {
      // #given
      const { factory } = fakeApiFactory({ processError: axiosLike(402) });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, path.join(tmpDir, "d.pdf"));

      // #then
      expect(failureOf(exit).reason).toBe("quota exceeded");
    });

    test("maps a thrown 429 to reason 'quota exceeded'", async () => {
      // #given
      const { factory } = fakeApiFactory({ startError: axiosLike(429) });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, path.join(tmpDir, "d.pdf"));

      // #then
      expect(failureOf(exit).reason).toBe("quota exceeded");
    });

    test("maps a no-response network throw to reason 'network error'", async () => {
      // #given
      const { factory } = fakeApiFactory({ startError: { message: "connect ETIMEDOUT 1.2.3.4:443" } });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, path.join(tmpDir, "d.pdf"));

      // #then
      expect(failureOf(exit).reason).toBe("network error");
    });

    test("maps a no-response JWT-signing throw to reason 'invalid credentials'", async () => {
      // #given
      const { factory } = fakeApiFactory({ startError: { message: "Error signing JWT: invalid secret key" } });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, path.join(tmpDir, "d.pdf"));

      // #then
      expect(failureOf(exit).reason).toBe("invalid credentials");
    });

    test("rejects empty download bytes as 'invalid response from compressor'", async () => {
      // #given
      const target = path.join(tmpDir, "d.pdf");
      const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xaa]);
      await fs.writeFile(target, original);
      const { factory } = fakeApiFactory({ downloadBytes: new Uint8Array() });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, target);

      // #then
      expect(failureOf(exit).reason).toBe("invalid response from compressor");
      expect(new Uint8Array(await fs.readFile(target))).toEqual(original);
    });

    test("rejects non-%PDF download bytes and leaves the original untouched", async () => {
      // #given
      const target = path.join(tmpDir, "d.pdf");
      const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xbb, 0xcc]);
      await fs.writeFile(target, original);
      const { factory } = fakeApiFactory({ downloadBytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]) }); // "<html"

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, target);

      // #then
      expect(failureOf(exit).reason).toBe("invalid response from compressor");
      expect(new Uint8Array(await fs.readFile(target))).toEqual(original);
      await expect(fs.stat(`${target}.tmp`)).rejects.toThrow();
    });

    test("leaves a pre-existing original byte-for-byte unchanged when the API throws", async () => {
      // #given
      const target = path.join(tmpDir, "d.pdf");
      const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x11, 0x22, 0x33]);
      await fs.writeFile(target, original);
      const { factory } = fakeApiFactory({ processError: axiosLike(401) });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, target);

      // #then
      expect(Exit.isFailure(exit)).toBe(true);
      expect(new Uint8Array(await fs.readFile(target))).toEqual(original);
    });

    test("scrubbed cause carries no Authorization / bearer token", async () => {
      // #given
      const { factory } = fakeApiFactory({ startError: axiosLike(401) });

      // #when
      const exit = await runCompress(factory, recordingFileFactory().factory, path.join(tmpDir, "d.pdf"));

      // #then
      const serialized = JSON.stringify(failureOf(exit).cause);
      expect(serialized).not.toContain("Authorization");
      expect(serialized).not.toContain("Bearer");
      expect(serialized).not.toContain("SECRET_JWT_TOKEN_ABC");
    });
  });

  describe("validate", () => {
    test("returns true when start() resolves", async () => {
      // #given
      const { factory } = fakeApiFactory({});

      // #when
      const result = await runValidate(factory);

      // #then
      expect(result).toBe(true);
    });

    test("returns false when start() throws, without failing the effect channel", async () => {
      // #given
      const { factory } = fakeApiFactory({ startError: axiosLike(401) });

      // #when
      const result = await runValidate(factory);

      // #then
      expect(result).toBe(false);
    });
  });
});
