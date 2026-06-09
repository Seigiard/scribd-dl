import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { Text } from "ink";
import { Effect, Layer } from "effect";
import { DownloadEngine, DownloadEngineLive, type DownloadEngineService } from "../../src/service/DownloadEngine";
import { ScribdDownloader, type ScribdDownloaderService } from "../../src/service/ScribdDownloader";
import { useEngineState } from "../../src/tui/useEngineState";

const buildLayer = () => {
  const scribdSvc: ScribdDownloaderService = {
    execute: () => Effect.never as ReturnType<ScribdDownloaderService["execute"]>,
  };
  return Layer.provide(DownloadEngineLive, Layer.succeed(ScribdDownloader, scribdSvc));
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
