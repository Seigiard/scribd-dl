import { Context, Effect, Either, Layer } from "effect";
import { ConfigLoader } from "./utils/io/ConfigLoader.ts";
import { DirectoryIo } from "./utils/io/DirectoryIo.ts";
import { ScribdDownloader, type ScribdError } from "./service/ScribdDownloader.ts";
import { LegacyDownloaderFailed, UnsupportedUrl } from "./errors/DomainErrors.js";
import * as scribdRegex from "./const/ScribdRegex.js";
import * as slideshareRegex from "./const/SlideshareRegex.js";
import * as everandRegex from "./const/EverandRegex.js";

export type AppError = ScribdError | LegacyDownloaderFailed | UnsupportedUrl;

export interface BatchResult {
  readonly url: string;
  readonly status: "ok" | "fail";
  readonly error?: string;
}

export interface BatchReport {
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  readonly results: ReadonlyArray<BatchResult>;
}

export interface AppService {
  readonly execute: (url: string) => Effect.Effect<void, AppError, never>;
  readonly executeBatch: (urls: ReadonlyArray<string>) => Effect.Effect<BatchReport, never, never>;
}

export class App extends Context.Tag("App")<App, AppService>() {}

type LegacyDomain = "slideshare" | "everand";

interface LegacySingleton {
  readonly execute: (url: string) => Promise<void>;
}

const loadLegacySingleton = async (domain: LegacyDomain): Promise<LegacySingleton> => {
  if (domain === "slideshare") {
    const mod = (await import("./service/SlideshareDownloader.js")) as {
      slideshareDownloader: LegacySingleton;
    };
    return mod.slideshareDownloader;
  }
  const mod = (await import("./service/EverandDownloader.js")) as {
    everandDownloader: LegacySingleton;
  };
  return mod.everandDownloader;
};

const legacyInvoke = (domain: LegacyDomain, url: string): Effect.Effect<void, LegacyDownloaderFailed, never> =>
  Effect.tryPromise({
    try: async () => {
      const singleton = await loadLegacySingleton(domain);
      await singleton.execute(url);
    },
    catch: (cause) => new LegacyDownloaderFailed({ domain, url, cause }),
  });

const errorMessage = (err: AppError): string => {
  const anyErr = err as unknown as { message?: unknown; url?: unknown; path?: unknown; domain?: unknown };
  if (typeof anyErr.message === "string" && anyErr.message.length > 0) {
    return `${err._tag}: ${anyErr.message}`;
  }
  const parts: string[] = [err._tag];
  if (typeof anyErr.domain === "string") parts.push(`domain=${anyErr.domain}`);
  if (typeof anyErr.url === "string") parts.push(`url=${anyErr.url}`);
  if (typeof anyErr.path === "string") parts.push(`path=${anyErr.path}`);
  if (parts.length > 1) return parts.join(" ");
  try {
    return JSON.stringify(err);
  } catch {
    return err._tag;
  }
};

export const AppLive: Layer.Layer<App, never, ScribdDownloader | DirectoryIo | ConfigLoader> = Layer.effect(
  App,
  Effect.gen(function* () {
    const scribd = yield* ScribdDownloader;
    const directoryIo = yield* DirectoryIo;
    const config = yield* ConfigLoader;

    const execute = (url: string): Effect.Effect<void, AppError, never> =>
      Effect.gen(function* () {
        yield* directoryIo.create(config.directory.output);
        if (scribdRegex.DOMAIN.test(url)) {
          yield* scribd.execute(url);
          return;
        }
        if (slideshareRegex.DOMAIN.test(url)) {
          yield* legacyInvoke("slideshare", url);
          return;
        }
        if (everandRegex.DOMAIN.test(url)) {
          yield* legacyInvoke("everand", url);
          return;
        }
        yield* Effect.fail(new UnsupportedUrl({ url }));
      });

    const executeBatch = (urls: ReadonlyArray<string>): Effect.Effect<BatchReport, never, never> =>
      Effect.gen(function* () {
        const results: BatchResult[] = [];
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i]!;
          yield* Effect.sync(() => console.log(`\n[${i + 1}/${urls.length}] ${url}`));
          const exit = yield* Effect.either(execute(url));
          if (Either.isRight(exit)) {
            results.push({ url, status: "ok" });
          } else {
            const message = errorMessage(exit.left);
            yield* Effect.sync(() => console.error(`[FAIL] ${url}: ${message}`));
            results.push({ url, status: "fail", error: message });
          }
        }
        const ok = results.filter((r) => r.status === "ok").length;
        return { total: results.length, ok, failed: results.length - ok, results };
      });

    return App.of({ execute, executeBatch });
  }),
);
