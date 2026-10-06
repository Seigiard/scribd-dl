import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { DirectoryIoFailed } from "../src/errors/DomainErrors";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DirectoryIo, DirectoryIoLive, makeDirectoryIo } from "../src/utils/io/DirectoryIo";

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

const isDirectoryIoFailed = (exit: Exit.Exit<unknown, DirectoryIoFailed>, op: "create" | "remove", expectedPath: string): boolean => {
  if (!Exit.isFailure(exit)) {
    return false;
  }

  const failure = Cause.findErrorOption(exit.cause);

  if (Option.isNone(failure)) {
    return false;
  }

  const err = failure.value;

  return err instanceof DirectoryIoFailed && err.op === op && err.path === expectedPath;
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
      expect(isDirectoryIoFailed(exit, "create", invalid)).toBe(true);
    });
  });

  describe("IO cancellation", () => {
    test.each(["create", "remove"] satisfies ReadonlyArray<"create" | "remove">)(
      "cancellation waits for %s before the same directory can be reused",
      async (operation) => {
        // #given
        const target = path.join(tmpDir, "reused");
        await fs.mkdir(target);
        await fs.writeFile(path.join(target, "old.txt"), "old");
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const finished = Promise.withResolvers<void>();

        const io = makeDirectoryIo({
          mkdir: async (dir) => {
            entered.resolve();
            await release.promise;

            try {
              return await fs.mkdir(dir, { recursive: true });
            } finally {
              finished.resolve();
            }
          },
          rm: async (dir) => {
            entered.resolve();
            await release.promise;

            try {
              await fs.rm(dir, { recursive: true, force: true });
            } finally {
              finished.resolve();
            }
          },
        });

        const fiber = Effect.runFork(io[operation](target));
        await entered.promise;

        // #when
        let cancellationCompleted = false;

        const cancellation = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
          cancellationCompleted = true;

          return Effect.runPromise(Fiber.await(fiber));
        });

        await new Promise<void>((resolve) => setImmediate(resolve));
        const completedBeforeRelease = cancellationCompleted;
        release.resolve();
        const exit = await cancellation;
        await fs.rm(target, { recursive: true, force: true });
        await fs.mkdir(target);
        await fs.writeFile(path.join(target, "fresh.txt"), "fresh");
        await finished.promise;

        // #then
        expect(completedBeforeRelease).toBe(false);
        expect(Exit.hasInterrupts(exit)).toBe(true);
        expect(await fs.readdir(target)).toEqual(["fresh.txt"]);
        expect(await fs.readFile(path.join(target, "fresh.txt"), "utf8")).toBe("fresh");
      },
    );
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
