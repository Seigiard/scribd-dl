import { Context, Effect, Fiber, Layer } from "effect";
import * as scribdRegex from "../../const/ScribdRegex";

const FETCH_TIMEOUT_MS = 5000;
const MAX_TITLE_BYTES = 128 * 1024;

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
  readonly fetchPageTitle: (url: string) => Effect.Effect<string, Error, never>;
  readonly fetchOEmbedTitle: (url: string) => Effect.Effect<string, Error, never>;
}

const liveFetcher: Fetcher = {
  fetchPageTitle: (url) =>
    Effect.tryPromise({
      try: async (signal) => {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
        const response = await fetch(url, { signal: requestSignal, headers: { accept: "text/html" } });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`HTTP ${response.status}`);
        }
        if (!response.body) throw new Error("Document page has no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let html = "";
        let bytesRead = 0;
        try {
          while (bytesRead < MAX_TITLE_BYTES) {
            const { value, done } = await reader.read();
            if (done) break;
            const remaining = MAX_TITLE_BYTES - bytesRead;
            const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
            bytesRead += chunk.byteLength;
            html += decoder.decode(chunk, { stream: true });
            const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
            if (title) return title;
            if (/<\/head>/i.test(html) || value.byteLength >= remaining) break;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        throw new Error("Document page has no title");
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  fetchOEmbedTitle: (url) =>
    Effect.tryPromise({
      try: async (signal) => {
        const endpoint = `https://www.scribd.com/services/oembed?url=${encodeURIComponent(url)}&format=json`;
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
        const response = await fetch(endpoint, { signal: requestSignal, headers: { accept: "application/json" } });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`HTTP ${response.status}`);
        }
        const title = ((await response.json()) as { readonly title?: unknown }).title;
        if (typeof title !== "string") throw new Error("oEmbed response has no title");
        return title;
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
};

const usableTitle = (raw: string, stripSuffix: boolean): string | null => {
  const decoded = decodeEntities(raw);
  const separator = stripSuffix ? decoded.indexOf(" | ") : -1;
  const title = separator === -1 ? decoded : decoded.slice(0, separator).trim();
  return title !== "" && title.toLowerCase() !== "client challenge" && title.toLowerCase() !== "scribd" ? title : null;
};

const makeResolver = (fetcher: Fetcher): TitleResolverService => ({
  resolve: (originalUrl, id) =>
    Effect.gen(function* () {
      const fallback = <A>(effect: Effect.Effect<A, Error, never>) => effect.pipe(Effect.catchAll(() => Effect.succeed<A | null>(null)));
      const metadataUrl = scribdRegex.EMBED.test(originalUrl) ? `https://www.scribd.com/document/${id}` : originalUrl;
      const oEmbedFiber = yield* Effect.fork(fallback(fetcher.fetchOEmbedTitle(metadataUrl)));
      const pageTitle = yield* fallback(fetcher.fetchPageTitle(metadataUrl));
      if (pageTitle) {
        const usable = usableTitle(pageTitle, true);
        if (usable) {
          yield* Fiber.interrupt(oEmbedFiber);
          return usable;
        }
      }
      const oEmbedTitle = yield* Fiber.join(oEmbedFiber);
      if (oEmbedTitle) {
        const usable = usableTitle(oEmbedTitle, false);
        if (usable) return usable;
      }
      return slugFromUrl(originalUrl) ?? id;
    }),
});

export const TitleResolverLive: Layer.Layer<TitleResolver, never, never> = Layer.succeed(TitleResolver, makeResolver(liveFetcher));

export const makeTitleResolverLayer = (fetcher: Fetcher): Layer.Layer<TitleResolver, never, never> =>
  Layer.succeed(TitleResolver, makeResolver(fetcher));
