import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { enqueueText, fetchFolder, fetchSnapshot, removeJob, retryJob, setFolder, subscribeEvents, toWsUrl } from "../src/client";
import type { JobEvent } from "../src/jobs";

const BASE = "http://localhost:4747";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const emptyResponse = (status: number): Response => new Response(null, { status });

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("toWsUrl", () => {
  test("http -> ws", () => {
    expect(toWsUrl("http://localhost:4747")).toBe("ws://localhost:4747");
  });
  test("https -> wss", () => {
    expect(toWsUrl("https://example.com")).toBe("wss://example.com");
  });
});

describe("fetchSnapshot", () => {
  test("returns parsed snapshot on 200", async () => {
    globalThis.fetch = mock(async () => jsonResponse(200, { jobs: [] })) as typeof fetch;
    const snap = await fetchSnapshot(BASE);
    expect(snap).toEqual({ jobs: [] });
  });

  test("throws on non-ok", async () => {
    globalThis.fetch = mock(async () => emptyResponse(500)) as typeof fetch;
    await expect(fetchSnapshot(BASE)).rejects.toThrow(/GET \/snapshot failed: 500/);
  });
});

describe("enqueueText", () => {
  test("POSTs JSON body to /enqueue and returns response", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return jsonResponse(200, { jobs: [] });
    }) as typeof fetch;

    const out = await enqueueText(BASE, "https://example.com/doc/1");

    expect(captured!.url).toBe(`${BASE}/enqueue`);
    expect(captured!.init.method).toBe("POST");
    expect((captured!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(captured!.init.body).toBe(JSON.stringify({ text: "https://example.com/doc/1" }));
    expect(out).toEqual({ jobs: [] });
  });

  test("throws on non-ok", async () => {
    globalThis.fetch = mock(async () => emptyResponse(500)) as typeof fetch;
    await expect(enqueueText(BASE, "x")).rejects.toThrow(/POST \/enqueue failed: 500/);
  });
});

describe("removeJob", () => {
  test("DELETE /jobs/{id}, succeeds on 200", async () => {
    let captured: string | null = null;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      captured = String(url);
      expect(init?.method).toBe("DELETE");
      return emptyResponse(200);
    }) as typeof fetch;
    await removeJob(BASE, "job 1");
    expect(captured).toBe(`${BASE}/jobs/job%201`);
  });

  test("ignores 404 and 409", async () => {
    for (const status of [404, 409]) {
      globalThis.fetch = mock(async () => emptyResponse(status)) as typeof fetch;
      await expect(removeJob(BASE, "x")).resolves.toBeUndefined();
    }
  });

  test("throws on 500", async () => {
    globalThis.fetch = mock(async () => emptyResponse(500)) as typeof fetch;
    await expect(removeJob(BASE, "x")).rejects.toThrow(/DELETE \/jobs failed: 500/);
  });
});

describe("retryJob", () => {
  test("POST /jobs/{id}/retry", async () => {
    let captured: { url: string; method: string } | null = null;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), method: init?.method ?? "" };
      return emptyResponse(200);
    }) as typeof fetch;
    await retryJob(BASE, "abc");
    expect(captured!.url).toBe(`${BASE}/jobs/abc/retry`);
    expect(captured!.method).toBe("POST");
  });

  test("ignores 404/409, throws on 500", async () => {
    globalThis.fetch = mock(async () => emptyResponse(404)) as typeof fetch;
    await expect(retryJob(BASE, "x")).resolves.toBeUndefined();
    globalThis.fetch = mock(async () => emptyResponse(500)) as typeof fetch;
    await expect(retryJob(BASE, "x")).rejects.toThrow(/POST \/jobs\/retry failed: 500/);
  });
});

describe("fetchFolder / setFolder", () => {
  test("fetchFolder returns path field", async () => {
    globalThis.fetch = mock(async () => jsonResponse(200, { path: "/tmp/out" })) as typeof fetch;
    expect(await fetchFolder(BASE)).toBe("/tmp/out");
  });

  test("setFolder POSTs path body", async () => {
    let captured: { url: string; body: string } | null = null;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body ?? "") };
      return emptyResponse(200);
    }) as typeof fetch;
    await setFolder(BASE, "/new");
    expect(captured!.url).toBe(`${BASE}/folder`);
    expect(captured!.body).toBe(JSON.stringify({ path: "/new" }));
  });
});

describe("subscribeEvents", () => {
  type Handler = (event: { type?: string; data?: string }) => void;
  interface FakeWs {
    url: string;
    onopen: Handler | null;
    onmessage: Handler | null;
    onclose: Handler | null;
    onerror: Handler | null;
    close: () => void;
  }
  let created: FakeWs | null = null;
  const originalWs = globalThis.WebSocket;

  beforeEach(() => {
    created = null;
    class FakeWebSocket {
      url: string;
      onopen: Handler | null = null;
      onmessage: Handler | null = null;
      onclose: Handler | null = null;
      onerror: Handler | null = null;
      closeCalls = 0;
      constructor(url: string) {
        this.url = url;
        created = this as unknown as FakeWs;
      }
      close() {
        this.closeCalls += 1;
        this.onclose?.({});
      }
    }
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = originalWs;
  });

  test("opens ws against ws://.../events and calls onOpen", () => {
    let opened = false;
    subscribeEvents(BASE, { onMessage: () => {}, onOpen: () => (opened = true) });
    expect(created!.url).toBe("ws://localhost:4747/events");
    created!.onopen?.({});
    expect(opened).toBe(true);
  });

  test("parses JSON message into JobEvent and forwards", () => {
    const received: JobEvent[] = [];
    subscribeEvents(BASE, { onMessage: (e) => received.push(e) });
    const event: JobEvent = { _tag: "JobRemoved", id: "x" };
    created!.onmessage?.({ data: JSON.stringify(event) });
    expect(received).toEqual([event]);
  });

  test("invokes onError on parse failure", () => {
    let errored = false;
    subscribeEvents(BASE, { onMessage: () => {}, onError: () => (errored = true) });
    created!.onmessage?.({ data: "not-json" });
    expect(errored).toBe(true);
  });

  test("close() closes the underlying ws", () => {
    const sub = subscribeEvents(BASE, { onMessage: () => {} });
    sub.close();
    expect((created as unknown as { closeCalls: number }).closeCalls).toBe(1);
  });
});
