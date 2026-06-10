import { Command } from "@effect/cli";
import { HttpServer } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { DownloadEngineLive } from "./src/service/DownloadEngine";
import { ScribdDownloaderLive } from "./src/service/ScribdDownloader";
import { type ConfigData, makeConfigLoader } from "./src/utils/io/ConfigLoader";
import { DirectoryIoLive } from "./src/utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { TitleResolverLive } from "./src/utils/request/TitleResolver";
import { outputOpt, filenameOpt, rendertimeOpt, portOpt } from "./src/cli/options";
import { HttpServerLive } from "./src/server/HttpServerLive";

const printReady = HttpServer.addressWith((address) =>
  Effect.sync(() => {
    if (address._tag === "TcpAddress") {
      console.log(`READY port=${address.port}`);
    } else {
      console.log(`READY unix=${address.path}`);
    }
  }),
);

const program = printReady.pipe(Effect.zipRight(Effect.never));

const buildEngineLayer = (config: ConfigData) => {
  const ConfigLayer = makeConfigLoader(config);
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerSgLive, TitleResolverLive);
  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);
  return Layer.provide(DownloadEngineLive, Layer.mergeAll(ScribdLayer, ConfigLayer));
};

const command = Command.make(
  "scribd-dl-engine",
  { output: outputOpt, filename: filenameOpt, rendertime: rendertimeOpt, port: portOpt },
  ({ output, filename, rendertime, port }) => {
    const config: ConfigData = { scribd: { rendertime }, directory: { output, filename } };
    const EngineLayer = buildEngineLayer(config);
    const ServerLayer = HttpServerLive(port).pipe(Layer.provide(EngineLayer));
    return Effect.scoped(program).pipe(Effect.provide(ServerLayer));
  },
).pipe(Command.withDescription("Run the scribd-dl download engine as a localhost HTTP/WS server."));

const cli = Command.run(command, {
  name: "Scribd Downloader Engine",
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
}
