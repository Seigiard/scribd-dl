import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { Text } from "ink";
import React from "react";
import { JobEvents as events, type EngineSnapshot, type JobEvent } from "@scribd-dl/shared";
import type { ServerWebSocket } from "bun";
import { useEngineState } from "../src/hooks/useEngineState";

let BASE = "";

const waitFor = async (description: string, ready: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2000;

  while (!ready()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
};

let activeUi: ReturnType<typeof render> | null = null;

const mount = (element: React.ReactElement): ReturnType<typeof render> => {
  const ui = render(element);
  activeUi = ui;

  return ui;
};

const waitForConnection = (): Promise<void> =>
  waitFor("WS connection and initial HTTP snapshot", () => socket !== null && snapshotCalls === 1);

let socket: ServerWebSocket<void> | null = null;

let socketPath: string | null = null;

let closeCalls = 0;

let snapshots: EngineSnapshot[] = [];

let snapshotCalls = 0;

const installFetchStub = (...frames: EngineSnapshot[]): void => {
  snapshots = [...frames];
  snapshotCalls = 0;
};

const server = Bun.serve<void>({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request, server) {
    const { pathname } = new URL(request.url);

    if (pathname === "/events") {
      socketPath = pathname;

      if (server.upgrade(request, { data: undefined })) return;

      return new Response("WebSocket upgrade required", { status: 426 });
    }

    if (pathname === "/settings") {
      return Response.json({ publicKey: "", secretKey: "", valid: null });
    }

    const next = snapshots.shift() ?? { jobs: [] };
    snapshotCalls += 1;

    return Response.json(next);
  },
  websocket: {
    open(ws) {
      socket = ws;
    },
    message() {},
    close() {
      closeCalls += 1;
      socket = null;
    },
  },
});

BASE = server.url.origin;

const sendEvent = (event: JobEvent): void => {
  if (!socket) throw new Error("Hook did not connect to the event server");
  socket.send(JSON.stringify(event));
};

beforeEach(() => {
  socket = null;
  socketPath = null;
  closeCalls = 0;
});

afterEach(async () => {
  activeUi?.unmount();
  activeUi = null;
  socket?.close();
  await waitFor("server observing WS close", () => socket === null);
});

afterAll(() => server.stop(true));

const Probe = ({ baseUrl }: { baseUrl: string }) => {
  const { snapshot, folder } = useEngineState(baseUrl, "/initial");

  return React.createElement(Text, null, `count=${snapshot.jobs.length} folder=${folder ?? "null"}`);
};

describe("useEngineState (HTTP/WS client)", () => {
  test("initial mount fetches snapshot and renders zero jobs", async () => {
    // #given
    installFetchStub({ jobs: [] });

    // #when
    const ui = mount(React.createElement(Probe, { baseUrl: BASE }));
    await waitForConnection();
    await waitFor("initial queue frame", () => ui.lastFrame() === "count=0 folder=/initial");

    // #then
    expect(ui.lastFrame()).toContain("count=0");
    expect(ui.lastFrame()).toContain("folder=/initial");
    expect(ui.lastFrame()).toBe("count=0 folder=/initial");
    expect(snapshotCalls).toBe(1);
    ui.unmount();
  });

  test("WS subscription targets ws://.../events", async () => {
    // #given
    installFetchStub({ jobs: [] });

    // #when
    const ui = mount(React.createElement(Probe, { baseUrl: BASE }));
    await waitForConnection();

    // #then
    expect(socketPath).toBe("/events");
    ui.unmount();
  });

  test("each WS message triggers a snapshot refetch", async () => {
    // #given
    installFetchStub({ jobs: [] }, { jobs: [{ id: "a", url: "u", domain: "scribd", displayTitle: "t", status: "Queued" }] });
    const ui = mount(React.createElement(Probe, { baseUrl: BASE }));
    await waitForConnection();
    const callsBefore = snapshotCalls;

    // #when
    const event = events.JobAdded({
      job: { id: "a", url: "u", domain: "scribd", displayTitle: "t", status: "Queued" },
    });

    sendEvent(event);
    await waitFor("refetched queue frame", () => snapshotCalls === callsBefore + 1 && ui.lastFrame() === "count=1 folder=/initial");

    // #then
    expect(snapshotCalls).toBe(callsBefore + 1);
    expect(ui.lastFrame()).toBe("count=1 folder=/initial");
    ui.unmount();
  });

  test("OutputFolderChanged event updates folder without refetching snapshot", async () => {
    // #given
    installFetchStub({ jobs: [] });
    const ui = mount(React.createElement(Probe, { baseUrl: BASE }));
    await waitForConnection();
    const callsBefore = snapshotCalls;

    // #when
    const event = events.OutputFolderChanged({ path: "/new/path" });
    sendEvent(event);
    await waitFor("updated folder frame", () => ui.lastFrame() === "count=0 folder=/new/path");

    // #then
    expect(ui.lastFrame()).toBe("count=0 folder=/new/path");
    expect(snapshotCalls).toBe(callsBefore);
    ui.unmount();
  });

  test("SnapshotReplaced event applies snapshot inline without HTTP refetch", async () => {
    // #given
    installFetchStub({ jobs: [] });
    const ui = mount(React.createElement(Probe, { baseUrl: BASE }));
    await waitForConnection();
    const callsBefore = snapshotCalls;

    // #when
    const next: EngineSnapshot = {
      jobs: [
        { id: "x", url: "u", domain: "scribd", displayTitle: "t", status: "Queued" },
        { id: "y", url: "u2", domain: "scribd", displayTitle: "t2", status: "Downloaded" },
      ],
    };

    const event = events.SnapshotReplaced({ snapshot: next });
    sendEvent(event);
    await waitFor("replacement snapshot frame", () => ui.lastFrame() === "count=2 folder=/initial");

    // #then
    expect(snapshotCalls).toBe(callsBefore);
    expect(ui.lastFrame()).toBe("count=2 folder=/initial");
    ui.unmount();
  });

  test("WS open and close trigger optional callbacks", async () => {
    // #given
    installFetchStub({ jobs: [] });
    const events: string[] = [];

    const callbacks = {
      onWsOpen: () => events.push("open"),
      onWsClose: () => events.push("close"),
    };

    const Host = () => {
      useEngineState(BASE, "/initial", callbacks);

      return React.createElement(Text, null, "host");
    };

    // #when
    const ui = mount(React.createElement(Host));
    await waitForConnection();
    await waitFor("client open callback", () => events.join(",") === "open");

    if (!socket) throw new Error("Hook did not connect to the event server");
    socket.close();
    await waitFor("client close callback", () => events.join(",") === "open,close");

    // #then
    expect(events).toEqual(["open", "close"]);
    ui.unmount();
  });

  test("unmount closes the WS subscription", async () => {
    // #given
    installFetchStub({ jobs: [] });
    const ui = mount(React.createElement(Probe, { baseUrl: BASE }));
    await waitForConnection();

    // #when
    ui.unmount();
    await waitFor("unmount closing WS subscription", () => closeCalls === 1);

    // #then
    expect(closeCalls).toBe(1);
  });
});
