import { useEffect, useState } from "react";
import { Effect, Fiber, Stream } from "effect";
import type { EngineSnapshot } from "@scribd-dl/shared";
import type { DownloadEngineService } from "../service/DownloadEngine";

export const useEngineState = (engine: DownloadEngineService): EngineSnapshot => {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>({ jobs: [] });

  useEffect(() => {
    const subscribe = Stream.runForEach(engine.events, () =>
      engine.snapshot.pipe(Effect.flatMap((snap) => Effect.sync(() => setSnapshot(snap)))),
    );
    const fiber = Effect.runFork(subscribe);
    Effect.runPromise(engine.snapshot)
      .then(setSnapshot)
      .catch(() => {});
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [engine]);

  return snapshot;
};
