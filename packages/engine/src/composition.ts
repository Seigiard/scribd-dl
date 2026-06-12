import { Effect, Layer } from "effect";
import { ScribdDownloader, ScribdDownloaderLive } from "./service/ScribdDownloader";
import { Scrapers } from "./service/Scraper";
import { ConfigLoader, DEFAULT_CONFIG, makeConfigLoader } from "./utils/io/ConfigLoader";
import { DirectoryIoLive } from "./utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./utils/io/PdfGenerator";
import { type PuppeteerSg } from "./utils/request/PuppeteerSg";
import { TitleResolverLive } from "./utils/request/TitleResolver";

export const ConfigLayer = makeConfigLoader(DEFAULT_CONFIG);

export const makeScrapersLayer = (puppeteerLayer: Layer.Layer<PuppeteerSg, never, never>): Layer.Layer<Scrapers, never, never> => {
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, puppeteerLayer, TitleResolverLive);
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

export type { ConfigLoader };
