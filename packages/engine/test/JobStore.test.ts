import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Job } from "@scribd-dl/shared";
import { JobStore, makeJobStore, type JobStoreIo } from "../src/service/JobStore";

const runRead = (baseDir: string) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const store = yield* JobStore;

        return yield* store.read;
      }),
      makeJobStore(baseDir),
    ),
  );

const runWrite = (baseDir: string, jobs: ReadonlyArray<Job>) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const store = yield* JobStore;

        return yield* store.write(jobs);
      }),
      makeJobStore(baseDir),
    ),
  );

const runWriteConcurrent = (baseDir: string, a: ReadonlyArray<Job>, b: ReadonlyArray<Job>) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const store = yield* JobStore;
        yield* Effect.all([store.write(a), store.write(b)], { concurrency: "unbounded" });
      }),
      makeJobStore(baseDir),
    ),
  );

const job = (id: string, status: Job["status"], extra: Partial<Job> = {}): Job => ({
  id,
  url: `https://www.scribd.com/document/${id}/x`,
  domain: "scribd",
  displayTitle: `doc ${id}`,
  status,
  ...extra,
});

describe("JobStore", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-store-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test.each(["writeFile", "rename"])(
    "canceling a snapshot during %s waits for its transaction and permits the next snapshot afterward",
    async (stage) => {
      // #given
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const finished = Promise.withResolvers<void>();
      const phases: string[] = [];
      let writes = 0;

      let renames = 0;

      const io: JobStoreIo = {
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

          finished.resolve();
        },
      };

      // #when
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* JobStore;
          const first = yield* Effect.fork(store.write([job("first", "Queued")]));
          yield* Effect.promise(() => entered.promise);
          const second = yield* Effect.fork(store.write([job("second", "Queued")]));
          const interruption = Effect.runPromise(Fiber.interrupt(first));

          const canceledBeforeRelease = yield* Effect.promise(() =>
            Promise.race([
              interruption.then(() => true),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
            ]),
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
            ids: persisted.map((entry) => entry.id),
          };
        }).pipe(Effect.provide(makeJobStore(tmpDir, io)), Effect.scoped),
      );

      // #then
      expect(result).toEqual({
        canceledBeforeRelease: false,
        phases: ["write", "rename", "write", "rename"],
        secondSucceeded: true,
        ids: ["second"],
      });
    },
  );

  describe("read", () => {
    test("returns jobs in file order when all lines are valid", async () => {
      // #given
      const jobs = [
        job("a", "Queued"),
        job("b", "Downloaded"),
        job("c", "Failed", { failure: { reason: "x", retryable: true } }),
      ];

      const body = jobs.map((j) => JSON.stringify(j)).join("\n") + "\n";
      await fs.writeFile(path.join(tmpDir, "jobs.jsonl"), body);

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result.map((j) => j.id)).toEqual(["a", "b", "c"]);
    });

    test("returns empty array when file does not exist", async () => {
      // #given
      // empty tmpDir

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result).toEqual([]);
    });

    test("returns empty array when file is empty", async () => {
      // #given
      await fs.writeFile(path.join(tmpDir, "jobs.jsonl"), "");

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result).toEqual([]);
    });

    test("skips blank lines without warning", async () => {
      // #given
      const valid = JSON.stringify(job("a", "Queued"));
      await fs.writeFile(path.join(tmpDir, "jobs.jsonl"), `${valid}\n\n\n${valid}\n`);

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result.length).toBe(2);
    });

    test("skips malformed JSON line and warns", async () => {
      // #given
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      const valid = JSON.stringify(job("a", "Queued"));
      await fs.writeFile(
        path.join(tmpDir, "jobs.jsonl"),
        `${valid}\n{ broken\n${JSON.stringify(job("c", "Failed", { failure: { reason: "r", retryable: false } }))}\n`,
      );

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result.map((j) => j.id)).toEqual(["a", "c"]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test("skips line missing required fields", async () => {
      // #given
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      await fs.writeFile(
        path.join(tmpDir, "jobs.jsonl"),
        `{"id":"x"}\n${JSON.stringify(job("a", "Queued"))}\n`,
      );

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result.map((j) => j.id)).toEqual(["a"]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test("normalizes Downloading to Queued and drops progress", async () => {
      // #given
      const stale: Job = {
        ...job("d", "Downloading"),
        progress: { done: 5, total: 10, stage: "scrape" },
      };

      await fs.writeFile(path.join(tmpDir, "jobs.jsonl"), `${JSON.stringify(stale)}\n`);

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result[0]?.status).toBe("Queued");
      expect(result[0]?.progress).toBeUndefined();
    });

    test("preserves failure on Failed jobs", async () => {
      // #given
      const failed = job("f", "Failed", { failure: { reason: "boom", retryable: true } });
      await fs.writeFile(path.join(tmpDir, "jobs.jsonl"), `${JSON.stringify(failed)}\n`);

      // #when
      const result = await runRead(tmpDir);

      // #then
      expect(result[0]?.failure).toEqual({ reason: "boom", retryable: true });
    });
  });

  describe("write", () => {
    test("creates the base directory when it does not exist", async () => {
      // #given
      const nestedBase = path.join(tmpDir, "deep", "x");

      // #when
      const exit = await runWrite(nestedBase, [job("a", "Queued")]);

      // #then
      expect(Exit.isSuccess(exit)).toBe(true);
      const written = await fs.readFile(path.join(nestedBase, "jobs.jsonl"), "utf8");
      expect(written.trim()).toBe(JSON.stringify(job("a", "Queued")));
    });

    test("does not leave a .tmp file behind after a successful write", async () => {
      // #given/#when
      await runWrite(tmpDir, [job("a", "Queued")]);

      // #then
      await expect(fs.stat(path.join(tmpDir, "jobs.jsonl.tmp"))).rejects.toThrow();
    });

    test("round-trips: write then read returns equivalent jobs", async () => {
      // #given
      const jobs = [job("a", "Queued"), job("b", "Downloaded")];

      // #when
      await runWrite(tmpDir, jobs);
      const result = await runRead(tmpDir);

      // #then
      expect(result).toEqual(jobs);
    });

    test("writes empty file for empty array", async () => {
      // #given/#when
      await runWrite(tmpDir, []);

      // #then
      const stat = await fs.stat(path.join(tmpDir, "jobs.jsonl"));
      expect(stat.size).toBe(0);
    });

    test("concurrent writes serialize via semaphore without losing data", async () => {
      // #given
      const a = [job("a1", "Queued"), job("a2", "Queued")];
      const b = [job("b1", "Downloaded")];

      // #when
      await runWriteConcurrent(tmpDir, a, b);
      const result = await runRead(tmpDir);

      // #then — last writer wins, but the surviving snapshot is one of the two intact, not a mix
      const winner = JSON.stringify(result);
      const expectedA = JSON.stringify(a);
      const expectedB = JSON.stringify(b);
      expect([expectedA, expectedB]).toContain(winner);
    });
  });

  describe("compression persistence (KTD4)", () => {
    test("a Downloaded job with a failed compression survives write then read", async () => {
      // #given
      const jobs = [
        job("a", "Downloaded", { compression: { status: "failed", reason: "network error" } }),
      ];

      // #when
      await runWrite(tmpDir, jobs);
      const result = await runRead(tmpDir);

      // #then
      expect(result).toEqual(jobs);
    });

    test("a transient compressing flag is dropped on write then read", async () => {
      // #given
      const jobs = [job("a", "Downloaded", { compression: { status: "compressing" } })];

      // #when
      await runWrite(tmpDir, jobs);
      const result = await runRead(tmpDir);

      // #then — the persisted job carries no compression field
      expect(result).toEqual([job("a", "Downloaded")]);
    });

    test("a failed compression on a non-Downloaded job is dropped", async () => {
      // #given — only terminal (Downloaded) failed compression is retained
      const jobs = [
        job("a", "Queued", { compression: { status: "failed", reason: "network error" } }),
      ];

      // #when
      await runWrite(tmpDir, jobs);
      const result = await runRead(tmpDir);

      // #then
      expect(result).toEqual([job("a", "Queued")]);
    });
  });
});
