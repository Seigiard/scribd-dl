import { describe, expect, mock, test } from "bun:test";
import { render } from "ink-testing-library";
import { Effect, Layer } from "effect";
import { DownloadEngine, DownloadEngineLive, type DownloadEngineService } from "../../src/service/DownloadEngine";
import { ScribdDownloader, type ScribdDownloaderService } from "../../src/service/ScribdDownloader";
import { ConfigLoader, type ConfigData } from "../../src/utils/io/ConfigLoader";
import { App } from "../../src/tui/App";

const testConfig: ConfigData = { scribd: { rendertime: 100 }, directory: { output: "/tmp/test-out", filename: "title" } };

const buildLayer = (execute: ScribdDownloaderService["execute"] = () => Effect.never as ReturnType<ScribdDownloaderService["execute"]>) => {
  const scribdSvc: ScribdDownloaderService = { execute };
  return Layer.provide(
    DownloadEngineLive,
    Layer.mergeAll(Layer.succeed(ScribdDownloader, scribdSvc), Layer.succeed(ConfigLoader, testConfig)),
  );
};

const flush = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

const withEngine = (fn: (engine: DownloadEngineService) => Promise<void>, executeOverride?: ScribdDownloaderService["execute"]) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* DownloadEngine;
        yield* Effect.promise(() => fn(engine));
      }).pipe(Effect.provide(buildLayer(executeOverride))),
    ),
  );

describe("App: paste handling", () => {
  test("scribd URL paste enqueues and renders item", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="output" onExit={() => {}} />);
      await flush();
      ui.stdin.write("https://www.scribd.com/document/1/foo");
      await flush();
      const snap = await Effect.runPromise(engine.snapshot);
      expect(snap.jobs).toHaveLength(1);
      expect(snap.jobs[0]!.url).toBe("https://www.scribd.com/document/1/foo");
      ui.unmount();
    });
  });

  test("junk paste shows 'No links found' transient", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="output" onExit={() => {}} />);
      await flush();
      ui.stdin.write("just random text without urls here long enough");
      await flush();
      expect(ui.lastFrame() ?? "").toContain("No links found in clipboard");
      ui.unmount();
    });
  });

  test("unsupported URL becomes Failed without Retry button", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="output" onExit={() => {}} />);
      await flush();
      ui.stdin.write("https://example.com/some/doc");
      await flush();
      const frame = ui.lastFrame() ?? "";
      expect(frame).toContain("Failed");
      expect(frame).toContain("Unsupported domain");
      expect(frame).not.toContain("[Retry]");
      ui.unmount();
    });
  });
});

describe("App: focus + actions", () => {
  test("Tab cycles between Remove buttons (worker busy on first, second Queued)", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="output" onExit={() => {}} />);
      await flush();
      await Effect.runPromise(
        engine.enqueue("https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b\nhttps://www.scribd.com/document/3/c"),
      );
      await flush();
      const frame = ui.lastFrame() ?? "";
      const removes = frame.match(/\[Remove\]/g)?.length ?? 0;
      expect(removes).toBe(2);
      ui.stdin.write("\t");
      await flush();
      ui.unmount();
    });
  });

  test("Enter on focused Remove removes the Queued job", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="output" onExit={() => {}} />);
      await flush();
      await Effect.runPromise(engine.enqueue("https://www.scribd.com/document/1/a\nhttps://www.scribd.com/document/2/b"));
      await flush();
      const before = await Effect.runPromise(engine.snapshot);
      expect(before.jobs).toHaveLength(2);
      // Tab past the [Change] button to focus the first Remove button
      ui.stdin.write("\t");
      await flush();
      ui.stdin.write("\r");
      await flush();
      const after = await Effect.runPromise(engine.snapshot);
      expect(after.jobs).toHaveLength(1);
      expect(after.jobs[0]!.status).toBe("Downloading");
      ui.unmount();
    });
  });
});

describe("App: change folder", () => {
  test("[Change] is focused initially; Header shows [Change]", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="/tmp/test-out" onExit={() => {}} />);
      await flush();
      const frame = ui.lastFrame() ?? "";
      expect(frame).toContain("[Change]");
      expect(frame).toContain("/tmp/test-out");
      ui.unmount();
    });
  });

  test("Enter on [Change] opens popup; Save applies new folder via engine.setOutputFolder", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="/tmp/test-out" onExit={() => {}} />);
      await flush();
      // Enter on [Change] (focusIndex 0)
      ui.stdin.write("\r");
      await flush();
      expect(ui.lastFrame() ?? "").toContain("Change download folder");
      // Type a new folder suffix
      ui.stdin.write("-edit");
      await flush();
      // Tab past input → Cancel → Save, then Enter
      ui.stdin.write("\t");
      await flush();
      ui.stdin.write("\t");
      await flush();
      ui.stdin.write("\r");
      await flush();
      // Popup closes, folder updated
      const after = await Effect.runPromise(engine.outputFolder);
      expect(after).toBe("/tmp/test-out-edit");
      expect(ui.lastFrame() ?? "").not.toContain("Change download folder");
      expect(ui.lastFrame() ?? "").toContain("/tmp/test-out-edit");
      ui.unmount();
    });
  });

  test("Esc inside ChangeFolderPopup closes it without saving", async () => {
    await withEngine(async (engine) => {
      const ui = render(<App engine={engine} folder="/tmp/test-out" onExit={() => {}} />);
      await flush();
      ui.stdin.write("\r");
      await flush();
      expect(ui.lastFrame() ?? "").toContain("Change download folder");
      ui.stdin.write("\x1b");
      await flush();
      expect(ui.lastFrame() ?? "").not.toContain("Change download folder");
      const after = await Effect.runPromise(engine.outputFolder);
      expect(after).toBe("/tmp/test-out");
      ui.unmount();
    });
  });
});

describe("App: exit flow", () => {
  test("q with no active jobs → onExit called", async () => {
    await withEngine(async (engine) => {
      const onExit = mock(() => {});
      const ui = render(<App engine={engine} folder="output" onExit={onExit} />);
      await flush();
      ui.stdin.write("q");
      await flush();
      expect(onExit).toHaveBeenCalled();
      ui.unmount();
    });
  });

  test("q with active jobs opens popup; Enter on Cancel keeps app running", async () => {
    await withEngine(async (engine) => {
      const onExit = mock(() => {});
      const ui = render(<App engine={engine} folder="output" onExit={onExit} />);
      await flush();
      await Effect.runPromise(engine.enqueue("https://www.scribd.com/document/1/a"));
      await flush();
      ui.stdin.write("q");
      await flush();
      expect(ui.lastFrame() ?? "").toContain("Close anyway");
      ui.stdin.write("\r");
      await flush();
      expect(onExit).not.toHaveBeenCalled();
      expect(ui.lastFrame() ?? "").not.toContain("Close anyway");
      ui.unmount();
    });
  });

  test("popup → Tab → Enter on Close anyway calls onExit", async () => {
    await withEngine(async (engine) => {
      const onExit = mock(() => {});
      const ui = render(<App engine={engine} folder="output" onExit={onExit} />);
      await flush();
      await Effect.runPromise(engine.enqueue("https://www.scribd.com/document/1/a"));
      await flush();
      ui.stdin.write("q");
      await flush();
      ui.stdin.write("\t");
      await flush();
      ui.stdin.write("\r");
      await flush();
      expect(onExit).toHaveBeenCalled();
      ui.unmount();
    });
  });

  test("Esc inside popup closes popup and does not exit", async () => {
    await withEngine(async (engine) => {
      const onExit = mock(() => {});
      const ui = render(<App engine={engine} folder="output" onExit={onExit} />);
      await flush();
      await Effect.runPromise(engine.enqueue("https://www.scribd.com/document/1/a"));
      await flush();
      ui.stdin.write("q");
      await flush();
      expect(ui.lastFrame() ?? "").toContain("Close anyway");
      ui.stdin.write("\x1b");
      await flush();
      expect(ui.lastFrame() ?? "").not.toContain("Close anyway");
      expect(onExit).not.toHaveBeenCalled();
      ui.unmount();
    });
  });
});
