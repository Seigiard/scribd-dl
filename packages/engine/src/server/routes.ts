import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect, Stream } from "effect";
import type { JobId } from "@scribd-dl/shared";
import type { NotRemovable, NotRetryable } from "../errors/DomainErrors";
import { DownloadEngine } from "../service/DownloadEngine";

const jsonError = (status: number, body: object) => HttpServerResponse.json(body, { status });

const readJsonBody = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  return yield* req.json;
});

const snapshotRoute = HttpRouter.get(
  "/snapshot",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const snap = yield* engine.snapshot;
    return yield* HttpServerResponse.json(snap);
  }),
);

const enqueueRoute = HttpRouter.post(
  "/enqueue",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const body = yield* readJsonBody.pipe(Effect.catchAll(() => Effect.succeed({})));
    const text = typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text : "";
    const jobs = yield* engine.enqueue(text);
    return yield* HttpServerResponse.json({ jobs });
  }),
);

const clearCompletedRoute = HttpRouter.del(
  "/jobs/completed",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const removed = yield* engine.clearCompleted;
    return yield* HttpServerResponse.json({ removed });
  }),
);

const clearFailedRoute = HttpRouter.del(
  "/jobs/failed",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const removed = yield* engine.clearFailed;
    return yield* HttpServerResponse.json({ removed });
  }),
);

const clearAllRoute = HttpRouter.del(
  "/jobs",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const removed = yield* engine.clearAll;
    return yield* HttpServerResponse.json({ removed });
  }),
);

const removeRoute = HttpRouter.del(
  "/jobs/:id",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const params = yield* HttpRouter.params;
    const id = (params.id ?? "") as JobId;
    return yield* engine.remove(id).pipe(
      Effect.map(() => HttpServerResponse.empty({ status: 204 })),
      Effect.catchTag("JobNotFound", () => jsonError(404, { error: "JobNotFound" })),
      Effect.catchTag("NotRemovable", (e: NotRemovable) => jsonError(409, { error: "NotRemovable", status: e.status })),
    );
  }),
);

const retryRoute = HttpRouter.post(
  "/jobs/:id/retry",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const params = yield* HttpRouter.params;
    const id = (params.id ?? "") as JobId;
    return yield* engine.retry(id).pipe(
      Effect.map(() => HttpServerResponse.empty({ status: 204 })),
      Effect.catchTag("JobNotFound", () => jsonError(404, { error: "JobNotFound" })),
      Effect.catchTag("NotRetryable", (e: NotRetryable) => jsonError(409, { error: "NotRetryable", status: e.status })),
    );
  }),
);

const folderGetRoute = HttpRouter.get(
  "/folder",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const path = yield* engine.outputFolder;
    return yield* HttpServerResponse.json({ path });
  }),
);

const folderPostRoute = HttpRouter.post(
  "/folder",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const body = yield* readJsonBody.pipe(Effect.catchAll(() => Effect.succeed({})));
    const path = typeof (body as { path?: unknown }).path === "string" ? (body as { path: string }).path : "";
    if (path.trim() === "") {
      return yield* jsonError(400, { error: "InvalidPath" });
    }
    yield* engine.setOutputFolder(path);
    return HttpServerResponse.empty({ status: 204 });
  }),
);

// GET /settings returns the iLovePDF keys — including the secret — in plaintext (KTD7).
// It relies on the engine's loopback binding (127.0.0.1) plus the localhost/tauri CORS
// gate in HttpServerLive; no stricter auth is applied (accepted local-tool tradeoff).
const settingsGetRoute = HttpRouter.get(
  "/settings",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const settings = yield* engine.settings;
    return yield* HttpServerResponse.json(settings);
  }),
);

const settingsPostRoute = HttpRouter.post(
  "/settings",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const body = yield* readJsonBody.pipe(Effect.catchAll(() => Effect.succeed({})));
    const publicKey = typeof (body as { publicKey?: unknown }).publicKey === "string" ? (body as { publicKey: string }).publicKey : "";
    const secretKey = typeof (body as { secretKey?: unknown }).secretKey === "string" ? (body as { secretKey: string }).secretKey : "";
    const valid = yield* engine.setSettings({ publicKey, secretKey });
    return yield* HttpServerResponse.json({ valid });
  }),
);

const eventsRoute = HttpRouter.get(
  "/events",
  Effect.gen(function* () {
    const engine = yield* DownloadEngine;
    const socket = yield* HttpServerRequest.upgrade;
    const write = yield* socket.writer;
    const pushEvents = Stream.runForEach(engine.events, (event) => write(JSON.stringify(event)));
    yield* Effect.forkScoped(pushEvents);
    yield* socket.run(() => Effect.void);
    return HttpServerResponse.empty();
  }),
);

export const router = HttpRouter.empty.pipe(
  snapshotRoute,
  enqueueRoute,
  clearCompletedRoute,
  clearFailedRoute,
  clearAllRoute,
  removeRoute,
  retryRoute,
  folderGetRoute,
  folderPostRoute,
  settingsGetRoute,
  settingsPostRoute,
  eventsRoute,
);
