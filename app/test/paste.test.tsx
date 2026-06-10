import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App";

class StubSocket {
  url: string;
  onopen: ((e: Event) => unknown) | null = null;
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  onclose: ((e: CloseEvent) => unknown) | null = null;
  onerror: ((e: Event) => unknown) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close() {}
  send() {}
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

const fetchCalls: FetchCall[] = [];

const installFetch = (handler: (call: FetchCall) => unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const call = { url: String(url), init };
      fetchCalls.push(call);
      const body = handler(call);
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }),
  );

const firePaste = (text: string) =>
  act(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text" ? text : "") } });
    window.dispatchEvent(event);
  });

beforeEach(() => {
  fetchCalls.length = 0;
  Object.defineProperty(window, "__SCRIBD_DL_BACKEND__", { value: "http://stub:0", configurable: true });
  vi.stubGlobal("WebSocket", StubSocket);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__SCRIBD_DL_BACKEND__");
});

describe("paste handler", () => {
  test("paste with a scribd URL triggers POST /enqueue and does not show the transient message", async () => {
    // #given
    installFetch((call) => {
      if (call.url.endsWith("/enqueue")) return { jobs: [{ id: "j1", url: "https://www.scribd.com/document/1/x", domain: "scribd", displayTitle: "x", status: "Queued" }] };
      if (call.url.endsWith("/folder")) return { path: "/Users/me/Downloads" };
      return { jobs: [] };
    });
    render(<App />);
    await waitFor(() => expect(fetchCalls.some((c) => c.url.endsWith("/folder"))).toBe(true));

    // #when
    firePaste("https://www.scribd.com/document/1/x");

    // #then
    await waitFor(() => expect(fetchCalls.some((c) => c.url.endsWith("/enqueue") && c.init?.method === "POST")).toBe(true));
    const enqueue = fetchCalls.find((c) => c.url.endsWith("/enqueue"));
    expect(enqueue?.init?.body).toBe(JSON.stringify({ text: "https://www.scribd.com/document/1/x" }));
    expect(screen.queryByText("No links found in clipboard")).not.toBeInTheDocument();
  });

  test("paste with non-URL text shows the transient 'No links found' message", async () => {
    // #given
    installFetch((call) => {
      if (call.url.endsWith("/enqueue")) return { jobs: [] };
      if (call.url.endsWith("/folder")) return { path: "/x" };
      return { jobs: [] };
    });
    render(<App />);
    await waitFor(() => expect(fetchCalls.some((c) => c.url.endsWith("/folder"))).toBe(true));

    // #when
    firePaste("just some words");

    // #then
    await waitFor(() => expect(screen.getByText("No links found in clipboard")).toBeInTheDocument());

    // #when — advance past the transient window
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    // #then
    expect(screen.queryByText("No links found in clipboard")).not.toBeInTheDocument();
  });

  test("paste with empty/whitespace text does not trigger /enqueue", async () => {
    // #given
    installFetch((call) => (call.url.endsWith("/folder") ? { path: "/x" } : { jobs: [] }));
    render(<App />);
    await waitFor(() => expect(fetchCalls.some((c) => c.url.endsWith("/folder"))).toBe(true));
    const beforePaste = fetchCalls.filter((c) => c.url.endsWith("/enqueue")).length;

    // #when
    firePaste("   ");

    // #then
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(fetchCalls.filter((c) => c.url.endsWith("/enqueue")).length).toBe(beforePaste);
  });
});
