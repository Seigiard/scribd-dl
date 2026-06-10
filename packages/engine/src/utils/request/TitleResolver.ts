import { Context, Effect, Layer } from "effect";
import * as scribdRegex from "../../const/ScribdRegex";

const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface TitleResolverService {
  readonly resolve: (originalUrl: string, id: string) => Effect.Effect<string, never, never>;
}

export class TitleResolver extends Context.Tag("TitleResolver")<TitleResolver, TitleResolverService>() {}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();

const extractOgTitle = (html: string): string | null => {
  const re1 = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i;
  const re2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i;
  const m = re1.exec(html) ?? re2.exec(html);
  return m ? decodeEntities(m[1]!) : null;
};

const extractTitleTag = (html: string): string | null => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]!) : null;
};

export const firstSegment = (raw: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const idx = trimmed.indexOf(" | ");
  const head = idx === -1 ? trimmed : trimmed.slice(0, idx).trim();
  return head === "" ? null : head;
};

export const slugFromUrl = (url: string): string | null => {
  const m = scribdRegex.DOCUMENT.exec(url);
  if (!m) return null;
  const rest = url.slice(m[0].length);
  const slugMatch = /^\/([^/?#]+)/.exec(rest);
  if (!slugMatch) return null;
  const decoded = decodeURIComponent(slugMatch[1]!).replace(/-/g, " ").trim();
  return decoded === "" ? null : decoded;
};

export interface Fetcher {
  readonly fetchHtml: (url: string) => Effect.Effect<string, Error, never>;
}

const liveFetcher: Fetcher = {
  fetchHtml: (url) =>
    Effect.tryPromise({
      try: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const resp = await fetch(url, {
            redirect: "follow",
            signal: controller.signal,
            headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
          });
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
          return await resp.text();
        } finally {
          clearTimeout(timer);
        }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
};

const makeResolver = (fetcher: Fetcher): TitleResolverService => ({
  resolve: (originalUrl, id) =>
    Effect.gen(function* () {
      const slug = slugFromUrl(originalUrl);
      if (!slug) return id;
      const html = yield* fetcher.fetchHtml(originalUrl).pipe(Effect.catchAll(() => Effect.succeed<string | null>(null)));
      if (html) {
        const fromOg = firstSegment(extractOgTitle(html));
        if (fromOg) return fromOg;
        const fromTitle = firstSegment(extractTitleTag(html));
        if (fromTitle) return fromTitle;
      }
      return slug;
    }),
});

export const TitleResolverLive: Layer.Layer<TitleResolver, never, never> = Layer.succeed(TitleResolver, makeResolver(liveFetcher));

export const makeTitleResolverLayer = (fetcher: Fetcher): Layer.Layer<TitleResolver, never, never> =>
  Layer.succeed(TitleResolver, makeResolver(fetcher));
