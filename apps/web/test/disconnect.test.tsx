import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App";

interface SocketRef {
  current: TestSocket | null;
}

class TestSocket {
  url: string;
  onopen: ((e: Event) => unknown) | null = null;
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  onclose: ((e: CloseEvent) => unknown) | null = null;
  onerror: ((e: Event) => unknown) | null = null;
  closed = false;
  constructor(url: string, ref: SocketRef) {
    this.url = url;
    ref.current = this;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.(new CloseEvent("close"));
  }
  send() {}
}

const socketRef: SocketRef = { current: null };

beforeEach(() => {
  socketRef.current = null;
  Object.defineProperty(window, "__SCRIBD_DL_BACKEND__", { value: "http://stub:0", configurable: true });
  vi.stubGlobal(
    "WebSocket",
    class extends TestSocket {
      constructor(url: string) {
        super(url, socketRef);
      }
    },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ jobs: [], path: "/x" }) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__SCRIBD_DL_BACKEND__");
});

const waitForSocket = async () => waitFor(() => expect(socketRef.current).not.toBeNull());

const triggerOpen = () => act(() => socketRef.current?.onopen?.(new Event("open")));
const triggerClose = () => act(() => socketRef.current?.close());

describe("Disconnect banner", () => {
  test("not visible while WS is open", async () => {
    // #given
    render(<App />);
    await waitForSocket();

    // #when
    await triggerOpen();

    // #then
    await waitFor(() => expect(screen.queryByTestId("disconnect-banner")).not.toBeInTheDocument());
  });

  test("appears when WS closes after being open", async () => {
    // #given
    render(<App />);
    await waitForSocket();
    await triggerOpen();
    await waitFor(() => expect(screen.queryByTestId("disconnect-banner")).not.toBeInTheDocument());

    // #when
    await triggerClose();

    // #then
    await waitFor(() => expect(screen.getByTestId("disconnect-banner")).toBeInTheDocument());
  });

  test("Reconnect button opens a new WebSocket and hides the banner once it opens", async () => {
    // #given
    render(<App />);
    await waitForSocket();
    await triggerOpen();
    await triggerClose();
    await waitFor(() => expect(screen.getByTestId("disconnect-banner")).toBeInTheDocument());
    const first = socketRef.current;

    // #when
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    // #then
    await waitFor(() => expect(socketRef.current).not.toBe(first));
    await triggerOpen();
    await waitFor(() => expect(screen.queryByTestId("disconnect-banner")).not.toBeInTheDocument());
  });
});
