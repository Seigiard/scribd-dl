import { Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { fetchFolder, fetchSnapshot } from "@scribd-dl/shared";
import { render } from "ink";
import React from "react";
import { App } from "./src/tui/App";

const DEFAULT_ENGINE_URL = "http://localhost:4747";

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

const program = (engineUrl: string) =>
  Effect.gen(function* () {
    const reachable = yield* Effect.either(healthCheck(engineUrl));
    if (reachable._tag === "Left") {
      yield* Effect.sync(() => {
        process.stderr.write(`scribd-dl-tui: engine sidecar not reachable at ${engineUrl}\nrun \`bun run engine\` first\n`);
        process.exit(1);
      });
      return;
    }
    const folder = yield* initialFolderOrEmpty(engineUrl);
    yield* runUi(engineUrl, folder);
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
