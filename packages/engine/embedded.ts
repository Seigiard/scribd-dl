import { Effect, Layer, Schedule } from "effect";
import { buildDownloadEngineLayer } from "./src/composition";
import { HttpServerLive } from "./src/server/HttpServerLive";

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
    const ServerLayer = HttpServerLive(port).pipe(Layer.provide(buildDownloadEngineLayer()));
    yield* Layer.launch(ServerLayer).pipe(Effect.forkDaemon);
    yield* probeUntilReady(`http://127.0.0.1:${port}`);
    return `http://127.0.0.1:${port}`;
  });
