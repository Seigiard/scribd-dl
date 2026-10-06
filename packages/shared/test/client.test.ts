import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { clearAll, clearFinished } from "../src/client";

interface FetchCall {
  readonly url: string;
  readonly init?: RequestInit;
}

let fetchMock = spyOn(globalThis, "fetch");

let calls: FetchCall[] = [];

const installFetch = (responder: (url: string) => { status: number; body: unknown }): void => {
  calls = [];
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (init) calls.push({ url, init });
    else calls.push({ url });
    const { status, body } = responder(url);

    return new Response(JSON.stringify(body), { status });
  });
};

beforeEach(() => {
  fetchMock = spyOn(globalThis, "fetch");
  calls = [];
});

afterEach(() => {
  fetchMock.mockRestore();
});

const BASE = "http://engine.test";

describe("clearFinished", () => {
  test("issues DELETE to /jobs/completed and /jobs/failed, sums removed counts", async () => {
    // #given
    installFetch((url) => {
      if (url.endsWith("/jobs/completed")) return { status: 200, body: { removed: 2 } };

      if (url.endsWith("/jobs/failed")) return { status: 200, body: { removed: 3 } };

      return { status: 500, body: {} };
    });

    // #when
    const total = await clearFinished(BASE);

    // #then
    expect(total).toBe(5);
    expect(calls.map((c) => c.url).sort()).toEqual([
      `${BASE}/jobs/completed`,
      `${BASE}/jobs/failed`,
    ]);
    expect(calls.every((c) => c.init?.method === "DELETE")).toBe(true);
  });

  test("throws when one of the DELETE calls fails", async () => {
    // #given
    installFetch((url) => {
      if (url.endsWith("/jobs/completed")) return { status: 200, body: { removed: 1 } };

      return { status: 500, body: {} };
    });

    // #expect
    await expect(clearFinished(BASE)).rejects.toThrow(/jobs\/failed/);
  });
});

describe("clearAll", () => {
  test("issues a single DELETE /jobs and returns removed", async () => {
    // #given
    installFetch(() => ({ status: 200, body: { removed: 7 } }));

    // #when
    const total = await clearAll(BASE);

    // #then
    expect(total).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/jobs`);
    expect(calls[0]!.init?.method).toBe("DELETE");
  });

  test("throws on non-2xx response", async () => {
    // #given
    installFetch(() => ({ status: 500, body: {} }));

    // #expect
    await expect(clearAll(BASE)).rejects.toThrow(/jobs/);
  });
});
