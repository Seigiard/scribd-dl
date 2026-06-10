import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useEngineState } from "../src/hooks/useEngineState";
import type { EngineSnapshot } from "@scribd-dl/shared";

interface MockWS {
  url: string;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null;
  close(): void;
  send(): void;
}

const sockets: MockWS[] = [];

class FakeSocket implements MockWS {
  url: string;
  onopen: MockWS["onopen"] = null;
  onmessage: MockWS["onmessage"] = null;
  onclose: MockWS["onclose"] = null;
  onerror: MockWS["onerror"] = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent("close"));
  }
  send() {}
}

const lastSocket = (): FakeSocket => sockets[sockets.length - 1] as FakeSocket;

const triggerOpen = (s: FakeSocket) => act(() => s.onopen?.call(s as unknown as WebSocket, new Event("open")));
const triggerMessage = (s: FakeSocket, data: unknown) =>
  act(() => s.onmessage?.call(s as unknown as WebSocket, new MessageEvent("message", { data: JSON.stringify(data) })));
const triggerClose = (s: FakeSocket) => act(() => s.close());

const setBackend = (url: string) => {
  Object.defineProperty(window, "__SCRIBD_DL_BACKEND__", { value: url, configurable: true });
};

const snapshotFor = (snap: EngineSnapshot) => ({
  ok: true,
  status: 200,
  json: async () => snap,
});

beforeEach(() => {
  sockets.length = 0;
  setBackend("http://test-backend:1234");
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__SCRIBD_DL_BACKEND__");
});

describe("useEngineState", () => {
  test("opens WS, fetches snapshot on open, exposes snapshot via state", async () => {
    // #given
    const fetchMock = vi
      .fn()
      .mockResolvedValue(snapshotFor({ jobs: [{ id: "j1", url: "u", domain: "scribd", displayTitle: "t", status: "Queued" }] }));
    vi.stubGlobal("fetch", fetchMock);

    // #when
    const { result } = renderHook(() => useEngineState());
    await waitFor(() => expect(lastSocket()).toBeDefined());
    await triggerOpen(lastSocket());

    // #then
    await waitFor(() => expect(result.current.snapshot.jobs).toHaveLength(1));
    expect(result.current.snapshot.jobs[0]!.id).toBe("j1");
    expect(result.current.isConnected).toBe(true);
    expect(result.current.baseUrl).toBe("http://test-backend:1234");
    expect(fetchMock).toHaveBeenCalledWith("http://test-backend:1234/snapshot");
  });

  test("WS frame triggers snapshot refetch", async () => {
    // #given
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls += 1;
      return snapshotFor({
        jobs: Array.from({ length: calls }, (_, i) => ({
          id: `j${i}`,
          url: "u",
          domain: "scribd" as const,
          displayTitle: "t",
          status: "Queued" as const,
        })),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEngineState());
    await waitFor(() => expect(lastSocket()).toBeDefined());
    await triggerOpen(lastSocket());
    await waitFor(() => expect(result.current.snapshot.jobs).toHaveLength(1));

    // #when
    await triggerMessage(lastSocket(), {
      _tag: "JobAdded",
      job: { id: "x", url: "u", domain: "scribd", displayTitle: "t", status: "Queued" },
    });

    // #then
    await waitFor(() => expect(result.current.snapshot.jobs).toHaveLength(2));
  });

  test("WS close sets isConnected=false", async () => {
    // #given
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(snapshotFor({ jobs: [] })));
    const { result } = renderHook(() => useEngineState());
    await waitFor(() => expect(lastSocket()).toBeDefined());
    await triggerOpen(lastSocket());
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    // #when
    await triggerClose(lastSocket());

    // #then
    await waitFor(() => expect(result.current.isConnected).toBe(false));
  });

  test("reconnect() opens a new WebSocket and re-fetches snapshot", async () => {
    // #given
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(snapshotFor({ jobs: [] })));
    const { result } = renderHook(() => useEngineState());
    await waitFor(() => expect(lastSocket()).toBeDefined());
    await triggerOpen(lastSocket());
    const first = lastSocket();
    await triggerClose(first);

    // #when
    act(() => result.current.reconnect());

    // #then
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(sockets[1]).not.toBe(first);
  });

  test("unmount closes the WebSocket", async () => {
    // #given
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(snapshotFor({ jobs: [] })));
    const { unmount } = renderHook(() => useEngineState());
    await waitFor(() => expect(lastSocket()).toBeDefined());
    await triggerOpen(lastSocket());
    const s = lastSocket();
    expect(s.closed).toBe(false);

    // #when
    unmount();

    // #then
    expect(s.closed).toBe(true);
  });

  test("snapshot-then-subscribe ordering: snapshot fetch happens after onopen, not before", async () => {
    // #given
    const fetchMock = vi.fn().mockResolvedValue(snapshotFor({ jobs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useEngineState());
    await waitFor(() => expect(lastSocket()).toBeDefined());

    // #when — socket exists but onopen has not fired yet
    // #then — no fetch should have happened
    expect(fetchMock).not.toHaveBeenCalled();

    // #when — fire onopen
    await triggerOpen(lastSocket());

    // #then — fetch fires exactly once for the open event
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
