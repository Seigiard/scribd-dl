import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { render } from "ink";
import React from "react";
import { ConfigStoreLive } from "./src/service/ConfigStore";
import { DownloadEngine, DownloadEngineLive } from "./src/service/DownloadEngine";
import { JobStoreLive } from "./src/service/JobStore";
import { ScribdDownloaderLive } from "./src/service/ScribdDownloader";
import { DEFAULT_CONFIG, makeConfigLoader } from "./src/utils/io/ConfigLoader";
import { DirectoryIo, DirectoryIoLive } from "./src/utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { TitleResolverLive } from "./src/utils/request/TitleResolver";
import { App } from "./src/tui/App";

const buildLayer = () => {
  const ConfigLayer = makeConfigLoader(DEFAULT_CONFIG);
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerSgLive, TitleResolverLive);
  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);
  const ConfigStoreLayer = Layer.provide(ConfigStoreLive, ConfigLayer);
  const EngineDeps = Layer.mergeAll(ScribdLayer, ConfigLayer, ConfigStoreLayer, JobStoreLive);
  const EngineLayer = Layer.provide(DownloadEngineLive, EngineDeps);
  return Layer.mergeAll(EngineLayer, ConfigLayer, DirectoryIoLive);
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const dir = yield* DirectoryIo;
    const folder = yield* engine.outputFolder;
    yield* dir.create(folder);

    const instance = yield* Effect.acquireRelease(
      Effect.sync(() => {
        process.stdout.write("\x1b[?1049h\x1b[H");
        return render(React.createElement(App, { engine, folder }));
      }),
      () =>
        Effect.sync(() => {
          process.stdout.write("\x1b[?1049l");
        }),
    );
    yield* Effect.promise(() => instance.waitUntilExit());
  }),
).pipe(Effect.provide(buildLayer()));

if (import.meta.main) {
  BunRuntime.runMain(program.pipe(Effect.provide(BunContext.layer)));
}
