import { existsSync } from "node:fs";
import { Args, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { App, AppLive } from "./src/App.ts";
import { ConfigLoaderLive } from "./src/utils/io/ConfigLoader.ts";
import { DirectoryIoLive } from "./src/utils/io/DirectoryIo.ts";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator.ts";
import { UrlListReader, UrlListReaderLive } from "./src/utils/io/UrlListReader.ts";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg.ts";
import { ScribdDownloaderLive } from "./src/service/ScribdDownloader.ts";

const urlOrFileArg = Args.text({ name: "url-or-file" }).pipe(
  Args.withDescription("Scribd document URL, or path to a file with URLs (one per line, # for comments)."),
);

const mainEffect = (arg: string) =>
  Effect.gen(function* () {
    const isFile = yield* Effect.sync(() => existsSync(arg));

    if (isFile) {
      const reader = yield* UrlListReader;
      const urls = yield* reader.read(arg);
      if (urls.length === 0) {
        yield* Effect.sync(() => console.error(`No URLs found in ${arg}`));
        yield* Effect.sync(() => process.exit(1));
        return;
      }
      const app = yield* App;
      const report = yield* app.executeBatch(urls);
      yield* Effect.sync(() => {
        console.log(`\n=== Batch summary ===`);
        console.log(`Total: ${report.total}, OK: ${report.ok}, Failed: ${report.failed}`);
        if (report.failed > 0) {
          console.log(`Failed URLs:`);
          for (const r of report.results) {
            if (r.status === "fail") {
              console.log(`  - ${r.url}: ${r.error}`);
            }
          }
          process.exit(1);
        }
      });
      return;
    }

    const app = yield* App;
    yield* app.execute(arg);
  });

const ServicesLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLoaderLive, DirectoryIoLive, UrlListReaderLive, PuppeteerSgLive);

const ScribdLayer = Layer.provide(ScribdDownloaderLive, ServicesLayer);

const AppLayer = Layer.provide(AppLive, Layer.mergeAll(ScribdLayer, ConfigLoaderLive, DirectoryIoLive));

const HandlerLayer = Layer.mergeAll(AppLayer, UrlListReaderLive);

const command = Command.make("scribd-dl", { arg: urlOrFileArg }, ({ arg }) => mainEffect(arg).pipe(Effect.provide(HandlerLayer))).pipe(
  Command.withDescription("Download documents from Scribd. Pass a single URL, or a file path for batch mode."),
);

const cli = Command.run(command, {
  name: "Scribd Downloader",
  version: "1.0.0",
});

BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
