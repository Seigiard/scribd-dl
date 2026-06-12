import { Effect, Layer } from "effect";
import { ConfigStoreLive } from "./service/ConfigStore";
import { DownloadEngine, DownloadEngineLive } from "./service/DownloadEngine";
import { JobStoreLive } from "./service/JobStore";
import { ScribdDownloader, ScribdDownloaderLive } from "./service/ScribdDownloader";
import { Scrapers } from "./service/Scraper";
import { ConfigLoader, DEFAULT_CONFIG, makeConfigLoader } from "./utils/io/ConfigLoader";
import { DirectoryIoLive } from "./utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./utils/io/PdfGenerator";
import { PuppeteerSgLive, type PuppeteerSg } from "./utils/request/PuppeteerSg";
import { TitleResolverLive } from "./utils/request/TitleResolver";
import type { BrowserLaunchFailed } from "./errors/DomainErrors";

const ConfigLayer = makeConfigLoader(DEFAULT_CONFIG);

export const makeScrapersLayer = (puppeteerLayer: Layer.Layer<PuppeteerSg, BrowserLaunchFailed, never>) => {
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

export const buildDownloadEngineLayer = (puppeteerLayer: Layer.Layer<PuppeteerSg, BrowserLaunchFailed, never> = PuppeteerSgLive) => {
  const ScrapersLayer = makeScrapersLayer(puppeteerLayer);
  const ConfigStoreLayer = Layer.provide(ConfigStoreLive, ConfigLayer);
  const EngineDeps = Layer.mergeAll(ScrapersLayer, ConfigLayer, ConfigStoreLayer, JobStoreLive);
  return Layer.provide(DownloadEngineLive, EngineDeps);
};

export type { ConfigLoader, DownloadEngine };
