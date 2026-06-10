import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { render } from "ink";
import React from "react";
import { DownloadEngine, DownloadEngineLive } from "./src/service/DownloadEngine";
import { ScribdDownloaderLive } from "./src/service/ScribdDownloader";
import { ConfigLoader, DEFAULT_CONFIG, makeConfigLoader } from "./src/utils/io/ConfigLoader";
import { DirectoryIo, DirectoryIoLive } from "./src/utils/io/DirectoryIo";
import { PdfGeneratorLive } from "./src/utils/io/PdfGenerator";
import { PuppeteerSgLive } from "./src/utils/request/PuppeteerSg";
import { TitleResolverLive } from "./src/utils/request/TitleResolver";
import { App } from "./src/tui/App";

const buildLayer = () => {
  const ConfigLayer = makeConfigLoader(DEFAULT_CONFIG);
  const InfraLayer = Layer.mergeAll(PdfGeneratorLive, ConfigLayer, DirectoryIoLive, PuppeteerSgLive, TitleResolverLive);
  const ScribdLayer = Layer.provide(ScribdDownloaderLive, InfraLayer);
  const EngineLayer = Layer.provide(DownloadEngineLive, Layer.mergeAll(ScribdLayer, ConfigLayer));
  return Layer.mergeAll(EngineLayer, ConfigLayer, DirectoryIoLive);
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const cfg = yield* ConfigLoader;
    const dir = yield* DirectoryIo;
    yield* dir.create(cfg.directory.output);

    const instance = yield* Effect.acquireRelease(
      Effect.sync(() => {
        process.stdout.write("\x1b[?1049h\x1b[H");
        return render(React.createElement(App, { engine, folder: cfg.directory.output }));
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
