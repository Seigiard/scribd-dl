import { describe, expect, test } from "bun:test";
import { Cause, Chunk, Effect, Exit } from "effect";
import { BrowserLaunchFailed, UnsupportedUrl } from "../src/errors/DomainErrors";

describe("DomainErrors", () => {
  test("BrowserLaunchFailed carries _tag and cause payload", () => {
    const cause = new Error("launch boom");
    const err = new BrowserLaunchFailed({ cause });
    expect(err._tag).toBe("BrowserLaunchFailed");
    expect(err.cause).toBe(cause);
  });

  test("UnsupportedUrl carries _tag and url payload", () => {
    const err = new UnsupportedUrl({ url: "https://example.com/x" });
    expect(err._tag).toBe("UnsupportedUrl");
    expect(err.url).toBe("https://example.com/x");
  });

  test("Effect.fail propagates tagged error through Exit", async () => {
    const cause = new Error("x");
    const exit = await Effect.runPromiseExit(Effect.fail(new BrowserLaunchFailed({ cause })));
    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      const failures = Chunk.toReadonlyArray(Cause.failures(exit.cause));

      expect(failures.length).toBeGreaterThan(0);
      const first = failures[0]!;
      expect(first._tag).toBe("BrowserLaunchFailed");
    }
  });
});
