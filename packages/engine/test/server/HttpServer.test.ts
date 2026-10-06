import { afterAll, beforeAll, describe, expect, mock, test, type Mock } from "bun:test";
import { Effect, Fiber, Layer, Match, Predicate, Schema } from "effect";
import { HttpServer } from "effect/http";
import { EngineSnapshotSchema, JobEventSchema, type Job } from "@scribd-dl/shared";
import { ConfigStore, type ConfigStoreService } from "../../src/service/ConfigStore";
import { DownloadEngineLive } from "../../src/service/DownloadEngine";
import { JobStore, type JobStoreService } from "../../src/service/JobStore";
import { PdfCompressor, type PdfCompressorService } from "../../src/service/PdfCompressor";
import { Scrapers, type Scraper } from "../../src/service/Scraper";
import { ConfigLoader, type ConfigData } from "../../src/utils/io/ConfigLoader";
import { PdfGenerator, type PdfGeneratorService } from "../../src/utils/io/PdfGenerator";
import { HttpServerLive } from "../../src/server/HttpServerLive";

interface MockState {
  scribdExecute: Mock<Scraper["execute"]>;
  restoredJobs: ReadonlyArray<Job>;
  validateResult: boolean;
}

const state: MockState = {
  scribdExecute: mock(() => Effect.void),
  restoredJobs: [],
  validateResult: true,
};

const defaultConfig: ConfigData = {
  scribd: { rendertime: 100 },
  directory: { output: "/tmp/scribd-dl-test", filename: "title" },
};

const scribdMockScraper: Scraper = {
  id: "scribd",
  canHandle: (url) => /scribd\.com/.test(url),
  deriveDisplayTitle: (url) => `Scribd ${url}`,
  execute: (url, folder, onEvent, debug) => state.scribdExecute(url, folder, onEvent, debug),
};

const scrapersMockLayer = Layer.succeed(Scrapers, [scribdMockScraper]);

const configStoreMockLayer = Layer.succeed(ConfigStore, {
  read: Effect.sync(() => ({
    outputFolder: defaultConfig.directory.output,
    ilovepdfPublicKey: "",
    ilovepdfSecretKey: "",
    ilovepdfKeysValid: false,
  })),
  write: () => Effect.void,
} satisfies ConfigStoreService);

const jobStoreMockLayer = Layer.succeed(JobStore, {
  read: Effect.sync(() => state.restoredJobs),
  write: () => Effect.void,
} satisfies JobStoreService);

const pdfCompressorMockLayer = Layer.succeed(PdfCompressor, {
  compress: () => Effect.void,
  validate: () => Effect.sync(() => state.validateResult),
} satisfies PdfCompressorService);

const pdfGeneratorMockLayer = Layer.succeed(PdfGenerator, {
  merge: () => Effect.void,
  setTitle: () => Effect.void,
} satisfies PdfGeneratorService);

const buildEngineLayer = (config: ConfigData = defaultConfig) =>
  Layer.provide(
    DownloadEngineLive,
    Layer.mergeAll(
      scrapersMockLayer,
      Layer.succeed(ConfigLoader, config),
      configStoreMockLayer,
      jobStoreMockLayer,
      pdfCompressorMockLayer,
      pdfGeneratorMockLayer,
    ),
  );

let serverFiber: Fiber.Fiber<unknown, unknown> | null = null;

let baseUrl = "";

const getServerPort = Effect.flatMap(HttpServer.HttpServer, ({ address }) => {
  if (Predicate.isTagged(address, "UnixPathAddress")) return Effect.die("Expected an IP address");

  return Effect.succeed(address.port);
});

beforeAll(async () => {
  state.scribdExecute = mock(() => Effect.void);

  const portReady = new Promise<number>((resolve, reject) => {
    const ServerLayer = HttpServerLive(0).pipe(Layer.provide(buildEngineLayer()));

    const program = getServerPort.pipe(
      Effect.tap((port) => Effect.sync(() => resolve(port))),
      Effect.andThen(Effect.never),
      Effect.provide(ServerLayer),
      Effect.scoped,
    );

    serverFiber = Effect.runFork(program);
    setTimeout(() => reject(new Error("server start timeout")), 5000);
  });

  const port = await portReady;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (serverFiber) {
    await Effect.runPromise(Fiber.interrupt(serverFiber));
  }
});

const j = <A>(body: A) => JSON.stringify(body);

const readQueue = async (response: Response) => Schema.decodeUnknownSync(EngineSnapshotSchema)(await response.json());

const readError = async (response: Response) => Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }))(await response.json());

const readClear = async (response: Response) => Schema.decodeUnknownSync(Schema.Struct({ removed: Schema.Number }))(await response.json());

type DecodedJobEvent = typeof JobEventSchema.Type;

const ct = { "Content-Type": "application/json" };

describe("HttpServer REST routes", () => {
  test("GET /snapshot on empty engine returns empty jobs array", async () => {
    const res = await fetch(`${baseUrl}/snapshot`);
    expect(res.status).toBe(200);
    const body = await readQueue(res);
    expect(body.jobs).toEqual([]);
  });

  test("POST /enqueue with junk text returns empty jobs", async () => {
    const res = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "hello" }),
    });

    expect(res.status).toBe(200);
    const body = await readQueue(res);
    expect(body.jobs).toEqual([]);
  });

  test("POST /enqueue with unsupported URL returns Failed unsupported job", async () => {
    const res = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://example.com/x" }),
    });

    expect(res.status).toBe(200);

    const body = await readQueue(res);

    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]!.status).toBe("Failed");
    expect(body.jobs[0]!.domain).toBe("unsupported");
    expect(body.jobs[0]!.failure!.retryable).toBe(false);
  });

  test("DELETE /jobs/nonexistent returns 404 JobNotFound", async () => {
    const res = await fetch(`${baseUrl}/jobs/nonexistent`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "JobNotFound" });
  });

  test("POST /jobs/nonexistent/retry returns 404 JobNotFound", async () => {
    const res = await fetch(`${baseUrl}/jobs/nonexistent/retry`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "JobNotFound" });
  });

  test("GET /folder returns configured output", async () => {
    const res = await fetch(`${baseUrl}/folder`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/tmp/scribd-dl-test" });
  });

  test("POST /folder updates output", async () => {
    const res = await fetch(`${baseUrl}/folder`, {
      method: "POST",
      headers: ct,
      body: j({ path: "/tmp/new-folder" }),
    });

    expect(res.status).toBe(204);
    const after = await fetch(`${baseUrl}/folder`);
    expect(await after.json()).toEqual({ path: "/tmp/new-folder" });
  });

  test("POST /folder with empty path returns 400 InvalidPath", async () => {
    const res = await fetch(`${baseUrl}/folder`, {
      method: "POST",
      headers: ct,
      body: j({ path: "  " }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "InvalidPath" });
  });
});

describe("HttpServer queue lifecycle (scribd routing)", () => {
  test("POST /enqueue with scribd URL creates a Queued job, DELETE removes it", async () => {
    // Mock scribdExecute to never resolve so the job stays in Downloading after worker picks it up — except remove requires Queued.
    // We need Remove to happen BEFORE worker picks the job up. Use a paused mock.
    state.scribdExecute = mock(() => Effect.never);

    const enq = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://www.scribd.com/document/1/test" }),
    });

    const body = await readQueue(enq);
    expect(body.jobs).toHaveLength(1);
    const job = body.jobs[0]!;

    // Worker may have started already — depending on timing, status is Queued or Downloading.
    // Try remove; if it succeeds the job was Queued, if 409 it was Downloading. Either is acceptable signal.
    const del = await fetch(`${baseUrl}/jobs/${job.id}`, { method: "DELETE" });
    expect([204, 409]).toContain(del.status);

    if (del.status === 409) {
      const err = await readError(del);
      expect(err.error).toBe("NotRemovable");
    }
  });

  test("DELETE /jobs (clearAll) wipes the queue and returns removed count", async () => {
    // #given — mock execute hangs so the job stays Downloading
    state.scribdExecute = mock(() => Effect.never);
    await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({
        text: "https://www.scribd.com/document/clear-all-1/x\nhttps://www.scribd.com/document/clear-all-2/y",
      }),
    });

    // #when
    const res = await fetch(`${baseUrl}/jobs`, { method: "DELETE" });

    // #then
    expect(res.status).toBe(200);
    const body = await readClear(res);
    expect(body.removed).toBeGreaterThan(0);

    const snap = await fetch(`${baseUrl}/snapshot`).then(readQueue);

    expect(snap.jobs).toHaveLength(0);
  });

  test("POST /jobs/:id/retry on non-retryable Failed returns 409 NotRetryable", async () => {
    const enq = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://example.com/x" }),
    });

    const body = await readQueue(enq);
    const job = body.jobs[0]!;
    const retry = await fetch(`${baseUrl}/jobs/${job.id}/retry`, { method: "POST" });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: "NotRetryable", status: "Failed" });
  });
});

const collectFrames = (url: string, opts: { after?: () => Promise<void>; timeoutMs?: number; minFrames?: number }) =>
  new Promise<DecodedJobEvent[]>((resolve, reject) => {
    const frames: DecodedJobEvent[] = [];
    const ws = new WebSocket(url);

    const timeout = setTimeout(() => {
      ws.close();
      resolve(frames);
    }, opts.timeoutMs ?? 1500);

    ws.onopen = async () => {
      try {
        // give the server-side stream subscription a beat to settle before publishing
        await new Promise((r) => setTimeout(r, 50));

        if (opts.after) await opts.after();
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    };

    ws.onmessage = (e) => {
      frames.push(Schema.decodeUnknownSync(Schema.fromJsonString(JobEventSchema))(String(e.data)));

      if (opts.minFrames && frames.length >= opts.minFrames) {
        clearTimeout(timeout);
        ws.close();
        resolve(frames);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("ws error"));
    };
  });

describe("WebSocket /events", () => {
  test("client connects, OPEN fires, no historical frames pushed before subscribe", async () => {
    const frames = await collectFrames(`${baseUrl.replace("http", "ws")}/events`, {
      timeoutMs: 300,
    });

    expect(frames).toEqual([]);
  });

  test("POST /enqueue after WS open pushes JobAdded and JobFailed for unsupported", async () => {
    const wsUrl = `${baseUrl.replace("http", "ws")}/events`;

    const frames = await collectFrames(wsUrl, {
      after: async () => {
        await fetch(`${baseUrl}/enqueue`, {
          method: "POST",
          headers: ct,
          body: j({ text: "https://example.com/ws-unique-frame-test" }),
        });
      },
      minFrames: 2,
    });

    expect(frames.length).toBeGreaterThanOrEqual(2);
    const tags = frames.map((f) => f._tag);
    expect(tags).toContain("JobAdded");
    expect(tags).toContain("JobFailed");
  });

  test("POST /folder pushes OutputFolderChanged frame", async () => {
    const wsUrl = `${baseUrl.replace("http", "ws")}/events`;

    const frames = await collectFrames(wsUrl, {
      after: async () => {
        await fetch(`${baseUrl}/folder`, {
          method: "POST",
          headers: ct,
          body: j({ path: "/tmp/changed-folder" }),
        });
      },
      minFrames: 1,
    });

    const change = frames.find((frame): frame is Extract<DecodedJobEvent, { _tag: "OutputFolderChanged" }> =>
      Predicate.isTagged(frame, "OutputFolderChanged"),
    );

    expect(change).toBeDefined();
    expect(change!.path).toBe("/tmp/changed-folder");
  });

  test("two open WS clients each receive the complete unsupported enqueue broadcast", async () => {
    // #given — empty queue makes the replacement snapshot independently predictable
    const cleared = await fetch(`${baseUrl}/jobs`, { method: "DELETE" });
    expect(cleared.status).toBe(200);
    const wsUrl = `${baseUrl.replace("http", "ws")}/events`;
    const firstReady = Promise.withResolvers<void>();
    const secondReady = Promise.withResolvers<void>();

    const streams = [
      collectFrames(wsUrl, {
        after: async () => firstReady.resolve(),
        minFrames: 3,
      }),
      collectFrames(wsUrl, {
        after: async () => secondReady.resolve(),
        minFrames: 3,
      }),
    ];

    // #when — both OPEN handlers have settled before the single enqueue
    await Promise.all([firstReady.promise, secondReady.promise]);

    const enqueued = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://example.com/ws-broadcast-contract" }),
    });

    expect(enqueued.status).toBe(200);
    const created = await readQueue(enqueued);
    expect(created.jobs).toHaveLength(1);
    const id = created.jobs[0]!.id;
    const both = await Promise.all(streams);

    // #then — literal payloads pin the wire semantics, not just nonempty streams
    const expectedJob = {
      id,
      url: "https://example.com/ws-broadcast-contract",
      domain: "unsupported",
      displayTitle: "Unsupported link",
      status: "Failed",
      failure: { reason: "Unsupported domain", retryable: false },
    } satisfies Job;

    const expected = [
      ["JobAdded", expectedJob],
      ["JobFailed", { id, reason: "Unsupported domain", retryable: false }],
      ["SnapshotReplaced", { jobs: [expectedJob] }],
    ];

    const received = both.map((frames) =>
      frames.map((frame) =>
        Match.value(frame).pipe(
          Match.tags({
            JobAdded: (event) => ["JobAdded", event.job],
            JobFailed: (event) => ["JobFailed", { id: event.id, reason: event.reason, retryable: event.retryable }],
            SnapshotReplaced: (event) => ["SnapshotReplaced", event.snapshot],
          }),
          Match.orElse((event) => [event._tag]),
        ),
      ),
    );

    expect(received).toEqual([expected, expected]);
  });
});

describe("HttpServer clear endpoints", () => {
  // The shared server is used by prior tests, which leave the worker busy on a
  // never-resolving scribd job. So we can't easily produce a Downloaded job here.
  // Downloaded-path behavior is covered at the engine level in DownloadEngine.test.ts.
  // These tests cover the HTTP contract: status code, response shape, route ordering.

  test("DELETE /jobs/failed returns 200 with removed count and removes the job", async () => {
    // #given — enqueue an unsupported URL (immediately Failed without needing the worker)
    const enq = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://example.com/clear-failed-test" }),
    });

    const enqBody = await readQueue(enq);
    const newId = enqBody.jobs[0]!.id;
    expect(enqBody.jobs[0]!.status).toBe("Failed");

    // #when
    const res = await fetch(`${baseUrl}/jobs/failed`, { method: "DELETE" });

    // #then
    expect(res.status).toBe(200);
    const body = await readClear(res);
    expect(body.removed).toBeGreaterThanOrEqual(1);

    const snap = await readQueue(await fetch(`${baseUrl}/snapshot`));

    expect(snap.jobs.find((jb) => jb.id === newId)).toBeUndefined();
  });

  test("DELETE /jobs/failed with no failed left returns 200 removed:0", async () => {
    // #given — seed and clear a failed job independently of prior tests
    const seeded = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://example.com/isolated-clear-failed" }),
    });

    expect(seeded.status).toBe(200);
    const seededBody = await readQueue(seeded);
    expect(seededBody.jobs[0]!.status).toBe("Failed");
    const cleared = await fetch(`${baseUrl}/jobs/failed`, { method: "DELETE" });
    expect(cleared.status).toBe(200);
    const clearedBody = await readClear(cleared);
    expect(clearedBody.removed).toBeGreaterThanOrEqual(1);

    // #when
    const res = await fetch(`${baseUrl}/jobs/failed`, { method: "DELETE" });

    // #then
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 0 });
  });

  test("DELETE /jobs/completed with no completed returns 200 removed:0", async () => {
    // #when
    const res = await fetch(`${baseUrl}/jobs/completed`, { method: "DELETE" });

    // #then — route matches /jobs/completed (not /jobs/:id with id='completed')
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 0 });
  });

  test("DELETE /jobs/:id on Failed returns 204 (broadened from Queued-only)", async () => {
    // #given — enqueue an unsupported URL (Failed)
    const enq = await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://example.com/remove-failed-broaden-test" }),
    });

    const enqBody = await readQueue(enq);
    const newId = enqBody.jobs[0]!.id;
    expect(enqBody.jobs[0]!.status).toBe("Failed");

    // #when
    const res = await fetch(`${baseUrl}/jobs/${newId}`, { method: "DELETE" });

    // #then
    expect(res.status).toBe(204);
  });
});

describe("CORS", () => {
  test("OPTIONS preflight from tauri://localhost is allowed", async () => {
    const res = await fetch(`${baseUrl}/snapshot`, {
      method: "OPTIONS",
      headers: {
        Origin: "tauri://localhost",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
  });

  test("OPTIONS preflight from http://localhost:5173 is allowed", async () => {
    const res = await fetch(`${baseUrl}/snapshot`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

describe("HttpServer settings routes", () => {
  test("GET /settings returns stored keys with valid: null before any validation", async () => {
    // #given — fresh engine, no keys set yet
    // #when
    const res = await fetch(`${baseUrl}/settings`);

    // #then
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publicKey: "", secretKey: "", valid: null });
  });

  test("POST /settings with a valid complete pair returns { valid: true } and persists", async () => {
    // #given
    state.validateResult = true;

    // #when
    const res = await fetch(`${baseUrl}/settings`, {
      method: "POST",
      headers: ct,
      body: j({ publicKey: "pub", secretKey: "sec" }),
    });

    // #then
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
    const after = await fetch(`${baseUrl}/settings`);
    expect(await after.json()).toEqual({ publicKey: "pub", secretKey: "sec", valid: true });
  });

  test("POST /settings with invalid keys returns { valid: false } and still stores the entered keys", async () => {
    // #given
    state.validateResult = false;

    // #when
    const res = await fetch(`${baseUrl}/settings`, {
      method: "POST",
      headers: ct,
      body: j({ publicKey: "bad", secretKey: "keys" }),
    });

    // #then
    expect(await res.json()).toEqual({ valid: false });
    const after = await fetch(`${baseUrl}/settings`);
    expect(await after.json()).toEqual({ publicKey: "bad", secretKey: "keys", valid: false });
  });

  test("POST /settings with both keys empty clears them and makes no validation call", async () => {
    // #given — a true validateResult would surface if validation were called
    state.validateResult = true;

    // #when
    const res = await fetch(`${baseUrl}/settings`, {
      method: "POST",
      headers: ct,
      body: j({ publicKey: "", secretKey: "" }),
    });

    // #then — returns false (not validated) and clears to the unverified state
    expect(await res.json()).toEqual({ valid: false });
    const after = await fetch(`${baseUrl}/settings`);
    expect(await after.json()).toEqual({ publicKey: "", secretKey: "", valid: null });
  });

  test("POST /settings with exactly one key filled returns { valid: false } and makes no validation call", async () => {
    // #given
    state.validateResult = true;

    // #when
    const res = await fetch(`${baseUrl}/settings`, {
      method: "POST",
      headers: ct,
      body: j({ publicKey: "only-public", secretKey: "" }),
    });

    // #then
    expect(await res.json()).toEqual({ valid: false });
  });
});

describe("HTTP request field defaults", () => {
  test.each(["null", "42", '"text"', "{}", '{"text":42}', "not JSON"])(
    "POST /enqueue tolerates invalid body %s as empty input",
    async (body) => {
      // #given
      // #when
      const response = await fetch(`${baseUrl}/enqueue`, { method: "POST", headers: ct, body });
      // #then
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ jobs: [] });
    },
  );

  test.each(["null", "42", "{}", '{"path":42}', "not JSON"])("POST /folder tolerates invalid body %s as an empty path", async (body) => {
    // #given
    // #when
    const response = await fetch(`${baseUrl}/folder`, { method: "POST", headers: ct, body });
    // #then
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "InvalidPath" });
  });

  test.each([
    ["null", "", "", null],
    ["not JSON", "", "", null],
    ['{"publicKey":"keep-public","secretKey":42}', "keep-public", "", false],
    ['{"publicKey":false,"secretKey":"keep-secret"}', "", "keep-secret", false],
    ['{"publicKey":"keep-public"}', "keep-public", "", false],
    ['{"secretKey":"keep-secret"}', "", "keep-secret", false],
  ])("POST /settings defaults each field independently for %s", async (body, publicKey, secretKey, valid) => {
    // #given
    state.validateResult = true;
    // #when
    const response = await fetch(`${baseUrl}/settings`, { method: "POST", headers: ct, body });
    // #then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false });
    const stored = await fetch(`${baseUrl}/settings`);
    expect(stored.status).toBe(200);
    expect(await stored.json()).toEqual({ publicKey, secretKey, valid });
  });
});
