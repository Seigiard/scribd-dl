import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { Text } from "ink";
import React from "react";
import type { EngineSnapshot, JobEvent } from "@scribd-dl/shared";
import { useEngineState } from "../src/hooks/useEngineState";

const BASE = "http://localhost:4747";

const flush = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

type FakeWsHandler = (data: unknown) => void;

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  url: string;
  onopen: FakeWsHandler | null = null;
  onmessage: FakeWsHandler | null = null;
  onclose: FakeWsHandler | null = null;
  onerror: FakeWsHandler | null = null;
  closeCalls = 0;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.last = this;
  }
  close() {
    this.closeCalls += 1;
    this.onclose?.({});
  }
}

const originalFetch = globalThis.fetch;
const originalWs = globalThis.WebSocket;

let snapshots: EngineSnapshot[] = [];
let snapshotCalls = 0;

const installFetchStub = (...frames: EngineSnapshot[]): void => {
  snapshots = [...frames];
  snapshotCalls = 0;
  globalThis.fetch = (async () => {
    const next = snapshots.shift() ?? { jobs: [] };
    snapshotCalls += 1;
    return new Response(JSON.stringify(next), { status: 200 });
  }) as typeof fetch;
};

beforeEach(() => {
  FakeWebSocket.last = null;
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { WebSocket: unknown }).WebSocket = originalWs;
});

const Probe = ({ baseUrl }: { baseUrl: string }) => {
  const { snapshot, folder } = useEngineState(baseUrl, "/initial");
  return React.createElement(Text, null, `count=${snapshot.jobs.length} folder=${folder ?? "null"}`);
};

describe("useEngineState (HTTP/WS client)", () => {
  test("initial mount fetches snapshot and renders zero jobs", async () => {
    // #given
    installFetchStub({ jobs: [] });

    // #when
    const ui = render(React.createElement(Probe, { baseUrl: BASE }));
    await flush();

    // #then
    expect(ui.lastFrame()).toContain("count=0");
    expect(ui.lastFrame()).toContain("folder=/initial");
    expect(snapshotCalls).toBeGreaterThanOrEqual(1);
    ui.unmount();
  });

  test("WS subscription targets ws://.../events", async () => {
    // #given
    installFetchStub({ jobs: [] });

    // #when
    const ui = render(React.createElement(Probe, { baseUrl: BASE }));
    await flush();

    // #then
    expect(FakeWebSocket.last?.url).toBe("ws://localhost:4747/events");
    ui.unmount();
  });

  test("each WS message triggers a snapshot refetch", async () => {
    // #given
    installFetchStub({ jobs: [] }, { jobs: [{ id: "a", url: "u", domain: "scribd", displayTitle: "t", status: "Queued" }] });
    const ui = render(React.createElement(Probe, { baseUrl: BASE }));
    await flush();
    const callsBefore = snapshotCalls;

    // #when
    const event: JobEvent = { _tag: "JobAdded", job: { id: "a", url: "u", domain: "scribd", displayTitle: "t", status: "Queued" } };
    FakeWebSocket.last!.onmessage!({ data: JSON.stringify(event) });
    await flush();

    // #then
    expect(snapshotCalls).toBe(callsBefore + 1);
    expect(ui.lastFrame()).toContain("count=1");
    ui.unmount();
  });

  test("OutputFolderChanged event updates folder without refetching snapshot", async () => {
    // #given
    installFetchStub({ jobs: [] });
    const ui = render(React.createElement(Probe, { baseUrl: BASE }));
    await flush();
    const callsBefore = snapshotCalls;

    // #when
    const event: JobEvent = { _tag: "OutputFolderChanged", path: "/new/path" };
    FakeWebSocket.last!.onmessage!({ data: JSON.stringify(event) });
    await flush();

    // #then
    expect(ui.lastFrame()).toContain("folder=/new/path");
    expect(snapshotCalls).toBe(callsBefore);
    ui.unmount();
  });

  test("unmount closes the WS subscription", async () => {
    // #given
    installFetchStub({ jobs: [] });
    const ui = render(React.createElement(Probe, { baseUrl: BASE }));
    await flush();
    const ws = FakeWebSocket.last!;

    // #when
    ui.unmount();

    // #then
    expect(ws.closeCalls).toBe(1);
  });
});
