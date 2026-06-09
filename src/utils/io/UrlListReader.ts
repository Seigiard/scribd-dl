import { Context, Effect, Layer } from "effect";
import { UrlListUnreadable } from "../../errors/DomainErrors";

const URL_REGEX = /(https?:\/\/\S+)/;

export interface UrlListReaderService {
  readonly read: (filePath: string) => Effect.Effect<ReadonlyArray<string>, UrlListUnreadable, never>;
}

export class UrlListReader extends Context.Tag("UrlListReader")<UrlListReader, UrlListReaderService>() {}

const read = (filePath: string): Effect.Effect<ReadonlyArray<string>, UrlListUnreadable, never> =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(filePath).text(),
      catch: (cause) => new UrlListUnreadable({ path: filePath, cause }),
    });

    const urls: string[] = [];
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      const match = URL_REGEX.exec(line);
      if (match) {
        urls.push(match[1]);
      }
    }
    return urls;
  });

export const UrlListReaderLive: Layer.Layer<UrlListReader, never, never> = Layer.succeed(UrlListReader, { read });
