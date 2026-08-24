import { Context, Effect, Layer } from "effect";
import * as scribdRegex from "../../const/ScribdRegex";

const FETCH_TIMEOUT_MS = 5000;

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
  readonly fetchOEmbedTitle: (url: string) => Effect.Effect<string, Error, never>;
}

const liveFetcher: Fetcher = {
  fetchOEmbedTitle: (url) =>
    Effect.tryPromise({
      try: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const endpoint = `https://www.scribd.com/services/oembed?url=${encodeURIComponent(url)}&format=json`;
          const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: "application/json" } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const title = ((await response.json()) as { readonly title?: unknown }).title;
          if (typeof title !== "string") throw new Error("oEmbed response has no title");
          return title;
        } finally {
          clearTimeout(timer);
        }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
};

const usableTitle = (raw: string): string | null => {
  const title = decodeEntities(raw);
  return title !== "" && title.toLowerCase() !== "client challenge" ? title : null;
};

const makeResolver = (fetcher: Fetcher): TitleResolverService => ({
  resolve: (originalUrl, id) =>
    Effect.gen(function* () {
      const rawTitle = yield* fetcher.fetchOEmbedTitle(originalUrl).pipe(Effect.catchAll(() => Effect.succeed<string | null>(null)));
      if (rawTitle) {
        const title = usableTitle(rawTitle);
        if (title) return title;
      }
      return slugFromUrl(originalUrl) ?? id;
    }),
});

export const TitleResolverLive: Layer.Layer<TitleResolver, never, never> = Layer.succeed(TitleResolver, makeResolver(liveFetcher));

export const makeTitleResolverLayer = (fetcher: Fetcher): Layer.Layer<TitleResolver, never, never> =>
  Layer.succeed(TitleResolver, makeResolver(fetcher));
