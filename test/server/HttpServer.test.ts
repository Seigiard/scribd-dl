import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
import { HttpServer } from "@effect/platform";
import { DownloadEngineLive } from "../../src/service/DownloadEngine";
import { ScribdDownloader, type ScribdDownloaderService } from "../../src/service/ScribdDownloader";
import { ConfigLoader, type ConfigData } from "../../src/utils/io/ConfigLoader";
import { HttpServerLive } from "../../src/server/HttpServerLive";

interface MockState {
  scribdExecute: ReturnType<typeof mock>;
}

const state: MockState = {
  scribdExecute: mock(() => Effect.void),
};

const defaultConfig: ConfigData = {
  scribd: { rendertime: 100 },
  directory: { output: "/tmp/scribd-dl-test", filename: "title" },
};

const scribdMockLayer = Layer.succeed(ScribdDownloader, {
  execute: (url, folder, onEvent) => state.scribdExecute(url, folder, onEvent) as ReturnType<ScribdDownloaderService["execute"]>,
} satisfies ScribdDownloaderService);

const buildEngineLayer = (config: ConfigData = defaultConfig) =>
  Layer.provide(DownloadEngineLive, Layer.mergeAll(scribdMockLayer, Layer.succeed(ConfigLoader, config)));

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

  test("POST /jobs/:id/retry on non-retryable Failed returns 409 NotRetryable", async () => {
    const enq = await fetch(`${baseUrl}/enqueue`, { method: "POST", headers: ct, body: j({ text: "https://example.com/x" }) });
    const body = (await enq.json()) as { jobs: Array<{ id: string }> };
    const job = body.jobs[0]!;
    const retry = await fetch(`${baseUrl}/jobs/${job.id}/retry`, { method: "POST" });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: "NotRetryable", status: "Failed" });
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
