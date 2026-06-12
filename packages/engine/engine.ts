import { Command } from "@effect/cli";
import { HttpServer } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { ConfigLayer, makeScrapersLayer } from "./src/composition";
import { ConfigStoreLive } from "./src/service/ConfigStore";
import { DownloadEngineLive } from "./src/service/DownloadEngine";
import { JobStoreLive } from "./src/service/JobStore";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { portOpt } from "./src/cli/options";
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

const buildEngineLayer = () => {
  const ScrapersLayer = makeScrapersLayer(PuppeteerSgLive);
  const ConfigStoreLayer = Layer.provide(ConfigStoreLive, ConfigLayer);
  const EngineDeps = Layer.mergeAll(ScrapersLayer, ConfigLayer, ConfigStoreLayer, JobStoreLive);
  return Layer.provide(DownloadEngineLive, EngineDeps);
};

const command = Command.make("scribd-dl-engine", { port: portOpt }, ({ port }) => {
  const EngineLayer = buildEngineLayer();
  const ServerLayer = HttpServerLive(port).pipe(Layer.provide(EngineLayer));
  return Effect.scoped(program).pipe(Effect.provide(ServerLayer));
}).pipe(Command.withDescription("Run the scribd-dl download engine as a localhost HTTP/WS server."));

const cli = Command.run(command, {
  name: "Scribd Downloader Engine",
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
}
