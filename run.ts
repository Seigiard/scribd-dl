import { existsSync } from "node:fs";
import { Args, Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { DownloadEngine, DownloadEngineLive } from "./src/service/DownloadEngine";
import { ScribdDownloaderLive } from "./src/service/ScribdDownloader";
import { ConfigLoader, type ConfigData, DEFAULT_CONFIG, makeConfigLoader } from "./src/utils/io/ConfigLoader";
import { DirectoryIo, DirectoryIoLive } from "./src/utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { UrlListUnreadable } from "./src/errors/DomainErrors";

const urlOrFileArg = Args.text({ name: "url-or-file" }).pipe(
  Args.withDescription("Scribd document URL, or path to a file with URLs (one per line, # for comments)."),
);

const outputOpt = Options.text("output").pipe(
  Options.withAlias("o"),
  Options.withDescription(`Output directory (default: "${DEFAULT_CONFIG.directory.output}").`),
  Options.withDefault(DEFAULT_CONFIG.directory.output),
);

const filenameOpt = Options.text("filename").pipe(
  Options.withDescription(
    `Filename mode: "title" (use document title) or any other value to fall back to document id (default: "${DEFAULT_CONFIG.directory.filename}").`,
  ),
  Options.withDefault(DEFAULT_CONFIG.directory.filename),
);

const rendertimeOpt = Options.integer("rendertime").pipe(
  Options.withDescription(`Scribd lazy-load render time in ms before extracting pages (default: ${DEFAULT_CONFIG.scribd.rendertime}).`),
  Options.withDefault(DEFAULT_CONFIG.scribd.rendertime),
);

const isTerminal = (status: string): boolean => status === "Downloaded" || status === "Failed";

export const runCli = (arg: string): Effect.Effect<void, UrlListUnreadable, DownloadEngine | DirectoryIo | ConfigLoader> =>
  Effect.scoped(
    Effect.gen(function* () {
      const engine = yield* DownloadEngine;
      const dir = yield* DirectoryIo;
      const config = yield* ConfigLoader;
      yield* dir.create(config.directory.output);

      const isFile = yield* Effect.sync(() => existsSync(arg));
      const text = isFile
        ? yield* Effect.tryPromise({
            try: () => Bun.file(arg).text(),
            catch: (cause) => new UrlListUnreadable({ path: arg, cause }),
          })
        : arg;

      const created = yield* engine.enqueue(text);
      if (created.length === 0) {
        yield* Effect.sync(() => console.error(`No URLs found in ${arg}`));
        yield* Effect.sync(() => process.exit(1));
        return;
      }

      if (isFile && created.length > 1) {
        yield* Effect.sync(() => console.log(`\nQueued ${created.length} URLs`));
      }

      while (true) {
        const snap = yield* engine.snapshot;
        if (snap.jobs.every((j) => isTerminal(j.status))) {
          break;
        }
        yield* Effect.sleep("50 millis");
      }

      const final = yield* engine.snapshot;
      const failed = final.jobs.filter((j) => j.status === "Failed");

      if (isFile && created.length > 1) {
        yield* Effect.sync(() => {
          console.log(`\n=== Batch summary ===`);
          console.log(`Total: ${final.jobs.length}, OK: ${final.jobs.length - failed.length}, Failed: ${failed.length}`);
          if (failed.length > 0) {
            console.log(`Failed URLs:`);
            for (const j of failed) {
              console.log(`  - ${j.url}: ${j.failure?.reason ?? "unknown"}`);
            }
          }
        });
      } else if (failed.length > 0) {
        yield* Effect.sync(() => {
          for (const j of failed) {
            console.error(`[FAIL] ${j.url}: ${j.failure?.reason ?? "unknown"}`);
          }
        });
      }

      if (failed.length > 0) {
        yield* Effect.sync(() => process.exit(1));
      }
    }),
  );

const buildLayer = (config: ConfigData) => {
  const ConfigLayer = makeConfigLoader(config);
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerSgLive);
  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);
  const EngineLayer = Layer.provide(DownloadEngineLive, ScribdLayer);
  return Layer.mergeAll(EngineLayer, ConfigLayer, DirectoryIoLive);
};

const command = Command.make(
  "scribd-dl",
  { arg: urlOrFileArg, output: outputOpt, filename: filenameOpt, rendertime: rendertimeOpt },
  ({ arg, output, filename, rendertime }) => {
    const config: ConfigData = { scribd: { rendertime }, directory: { output, filename } };
    return runCli(arg).pipe(Effect.provide(buildLayer(config)));
  },
).pipe(Command.withDescription("Download documents from Scribd. Pass a single URL, or a file path for batch mode."));

const cli = Command.run(command, {
  name: "Scribd Downloader",
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
}
