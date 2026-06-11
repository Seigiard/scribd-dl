import { Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { fetchFolder, fetchSnapshot } from "@scribd-dl/shared";
import { runEmbeddedEngine } from "@scribd-dl/engine/embedded";
import { render } from "ink";
import React from "react";
import { App } from "./src/tui/App";

const DEFAULT_ENGINE_URL = "http://localhost:4747";
const EMBEDDED_ENGINE_PORT = 4747;

const engineUrlOpt = Options.text("engine-url").pipe(
  Options.withDefault(DEFAULT_ENGINE_URL),
  Options.withDescription("Base URL of the scribd-dl engine HTTP/WS sidecar."),
);

const healthCheck = (baseUrl: string) =>
  Effect.tryPromise({
    try: () => fetchSnapshot(baseUrl),
    catch: () => new Error("engine unreachable"),
  });

const initialFolderOrEmpty = (baseUrl: string) =>
  Effect.tryPromise({
    try: () => fetchFolder(baseUrl),
    catch: () => new Error("folder fetch failed"),
  }).pipe(Effect.orElseSucceed(() => ""));

const runUi = (baseUrl: string, initialFolder: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      process.stdout.write("\x1b[?1049h\x1b[H");
      return render(React.createElement(App, { baseUrl, initialFolder }));
    }),
    (instance) => Effect.promise(() => instance.waitUntilExit()),
    () =>
      Effect.sync(() => {
        process.stdout.write("\x1b[?1049l");
      }),
  );

const ensureEngine = (engineUrl: string) =>
  Effect.gen(function* () {
    const reachable = yield* Effect.either(healthCheck(engineUrl));
    if (reachable._tag === "Right") return engineUrl;
    process.stderr.write(`scribd-dl-tui: no external engine at ${engineUrl}, starting embedded engine on :${EMBEDDED_ENGINE_PORT}\n`);
    const embeddedUrl = yield* runEmbeddedEngine(EMBEDDED_ENGINE_PORT).pipe(
      Effect.tapError((e) =>
        Effect.sync(() => {
          process.stderr.write(`scribd-dl-tui: embedded engine failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
          process.exit(1);
        }),
      ),
    );
    return embeddedUrl;
  });

const program = (engineUrl: string) =>
  Effect.gen(function* () {
    const activeUrl = yield* ensureEngine(engineUrl);
    const folder = yield* initialFolderOrEmpty(activeUrl);
    yield* runUi(activeUrl, folder);
  });

const command = Command.make("scribd-dl-tui", { engineUrl: engineUrlOpt }, ({ engineUrl }) => program(engineUrl)).pipe(
  Command.withDescription("Interactive TUI client for the scribd-dl engine sidecar."),
);

const cli = Command.run(command, {
  name: "Scribd Downloader TUI",
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
}
