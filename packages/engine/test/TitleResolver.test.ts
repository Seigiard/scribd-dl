import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { type Fetcher, TitleResolver, firstSegment, makeTitleResolverLayer, slugFromUrl } from "../src/utils/request/TitleResolver";

interface FakeFetcher {
  fetchHtml: ReturnType<typeof mock>;
  url: string | null;
}

const fakeFetcher: FakeFetcher = { fetchHtml: mock(), url: null };

const resetFetcher = () => {
  fakeFetcher.url = null;
  fakeFetcher.fetchHtml = mock((url: string) => {
    fakeFetcher.url = url;
    return Effect.succeed("");
  });
};

const fetcher: Fetcher = {
  fetchHtml: (url) => fakeFetcher.fetchHtml(url) as ReturnType<Fetcher["fetchHtml"]>,
};

const runResolve = (originalUrl: string, id: string): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* TitleResolver;
      return yield* svc.resolve(originalUrl, id);
    }).pipe(Effect.provide(makeTitleResolverLayer(fetcher))),
  );

describe("firstSegment", () => {
  test("splits on first ' | '", () => {
    expect(firstSegment("Foo | PDF | Tags")).toBe("Foo");
  });

  test("returns whole string when no ' | '", () => {
    expect(firstSegment("Just Title")).toBe("Just Title");
  });

  test("trims whitespace", () => {
    expect(firstSegment("  Foo  | Bar")).toBe("Foo");
  });

  test("null in, null out", () => {
    expect(firstSegment(null)).toBeNull();
  });

  test("empty string returns null", () => {
    expect(firstSegment("")).toBeNull();
  });
});

describe("slugFromUrl", () => {
  test("extracts and humanises slug", () => {
    expect(slugFromUrl("https://www.scribd.com/document/123/Smart-Money-Concept-Trading")).toBe("Smart Money Concept Trading");
  });

  test("decodes percent-escapes", () => {
    expect(slugFromUrl("https://www.scribd.com/document/123/Foo%20Bar")).toBe("Foo Bar");
  });

  test("returns null for embed URL (no slug)", () => {
    expect(slugFromUrl("https://www.scribd.com/embeds/123/content")).toBeNull();
  });

  test("returns null for document URL without slug", () => {
    expect(slugFromUrl("https://www.scribd.com/document/123")).toBeNull();
  });

  test("returns null for non-scribd URL", () => {
    expect(slugFromUrl("https://example.com/foo")).toBeNull();
  });
});

describe("TitleResolver.resolve", () => {
  beforeEach(() => {
    resetFetcher();
  });

  test("returns og:title first segment when present", async () => {
    // #given
    fakeFetcher.fetchHtml = mock(() =>
      Effect.succeed(
        `<html><head><meta property="og:title" content="Smart Money Concept Trading Guide | PDF | Hedge (Finance)"/></head></html>`,
      ),
    );

    // #when
    const title = await runResolve("https://www.scribd.com/document/693471767/Smart-Money-Concept-SMC-Trading", "693471767");

    // #then
    expect(title).toBe("Smart Money Concept Trading Guide");
  });

  test("falls back to <title> when og:title is missing", async () => {
    // #given
    fakeFetcher.fetchHtml = mock(() => Effect.succeed(`<html><head><title>Just A Title | Tag</title></head></html>`));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/some-slug", "42");

    // #then
    expect(title).toBe("Just A Title");
  });

  test("falls back to slug when fetch returns empty html", async () => {
    // #given
    fakeFetcher.fetchHtml = mock(() => Effect.succeed(""));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/My-Custom-Slug", "42");

    // #then
    expect(title).toBe("My Custom Slug");
  });

  test("falls back to slug when fetch fails", async () => {
    // #given
    fakeFetcher.fetchHtml = mock(() => Effect.fail(new Error("network down")));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/Fallback-Slug", "42");

    // #then
    expect(title).toBe("Fallback Slug");
  });

  test("returns id for embed URL", async () => {
    // #when
    const title = await runResolve("https://www.scribd.com/embeds/42/content", "42");

    // #then
    expect(title).toBe("42");
  });

  test("returns id for document URL without slug", async () => {
    // #when
    const title = await runResolve("https://www.scribd.com/document/42", "42");

    // #then
    expect(title).toBe("42");
  });

  test("falls back to slug when og:title and <title> both empty", async () => {
    // #given
    fakeFetcher.fetchHtml = mock(() => Effect.succeed(`<html><head><title></title></head></html>`));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/Fallback-Here", "42");

    // #then
    expect(title).toBe("Fallback Here");
  });

  test("decodes HTML entities in og:title", async () => {
    // #given
    fakeFetcher.fetchHtml = mock(() =>
      Effect.succeed(`<meta property="og:title" content="Tom &amp; Jerry&#39;s &quot;Show&quot; | PDF"/>`),
    );

    // #when
    const title = await runResolve("https://www.scribd.com/document/1/slug", "1");

    // #then
    expect(title).toBe(`Tom & Jerry's "Show"`);
  });

  test("fetches the original document URL when slug is present", async () => {
    // #given
    let fetchedUrl = "";
    fakeFetcher.fetchHtml = mock((url: string) => {
      fetchedUrl = url;
      return Effect.succeed("");
    });

    // #when
    await runResolve("https://www.scribd.com/document/42/Some-Slug", "42");

    // #then
    expect(fetchedUrl).toBe("https://www.scribd.com/document/42/Some-Slug");
  });

  test("handles og:title with attribute order reversed", async () => {
    // #given
    fakeFetcher.fetchHtml = mock(() => Effect.succeed(`<meta content="Reversed Title | suffix" property="og:title"/>`));

    // #when
    const title = await runResolve("https://www.scribd.com/document/1/slug", "1");

    // #then
    expect(title).toBe("Reversed Title");
  });
});
