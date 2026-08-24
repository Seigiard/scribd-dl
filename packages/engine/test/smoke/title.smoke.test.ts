import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TitleResolver, TitleResolverLive } from "../../src/utils/request/TitleResolver";

const REFERENCE_URL = "https://www.scribd.com/document/649160495/Wrong-Slug";
const REFERENCE_ID = "649160495";
const REFERENCE_TITLE = "Cypher System Cheat Sheet";

const resolve = (url: string, id: string): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* TitleResolver;
      return yield* svc.resolve(url, id);
    }).pipe(Effect.provide(TitleResolverLive)),
  );

describe.skipIf(!process.env.RUN_SMOKE_TESTS)("smoke: TitleResolver against real Scribd", () => {
  test(
    "resolves oEmbed title when the canonical page returns a client challenge",
    async () => {
      // #when
      const title = await resolve(REFERENCE_URL, REFERENCE_ID);

      // #then — exact match guards against silent endpoint or response-shape drift;
      // the remaining assertions distinguish fallback failure modes.
      expect(title).toBe(REFERENCE_TITLE);
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toBe(REFERENCE_ID);
      expect(title).not.toBe("Client Challenge");
      expect(title).not.toBe("Wrong Slug");
    },
    { timeout: 15_000 },
  );
});
