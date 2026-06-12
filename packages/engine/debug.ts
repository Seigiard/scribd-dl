import { Args, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { ScribdDownloader, ScribdDownloaderLive } from "./src/service/ScribdDownloader";
import { Scrapers, type OnEvent } from "./src/service/Scraper";
import { DEFAULT_CONFIG, makeConfigLoader } from "./src/utils/io/ConfigLoader";
import { DirectoryIoLive } from "./src/utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator";
import { makePuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { TitleResolverLive } from "./src/utils/request/TitleResolver";

const DEBUG_RENDERTIME_MS = 500;
const DEBUG_OUTPUT_FOLDER = "./output";

const urlArg = Args.text({ name: "url" }).pipe(Args.withDescription("Scraper URL to debug (e.g. Scribd document URL)."));

const logEvent: OnEvent = (event) =>
  Effect.sync(() => {
    if (event._tag === "TitleResolved") {
      console.log(`[TitleResolved] ${event.title}`);
    } else if (event._tag === "ScrapeProgress") {
      console.log(`[ScrapeProgress] ${event.done}/${event.total}`);
    } else {
      console.log(`[RenderProgress] ${event.done}/${event.total}`);
    }
  });

const buildDebugLayer = () => {
  const ConfigLayer = makeConfigLoader({
    ...DEFAULT_CONFIG,
    scribd: { rendertime: DEBUG_RENDERTIME_MS },
  });
  const PuppeteerLayer = makePuppeteerSgLive({ headful: true });
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerLayer, TitleResolverLive);
  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);
  return Layer.provide(
    Layer.effect(
      Scrapers,
      Effect.gen(function* () {
        const scribd = yield* ScribdDownloader;
        return [scribd];
      }),
    ),
    ScribdLayer,
  );
};

const program = (url: string) =>
  Effect.gen(function* () {
    const scrapers = yield* Scrapers;
    const scraper = scrapers.find((s) => s.canHandle(url));
    if (!scraper) {
      console.error(`No scraper registered for URL: ${url}`);
      yield* Effect.sync(() => process.exit(1));
      return;
    }
    console.log(`[debug] scraper=${scraper.id} url=${url} folder=${DEBUG_OUTPUT_FOLDER} rendertime=${DEBUG_RENDERTIME_MS}ms`);
    yield* scraper.execute(url, DEBUG_OUTPUT_FOLDER, logEvent, true).pipe(
      Effect.tapError((error) => Effect.sync(() => console.error("[debug] failed:", error))),
      Effect.catchAll(() => Effect.sync(() => process.exit(1))),
    );
    console.log(`[debug] done. Artifacts in ${DEBUG_OUTPUT_FOLDER}/`);
  });

const command = Command.make("scribd-dl-debug", { url: urlArg }, ({ url }) =>
  program(url).pipe(Effect.provide(buildDebugLayer()), Effect.scoped),
).pipe(Command.withDescription("Run a scraper in debug mode (headful browser, bumped rendertime, keep artifacts)."));

const cli = Command.run(command, {
  name: "Scribd Downloader Debug Runner",
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
}
