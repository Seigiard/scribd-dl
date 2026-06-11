import { Effect, Layer, Schedule } from "effect";
import { ConfigStoreLive } from "./src/service/ConfigStore";
import { DownloadEngineLive } from "./src/service/DownloadEngine";
import { JobStoreLive } from "./src/service/JobStore";
import { ScribdDownloaderLive } from "./src/service/ScribdDownloader";
import { DEFAULT_CONFIG, makeConfigLoader } from "./src/utils/io/ConfigLoader";
import { DirectoryIoLive } from "./src/utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { TitleResolverLive } from "./src/utils/request/TitleResolver";
import { HttpServerLive } from "./src/server/HttpServerLive";

const buildEngineLayer = () => {
  const ConfigLayer = makeConfigLoader(DEFAULT_CONFIG);
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerSgLive, TitleResolverLive);
  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);
  const ConfigStoreLayer = Layer.provide(ConfigStoreLive, ConfigLayer);
  const EngineDeps = Layer.mergeAll(ScribdLayer, ConfigLayer, ConfigStoreLayer, JobStoreLive);
  return Layer.provide(DownloadEngineLive, EngineDeps);
};

const probeUntilReady = (baseUrl: string) =>
  Effect.tryPromise({
    try: () => fetch(`${baseUrl}/snapshot`).then((r) => (r.ok ? null : Promise.reject(new Error(`status ${r.status}`)))),
    catch: (e) => e as Error,
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
    Effect.timeoutFail({ duration: "5 seconds", onTimeout: () => new Error("embedded engine did not become ready") }),
  );

export const runEmbeddedEngine = (port: number) =>
  Effect.gen(function* () {
    const ServerLayer = HttpServerLive(port).pipe(Layer.provide(buildEngineLayer()));
    yield* Layer.launch(ServerLayer).pipe(Effect.forkDaemon);
    yield* probeUntilReady(`http://127.0.0.1:${port}`);
    return `http://127.0.0.1:${port}`;
  });
