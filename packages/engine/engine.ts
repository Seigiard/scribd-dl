import { Command } from "effect/cli";
import { HttpServer } from "effect/http";
import { BunServices, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer, Predicate } from "effect";
import { buildDownloadEngineLayer } from "./src/composition";
import { portOpt } from "./src/cli/options";
import { HttpServerLive } from "./src/server/HttpServerLive";

const printReady = Effect.flatMap(HttpServer.HttpServer, ({ address }) =>
  Effect.sync(() => {
    if (Predicate.isTagged(address, "UnixPathAddress")) {
      console.log(`READY unix=${address.path}`);
    } else {
      console.log(`READY port=${address.port}`);
    }
  }),
);

const program = printReady.pipe(Effect.andThen(Effect.never));

const command = Command.make("scribd-dl-engine", { port: portOpt }, ({ port }) => {
  const EngineLayer = buildDownloadEngineLayer();
  const ServerLayer = HttpServerLive(port).pipe(Layer.provide(EngineLayer));

  return Effect.scoped(program).pipe(Effect.provide(ServerLayer));
}).pipe(Command.withDescription("Run the scribd-dl download engine as a localhost HTTP/WS server."));

const cli = Command.run(command, {
  version: "1.0.0",
});

const installParentDeathWatchdog = (): void => {
  if (process.stdin.isTTY) return;
  const exit = () => process.exit(0);
  process.stdin.on("end", exit);
  process.stdin.on("close", exit);
  process.stdin.resume();
};

if (import.meta.main) {
  installParentDeathWatchdog();
  BunRuntime.runMain(cli.pipe(Effect.provide(BunServices.layer)));
}
