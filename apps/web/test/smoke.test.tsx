import { render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  Object.defineProperty(window, "__SCRIBD_DL_BACKEND__", { value: "http://stub:0", configurable: true });
  vi.stubGlobal("WebSocket", StubSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ jobs: [], path: "/Users/me/Downloads" }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__SCRIBD_DL_BACKEND__");
});

describe("App smoke", () => {
  test("renders Header, empty Queue, and StatusBar hint", async () => {
    // #when
    render(<App />);

    // #then
    expect(screen.getByText("Download folder")).toBeInTheDocument();
    expect(screen.getByText("Change folder")).toBeInTheDocument();
    expect(screen.getByText(/Press ⌘V to add links/)).toBeInTheDocument();
    expect(screen.queryByTestId("queue")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("folder-path")).toHaveTextContent("/Users/me/Downloads"));
  });
});
