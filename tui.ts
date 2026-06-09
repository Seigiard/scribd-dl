import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { render } from "ink";
import React from "react";
import { DownloadEngine, DownloadEngineLive } from "./src/service/DownloadEngine";
import { ScribdDownloaderLive } from "./src/service/ScribdDownloader";
import { ConfigLoader, type ConfigData, makeConfigLoader } from "./src/utils/io/ConfigLoader";
import { DirectoryIo, DirectoryIoLive } from "./src/utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { outputOpt, filenameOpt, rendertimeOpt } from "./src/cli/options";
import { App } from "./src/tui/App";

const buildLayer = (config: ConfigData) => {
  const ConfigLayer = makeConfigLoader(config);
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerSgLive);
  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);
  const EngineLayer = Layer.provide(DownloadEngineLive, ScribdLayer);
  return Layer.mergeAll(EngineLayer, ConfigLayer, DirectoryIoLive);
};

const program = (config: ConfigData) =>
  Effect.scoped(
    Effect.gen(function* () {
      const engine = yield* DownloadEngine;
      const cfg = yield* ConfigLoader;
      const dir = yield* DirectoryIo;
      yield* dir.create(cfg.directory.output);

      const instance = yield* Effect.sync(() => render(React.createElement(App, { engine, folder: cfg.directory.output })));
      yield* Effect.promise(() => instance.waitUntilExit());
    }),
  ).pipe(Effect.provide(buildLayer(config)));

const command = Command.make(
  "scribd-dl-tui",
  { output: outputOpt, filename: filenameOpt, rendertime: rendertimeOpt },
  ({ output, filename, rendertime }) => {
    const config: ConfigData = { scribd: { rendertime }, directory: { output, filename } };
    return program(config);
  },
).pipe(Command.withDescription("Interactive TUI for downloading Scribd documents."));

const cli = Command.run(command, {
  name: "Scribd Downloader TUI",
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
}
