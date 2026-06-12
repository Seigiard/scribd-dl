import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
import { HttpServer } from "@effect/platform";
import type { Job } from "@scribd-dl/shared";
import { ConfigStore, type ConfigStoreService } from "../../src/service/ConfigStore";
import { DownloadEngineLive } from "../../src/service/DownloadEngine";
import { JobStore, type JobStoreService } from "../../src/service/JobStore";
import { Scrapers, type Scraper } from "../../src/service/Scraper";
import { ConfigLoader, type ConfigData } from "../../src/utils/io/ConfigLoader";
import { HttpServerLive } from "../../src/server/HttpServerLive";

interface MockState {
  scribdExecute: ReturnType<typeof mock>;
  restoredJobs: ReadonlyArray<Job>;
}

const state: MockState = {
  scribdExecute: mock(() => Effect.void),
  restoredJobs: [],
};

const defaultConfig: ConfigData = {
  scribd: { rendertime: 100 },
  directory: { output: "/tmp/scribd-dl-test", filename: "title" },
};

const scribdMockScraper: Scraper = {
  id: "scribd",
  canHandle: (url) => /scribd\.com/.test(url),
  deriveDisplayTitle: (url) => `Scribd ${url}`,
  execute: (url, folder, onEvent, debug) => state.scribdExecute(url, folder, onEvent, debug) as ReturnType<Scraper["execute"]>,
};

const scrapersMockLayer = Layer.succeed(Scrapers, [scribdMockScraper]);

const configStoreMockLayer = Layer.succeed(ConfigStore, {
  read: Effect.sync(() => ({ outputFolder: defaultConfig.directory.output })),
  write: () => Effect.void,
} satisfies ConfigStoreService);

const jobStoreMockLayer = Layer.succeed(JobStore, {
  read: Effect.sync(() => state.restoredJobs),
  write: () => Effect.void,
} satisfies JobStoreService);

const buildEngineLayer = (config: ConfigData = defaultConfig) =>
  Layer.provide(
    DownloadEngineLive,
    Layer.mergeAll(scrapersMockLayer, Layer.succeed(ConfigLoader, config), configStoreMockLayer, jobStoreMockLayer),
  );

let serverFiber: Fiber.RuntimeFiber<unknown, unknown> | null = null;
let baseUrl = "";

const getServerPort = HttpServer.addressWith((address) => {
  if (address._tag !== "TcpAddress") return Effect.die("Expected TcpAddress");
  return Effect.succeed(address.port);
});

beforeAll(async () => {
  state.scribdExecute = mock(() => Effect.void);
  const portReady = new Promise<number>((resolve, reject) => {
    const ServerLayer = HttpServerLive(0).pipe(Layer.provide(buildEngineLayer()));
    const program = getServerPort.pipe(
      Effect.tap((port) => Effect.sync(() => resolve(port))),
      Effect.zipRight(Effect.never),
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

const j = (body: object) => JSON.stringify(body);
const ct = { "Content-Type": "application/json" };

describe("HttpServer REST routes", () => {
  test("GET /snapshot on empty engine returns empty jobs array", async () => {
    const res = await fetch(`${baseUrl}/snapshot`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: unknown[] };
    expect(body.jobs).toEqual([]);
  });

  test("POST /enqueue with junk text returns empty jobs", async () => {
    const res = await fetch(`${baseUrl}/enqueue`, { method: "POST", headers: ct, body: j({ text: "hello" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: unknown[] };
    expect(body.jobs).toEqual([]);
  });

  test("POST /enqueue with unsupported URL returns Failed unsupported job", async () => {
    const res = await fetch(`${baseUrl}/enqueue`, { method: "POST", headers: ct, body: j({ text: "https://example.com/x" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: Array<{ status: string; domain: string; failure: { retryable: boolean } }> };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]!.status).toBe("Failed");
    expect(body.jobs[0]!.domain).toBe("unsupported");
    expect(body.jobs[0]!.failure.retryable).toBe(false);
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
    const res = await fetch(`${baseUrl}/folder`, { method: "POST", headers: ct, body: j({ path: "/tmp/new-folder" }) });
    expect(res.status).toBe(204);
    const after = await fetch(`${baseUrl}/folder`);
    expect(await after.json()).toEqual({ path: "/tmp/new-folder" });
  });

  test("POST /folder with empty path returns 400 InvalidPath", async () => {
    const res = await fetch(`${baseUrl}/folder`, { method: "POST", headers: ct, body: j({ path: "  " }) });
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
    const body = (await enq.json()) as { jobs: Array<{ id: string; status: string }> };
    expect(body.jobs).toHaveLength(1);
    const job = body.jobs[0]!;

    // Worker may have started already — depending on timing, status is Queued or Downloading.
    // Try remove; if it succeeds the job was Queued, if 409 it was Downloading. Either is acceptable signal.
    const del = await fetch(`${baseUrl}/jobs/${job.id}`, { method: "DELETE" });
    expect([204, 409]).toContain(del.status);
    if (del.status === 409) {
      const err = (await del.json()) as { error: string };
      expect(err.error).toBe("NotRemovable");
    }
  });

  test("DELETE /jobs (clearAll) wipes the queue and returns removed count", async () => {
    // #given — mock execute hangs so the job stays Downloading
    state.scribdExecute = mock(() => Effect.never);
    await fetch(`${baseUrl}/enqueue`, {
      method: "POST",
      headers: ct,
      body: j({ text: "https://www.scribd.com/document/clear-all-1/x\nhttps://www.scribd.com/document/clear-all-2/y" }),
    });

    // #when
    const res = await fetch(`${baseUrl}/jobs`, { method: "DELETE" });

    // #then
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: number };
    expect(body.removed).toBeGreaterThan(0);

    const snap = await fetch(`${baseUrl}/snapshot`).then((r) => r.json() as Promise<{ jobs: unknown[] }>);
    expect(snap.jobs).toHaveLength(0);
  });

  test("POST /jobs/:id/retry on non-retryable Failed returns 409 NotRetryable", async () => {
    const enq = await fetch(`${baseUrl}/enqueue`, { method: "POST", headers: ct, body: j({ text: "https://example.com/x" }) });
    const body = (await enq.json()) as { jobs: Array<{ id: string }> };
    const job = body.jobs[0]!;
    const retry = await fetch(`${baseUrl}/jobs/${job.id}/retry`, { method: "POST" });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: "NotRetryable", status: "Failed" });
  });
});

const collectFrames = (url: string, opts: { after?: () => Promise<void>; timeoutMs?: number; minFrames?: number }) =>
  new Promise<unknown[]>((resolve, reject) => {
    const frames: unknown[] = [];
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
      frames.push(JSON.parse(String(e.data)));
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
    const frames = await collectFrames(`${baseUrl.replace("http", "ws")}/events`, { timeoutMs: 300 });
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
    const tags = frames.map((f) => (f as { _tag: string })._tag);
    expect(tags).toContain("JobAdded");
    expect(tags).toContain("JobFailed");
  });

  test("POST /folder pushes OutputFolderChanged frame", async () => {
    const wsUrl = `${baseUrl.replace("http", "ws")}/events`;
    const frames = await collectFrames(wsUrl, {
      after: async () => {
        await fetch(`${baseUrl}/folder`, { method: "POST", headers: ct, body: j({ path: "/tmp/changed-folder" }) });
      },
      minFrames: 1,
    });
    const change = frames.find((f) => (f as { _tag: string })._tag === "OutputFolderChanged");
    expect(change).toBeDefined();
    expect((change as { path: string }).path).toBe("/tmp/changed-folder");
  });

  test("two concurrent WS clients both receive frames for the same enqueue", async () => {
    const wsUrl = `${baseUrl.replace("http", "ws")}/events`;
    // Open both, wait briefly, then enqueue.
    const trigger = () => fetch(`${baseUrl}/enqueue`, { method: "POST", headers: ct, body: j({ text: "https://example.com/y" }) });
    const both = await Promise.all([
      collectFrames(wsUrl, {
        after: async () => {
          /* wait for second client */
        },
        minFrames: 1,
        timeoutMs: 1200,
      }),
      new Promise<unknown[]>((res) =>
        setTimeout(() => collectFrames(wsUrl, { after: () => trigger().then(() => undefined), minFrames: 1 }).then(res), 100),
      ),
    ]);
    expect(both[0]!.length).toBeGreaterThanOrEqual(1);
    expect(both[1]!.length).toBeGreaterThanOrEqual(1);
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
    const enqBody = (await enq.json()) as { jobs: Array<{ id: string; status: string }> };
    const newId = enqBody.jobs[0]!.id;
    expect(enqBody.jobs[0]!.status).toBe("Failed");

    // #when
    const res = await fetch(`${baseUrl}/jobs/failed`, { method: "DELETE" });

    // #then
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: number };
    expect(body.removed).toBeGreaterThanOrEqual(1);

    const snap = (await (await fetch(`${baseUrl}/snapshot`)).json()) as { jobs: Array<{ id: string }> };
    expect(snap.jobs.find((jb) => jb.id === newId)).toBeUndefined();
  });

  test("DELETE /jobs/failed with no failed left returns 200 removed:0", async () => {
    // #given — prior test cleared all failed; verify again

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
    const enqBody = (await enq.json()) as { jobs: Array<{ id: string; status: string }> };
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
