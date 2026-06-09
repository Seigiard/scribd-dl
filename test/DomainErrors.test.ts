import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { BrowserLaunchFailed, UnsupportedUrl } from "../src/errors/DomainErrors.js";

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
      const failureOpt = exit.cause;
      const failures = Array.from(
        (function* walk(c: typeof failureOpt): Generator<unknown> {
          if (c._tag === "Fail") yield (c as { error: unknown }).error;
          else if (c._tag === "Sequential" || c._tag === "Parallel") {
            yield* walk((c as { left: typeof failureOpt }).left);
            yield* walk((c as { right: typeof failureOpt }).right);
          }
        })(failureOpt),
      );
      expect(failures.length).toBeGreaterThan(0);
      const first = failures[0] as { _tag: string };
      expect(first._tag).toBe("BrowserLaunchFailed");
    }
  });
});
