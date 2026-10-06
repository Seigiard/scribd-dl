import { describe, expect, test } from "bun:test";
import {
  clearAll,
  clearFinished,
  enqueueText,
  fetchFolder,
  fetchSettings,
  fetchSnapshot,
  saveSettings,
  subscribeEvents,
} from "../src/client";
import type { JobEvent } from "../src/jobs";
import { JobEvents } from "../src/jobs";
import { Predicate } from "effect";

describe("HTTP response boundary", () => {
  test.each([
    ["snapshot", () => fetchSnapshot(baseUrl), '{"jobs":[]}', { jobs: [] }],
    ["enqueue", () => enqueueText(baseUrl, "text"), '{"jobs":[]}', { jobs: [] }],
    ["folder", () => fetchFolder(baseUrl), '{"path":"/tmp/output"}', "/tmp/output"],
    [
      "settings",
      () => fetchSettings(baseUrl),
      '{"publicKey":"pub","secretKey":"sec","valid":null}',
      { publicKey: "pub", secretKey: "sec", valid: null },
    ],
    [
      "save settings",
      () => saveSettings(baseUrl, { publicKey: "pub", secretKey: "sec" }),
      '{"valid":false}',
      { valid: false },
    ],
    ["clear all", () => clearAll(baseUrl), '{"removed":2}', 2],
    ["clear finished", () => clearFinished(baseUrl), '{"removed":2}', 4],
  ])("accepts valid %s response", async (_name, request, body, expected) => {
    // #given
    const server = Bun.serve({ port: 0, fetch: () => new Response(body) });
    baseUrl = server.url.origin;

    try {
      // #when
      const result = await request();
      // #then
      expect(result).toEqual(expected);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    ["snapshot", () => fetchSnapshot(baseUrl), '{"jobs":[{"id":"x"}]}'],
    ["enqueue", () => enqueueText(baseUrl, "text"), '{"jobs":null}'],
    ["folder", () => fetchFolder(baseUrl), '{"path":42}'],
    [
      "settings",
      () => fetchSettings(baseUrl),
      '{"publicKey":"pub","secretKey":"sec","valid":"true"}',
    ],
    [
      "save settings",
      () => saveSettings(baseUrl, { publicKey: "pub", secretKey: "sec" }),
      '{"valid":null}',
    ],
    ["clear all", () => clearAll(baseUrl), '{"removed":"2"}'],
    ["clear finished", () => clearFinished(baseUrl), "{}"],
  ])("rejects malformed %s response", async (_name, request, body) => {
    // #given
    const server = Bun.serve({ port: 0, fetch: () => new Response(body) });
    baseUrl = server.url.origin;

    try {
      // #when
      const result = request();
      // #then
      await expect(result).rejects.toBeInstanceOf(Error);
    } finally {
      server.stop(true);
    }
  });
});

let baseUrl = "";

describe("WebSocket event boundary", () => {
  test.each([
    '{"_tag":"FutureEvent","id":"x"}',
    '{"_tag":"JobStarted","id":42}',
    '{"_tag":"JobFailed","id":"x","reason":"failed"}',
    '{"_tag":"JobProgress","id":"x","done":1,"total":2,"stage":"other"}',
    '{"_tag":"JobAdded","job":{"id":"x"}}',
    '{"_tag":"SnapshotReplaced","snapshot":{"jobs":null}}',
    "null",
    "not JSON",
  ])("rejects malformed frame %s without forwarding it", async (frame) => {
    // #given
    const messages: JobEvent[] = [];
    const errors: Error[] = [];

    const server = Bun.serve({
      port: 0,
      fetch: (request, server) =>
        server.upgrade(request) ? undefined : new Response(null, { status: 400 }),
      websocket: {
        open: (socket) => {
          socket.send(frame);
          socket.send('{"_tag":"JobStarted","id":"valid"}');
        },
        message: () => {},
      },
    });

    try {
      // #when
      await new Promise<void>((resolve) => {
        const subscription = subscribeEvents(server.url.origin, {
          onMessage: (event) => {
            messages.push(event);

            if (Predicate.isTagged(event, "JobStarted") && event.id === "valid") {
              subscription.close();
              resolve();
            }
          },
          onError: (error) => {
            if (error instanceof Error) errors.push(error);
          },
        });
      });
      // #then
      expect({ messages, errors: errors.length }).toEqual({
        messages: [JobEvents.JobStarted({ id: "valid" })],
        errors: 1,
      });
    } finally {
      server.stop(true);
    }
  });
});
