import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { Text } from "ink";
import { Effect, Layer } from "effect";
import { ConfigStore, type ConfigStoreService } from "../../src/service/ConfigStore";
import { DownloadEngine, DownloadEngineLive, type DownloadEngineService } from "../../src/service/DownloadEngine";
import { JobStore, type JobStoreService } from "../../src/service/JobStore";
import { ScribdDownloader, type ScribdDownloaderService } from "../../src/service/ScribdDownloader";
import { ConfigLoader, type ConfigData } from "../../src/utils/io/ConfigLoader";
import { useEngineState } from "../../src/tui/useEngineState";

const testConfig: ConfigData = { scribd: { rendertime: 100 }, directory: { output: "/tmp/test-out", filename: "title" } };

const buildLayer = () => {
  const scribdSvc: ScribdDownloaderService = {
    execute: () => Effect.never as ReturnType<ScribdDownloaderService["execute"]>,
  };
  const configStoreSvc: ConfigStoreService = {
    read: Effect.sync(() => ({ outputFolder: testConfig.directory.output })),
    write: () => Effect.void,
  };
  const jobStoreSvc: JobStoreService = {
    read: Effect.sync(() => []),
    write: () => Effect.void,
  };
  return Layer.provide(
    DownloadEngineLive,
    Layer.mergeAll(
      Layer.succeed(ScribdDownloader, scribdSvc),
      Layer.succeed(ConfigLoader, testConfig),
      Layer.succeed(ConfigStore, configStoreSvc),
      Layer.succeed(JobStore, jobStoreSvc),
    ),
  );
};

const Probe = ({ engine }: { engine: DownloadEngineService }) => {
  const snap = useEngineState(engine);
  return React.createElement(Text, null, `count=${snap.jobs.length}`);
};

const flush = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe("useEngineState", () => {
  test("initial render shows zero jobs", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* Effect.promise(async () => {
            const ui = render(React.createElement(Probe, { engine }));
            await flush();
            expect(ui.lastFrame()).toContain("count=0");
            ui.unmount();
          });
        }).pipe(Effect.provide(buildLayer())),
      ),
    );
  });

  test("re-renders after engine.enqueue", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* DownloadEngine;
          yield* Effect.promise(async () => {
            const ui = render(React.createElement(Probe, { engine }));
            await flush();
            await Effect.runPromise(engine.enqueue("https://www.scribd.com/document/1/x"));
            await flush();
            expect(ui.lastFrame()).toContain("count=1");
            await Effect.runPromise(engine.enqueue("https://www.scribd.com/document/2/y"));
            await flush();
            expect(ui.lastFrame()).toContain("count=2");
            ui.unmount();
          });
        }).pipe(Effect.provide(buildLayer())),
      ),
    );
  });

  test("unmount stops the subscription fiber", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const realEngine = yield* DownloadEngine;
          let snapshotReads = 0;
          const wrapped: DownloadEngineService = {
            ...realEngine,
            snapshot: realEngine.snapshot.pipe(Effect.tap(() => Effect.sync(() => snapshotReads++))),
          };
          yield* Effect.promise(async () => {
            const ui = render(React.createElement(Probe, { engine: wrapped }));
            await flush();
            await Effect.runPromise(realEngine.enqueue("https://www.scribd.com/document/1/x"));
            await flush();
            const readsBeforeUnmount = snapshotReads;
            ui.unmount();
            await flush();
            await Effect.runPromise(realEngine.enqueue("https://www.scribd.com/document/2/y"));
            await flush();
            expect(snapshotReads).toBe(readsBeforeUnmount);
          });
        }).pipe(Effect.provide(buildLayer())),
      ),
    );
  });
});
