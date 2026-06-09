import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DirectoryIo, DirectoryIoLive } from "../src/utils/io/DirectoryIo.ts";

const runCreate = (target: string) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const svc = yield* DirectoryIo;
        return yield* svc.create(target);
      }),
      DirectoryIoLive,
    ),
  );

const runRemove = (target: string) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const svc = yield* DirectoryIo;
        return yield* svc.remove(target);
      }),
      DirectoryIoLive,
    ),
  );

const isDirectoryIoFailed = (exit: Exit.Exit<unknown, unknown>, op: "create" | "remove"): boolean => {
  if (!Exit.isFailure(exit)) {
    return false;
  }
  const failures = Array.from(exit.cause.failures ?? []);
  const candidates = failures.length > 0 ? failures : [(exit.cause as { error?: unknown }).error];
  return candidates.some((f) => {
    const err = f as { _tag?: string; op?: string; path?: string } | undefined;
    return err?._tag === "DirectoryIoFailed" && err?.op === op && typeof err?.path === "string";
  });
};

describe("DirectoryIo", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "directory-io-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    test("creates a nested directory tree recursively", async () => {
      // #given
      const nested = path.join(tmpDir, "a", "b", "c", "d");

      // #when
      const exit = await runCreate(nested);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      const stat = await fs.stat(nested);
      expect(stat.isDirectory()).toBe(true);
    });

    test("is idempotent when directory already exists", async () => {
      // #given
      const existing = path.join(tmpDir, "already-here");
      await fs.mkdir(existing);

      // #when
      const exit = await runCreate(existing);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("fails with DirectoryIoFailed when path cannot be created", async () => {
      // #given a path nested under /dev/null which is a file, not a directory
      const invalid = "/dev/null/foo";

      // #when
      const exit = await runCreate(invalid);

      // #then
      expect(isDirectoryIoFailed(exit, "create")).toBe(true);
    });
  });

  describe("remove", () => {
    test("removes an existing directory tree", async () => {
      // #given
      const target = path.join(tmpDir, "to-remove");
      await fs.mkdir(path.join(target, "inner"), { recursive: true });
      await fs.writeFile(path.join(target, "inner", "file.txt"), "hi");

      // #when
      const exit = await runRemove(target);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      await expect(fs.stat(target)).rejects.toThrow();
    });

    test("is idempotent for nonexistent paths via force flag", async () => {
      // #given
      const missing = path.join(tmpDir, "never-existed");

      // #when
      const exit = await runRemove(missing);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
