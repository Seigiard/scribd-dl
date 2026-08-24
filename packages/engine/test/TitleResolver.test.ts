import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { type Fetcher, TitleResolver, makeTitleResolverLayer, slugFromUrl } from "../src/utils/request/TitleResolver";

interface FakeFetcher {
  fetchPageTitle: ReturnType<typeof mock>;
  fetchOEmbedTitle: ReturnType<typeof mock>;
  url: string | null;
}

const fakeFetcher: FakeFetcher = { fetchPageTitle: mock(), fetchOEmbedTitle: mock(), url: null };

const resetFetcher = () => {
  fakeFetcher.url = null;
  fakeFetcher.fetchPageTitle = mock(() => Effect.fail(new Error("page unavailable")));
  fakeFetcher.fetchOEmbedTitle = mock((url: string) => {
    fakeFetcher.url = url;
    return Effect.fail(new Error("oEmbed unavailable"));
  });
};

const fetcher: Fetcher = {
  fetchPageTitle: (url) => fakeFetcher.fetchPageTitle(url) as ReturnType<Fetcher["fetchPageTitle"]>,
  fetchOEmbedTitle: (url) => fakeFetcher.fetchOEmbedTitle(url) as ReturnType<Fetcher["fetchOEmbedTitle"]>,
};

const runResolve = (originalUrl: string, id: string): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* TitleResolver;
      return yield* svc.resolve(originalUrl, id);
    }).pipe(Effect.provide(makeTitleResolverLayer(fetcher))),
  );

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

  test("returns the oEmbed title", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("Canonical Document Title"));

    // #when
    const title = await runResolve("https://www.scribd.com/document/649160495/Different-Url-Slug", "649160495");

    // #then
    expect(title).toBe("Canonical Document Title");
  });

  test("prefers the displayed page title over the original oEmbed title", async () => {
    // #given
    fakeFetcher.fetchPageTitle = mock(() => Effect.succeed("Cypher System Task Difficulty Guide | PDF | Attention | Nature"));
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("Cypher system custom GM screen"));

    // #when
    const title = await runResolve("https://www.scribd.com/document/422706811/Cypher-system-custom-GM-screen", "422706811");

    // #then
    expect(title).toBe("Cypher System Task Difficulty Guide");
  });

  test("falls back to oEmbed when the page returns a client challenge", async () => {
    // #given
    fakeFetcher.fetchPageTitle = mock(() => Effect.succeed("Client Challenge"));
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("Original Document Title"));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/Original-Document-Title", "42");

    // #then
    expect(title).toBe("Original Document Title");
  });

  test("preserves pipe characters in an oEmbed title", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("Research | Development Plan"));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/Fallback-Slug", "42");

    // #then
    expect(title).toBe("Research | Development Plan");
  });

  test("decodes HTML entities in the oEmbed title", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed(`Tom &amp; Jerry&#39;s &quot;Show&quot;`));

    // #when
    const title = await runResolve("https://www.scribd.com/document/1/slug", "1");

    // #then
    expect(title).toBe(`Tom & Jerry's "Show"`);
  });

  test("falls back to slug when oEmbed fails", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.fail(new Error("network down")));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/Fallback-Slug", "42");

    // #then
    expect(title).toBe("Fallback Slug");
  });

  test("falls back to slug when oEmbed returns an empty title", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("  "));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42/Empty-Title", "42");

    // #then
    expect(title).toBe("Empty Title");
  });

  test("falls back to slug when oEmbed returns a client challenge", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("Client Challenge"));

    // #when
    const title = await runResolve("https://www.scribd.com/document/649160495/Cypher-System-Cheat-Sheet", "649160495");

    // #then
    expect(title).toBe("Cypher System Cheat Sheet");
  });

  test("uses oEmbed for an embed URL", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("Embed Document Title"));

    // #when
    const title = await runResolve("https://www.scribd.com/embeds/42/content", "42");

    // #then
    expect(title).toBe("Embed Document Title");
    expect(fakeFetcher.fetchPageTitle).toHaveBeenCalledWith("https://www.scribd.com/document/42");
    expect(fakeFetcher.fetchOEmbedTitle).toHaveBeenCalledWith("https://www.scribd.com/document/42");
  });

  test("uses oEmbed for a document URL without a slug", async () => {
    // #given
    fakeFetcher.fetchOEmbedTitle = mock(() => Effect.succeed("Bare Document Title"));

    // #when
    const title = await runResolve("https://www.scribd.com/document/42", "42");

    // #then
    expect(title).toBe("Bare Document Title");
  });

  test("falls back to id when oEmbed fails and the URL has no slug", async () => {
    // #when
    const title = await runResolve("https://www.scribd.com/document/42", "42");

    // #then
    expect(title).toBe("42");
  });

  test("passes the original URL to oEmbed", async () => {
    // #when
    await runResolve("https://www.scribd.com/document/42/Some-Slug", "42");

    // #then
    expect(fakeFetcher.url).toBe("https://www.scribd.com/document/42/Some-Slug");
  });
});
