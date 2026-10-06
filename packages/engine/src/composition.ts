import { Effect, Layer } from "effect";
import { ConfigStoreLive } from "./service/ConfigStore";
import { DownloadEngineLive, type DownloadEngine } from "./service/DownloadEngine";
import { JobStoreLive } from "./service/JobStore";
import { PdfCompressorLive } from "./service/PdfCompressor";
import { ScribdDownloaderTag, ScribdDownloaderLive } from "./service/ScribdDownloader";
import { ScrapersTag } from "./service/Scraper";
import { ConfigLoaderLive, type ConfigLoader } from "./utils/io/ConfigLoader";
import { DirectoryIoLive } from "./utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./utils/io/PdfGenerator";
import {
  PuppeteerSgLive,
  PuppeteerSgDebugLive,
  type PuppeteerSg,
} from "./utils/request/PuppeteerSg";
import { TitleResolverLive } from "./utils/request/TitleResolver";
import type { BrowserLaunchFailed } from "./errors/DomainErrors";

const ConfigLayer = ConfigLoaderLive;

export const makeScrapersLayer = (
  puppeteerLayer: Layer.Layer<PuppeteerSg, BrowserLaunchFailed, never>,
) => {
  const InfraLayer = Layer.mergeAll(
    PdfGeneratorLive,
    ConfigLayer,
    DirectoryIoLive,
    puppeteerLayer,
    TitleResolverLive,
  );

  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);

  return Layer.provide(
    Layer.effect(
      ScrapersTag,
      Effect.gen(function* () {
        const scribd = yield* ScribdDownloaderTag;

        return [scribd];
      }),
    ),
    ScribdLayer,
  );
};

export const buildDownloadEngineLayer = (
  puppeteerLayer: Layer.Layer<PuppeteerSg, BrowserLaunchFailed, never> = PuppeteerSgLive,
) => {
  const ScrapersLayer = makeScrapersLayer(puppeteerLayer);
  const ConfigStoreLayer = Layer.provide(ConfigStoreLive, ConfigLayer);

  const EngineDeps = Layer.mergeAll(
    ScrapersLayer,
    ConfigLayer,
    ConfigStoreLayer,
    JobStoreLive,
    PdfCompressorLive,
    PdfGeneratorLive,
  );

  return Layer.provide(DownloadEngineLive, EngineDeps);
};

export const ScrapersDebugLive = makeScrapersLayer(PuppeteerSgDebugLive);

export type { ConfigLoader, DownloadEngine };
