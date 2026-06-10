import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TitleResolver, TitleResolverLive } from "../../src/utils/request/TitleResolver";

const REFERENCE_URL = "https://www.scribd.com/document/693471767/Smart-Money-Concept-SMC-Trading-Strategy-Full-Guide";
const REFERENCE_ID = "693471767";
const REFERENCE_TITLE = "Smart Money Concept Trading Guide";

const resolve = (url: string, id: string): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* TitleResolver;
      return yield* svc.resolve(url, id);
    }).pipe(Effect.provide(TitleResolverLive)),
  );

describe.skipIf(!process.env.RUN_SMOKE_TESTS)("smoke: TitleResolver against real Scribd", () => {
  test(
    "resolves canonical og:title from reference document",
    async () => {
      // #when
      const title = await resolve(REFERENCE_URL, REFERENCE_ID);

      // #then — exact match guards against silent layout/selector drift
      expect(title).toBe(REFERENCE_TITLE);
    },
    { timeout: 15_000 },
  );

  test(
    "resolved title is never empty, never id, never raw slug for reference document",
    async () => {
      // #when
      const title = await resolve(REFERENCE_URL, REFERENCE_ID);

      // #then — three failure modes worth distinguishing if the exact-match assertion ever breaks
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toBe(REFERENCE_ID);
      expect(title).not.toBe("Smart Money Concept SMC Trading Strategy Full Guide");
    },
    { timeout: 15_000 },
  );
});
