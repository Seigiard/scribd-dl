import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Effect, Layer, Schema, Stream } from "effect";
import { EnqueueRequestSchema, FolderRequestSchema, SettingsRequestSchema, type ErrorResponse, type JobId } from "@scribd-dl/shared";
import type { NotRemovable, NotRetryable } from "../errors/DomainErrors";
import { DownloadEngineTag } from "../service/DownloadEngine";

const jsonError = (status: number, body: ErrorResponse) => HttpServerResponse.json(body, { status });

const readJsonBody = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;

  return yield* req.json;
});

const snapshotRoute = HttpRouter.add(
  "GET",
  "/snapshot",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const snap = yield* engine.snapshot;

    return yield* HttpServerResponse.json(snap);
  }),
);

const enqueueRoute = HttpRouter.add(
  "POST",
  "/enqueue",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const body = yield* readJsonBody.pipe(Effect.catch(() => Effect.succeed({})));

    const { text } = yield* Schema.decodeUnknownEffect(EnqueueRequestSchema)(body).pipe(Effect.orElseSucceed(() => ({ text: "" })));

    const jobs = yield* engine.enqueue(text);

    return yield* HttpServerResponse.json({ jobs });
  }),
);

const clearCompletedRoute = HttpRouter.add(
  "DELETE",
  "/jobs/completed",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const removed = yield* engine.clearCompleted;

    return yield* HttpServerResponse.json({ removed });
  }),
);

const clearFailedRoute = HttpRouter.add(
  "DELETE",
  "/jobs/failed",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const removed = yield* engine.clearFailed;

    return yield* HttpServerResponse.json({ removed });
  }),
);

const clearAllRoute = HttpRouter.add(
  "DELETE",
  "/jobs",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const removed = yield* engine.clearAll;

    return yield* HttpServerResponse.json({ removed });
  }),
);

const removeRoute = HttpRouter.add(
  "DELETE",
  "/jobs/:id",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const params = yield* HttpRouter.params;
    const id: JobId = params.id ?? "";

    return yield* engine.remove(id).pipe(
      Effect.map(() => HttpServerResponse.empty({ status: 204 })),
      Effect.catchTag("JobNotFound", () => jsonError(404, { error: "JobNotFound" })),
      Effect.catchTag("NotRemovable", (e: NotRemovable) => jsonError(409, { error: "NotRemovable", status: e.status })),
    );
  }),
);

const retryRoute = HttpRouter.add(
  "POST",
  "/jobs/:id/retry",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const params = yield* HttpRouter.params;
    const id: JobId = params.id ?? "";

    return yield* engine.retry(id).pipe(
      Effect.map(() => HttpServerResponse.empty({ status: 204 })),
      Effect.catchTag("JobNotFound", () => jsonError(404, { error: "JobNotFound" })),
      Effect.catchTag("NotRetryable", (e: NotRetryable) => jsonError(409, { error: "NotRetryable", status: e.status })),
    );
  }),
);

const folderGetRoute = HttpRouter.add(
  "GET",
  "/folder",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const path = yield* engine.outputFolder;

    return yield* HttpServerResponse.json({ path });
  }),
);

const folderPostRoute = HttpRouter.add(
  "POST",
  "/folder",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const body = yield* readJsonBody.pipe(Effect.catch(() => Effect.succeed({})));

    const { path } = yield* Schema.decodeUnknownEffect(FolderRequestSchema)(body).pipe(Effect.orElseSucceed(() => ({ path: "" })));

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
const settingsGetRoute = HttpRouter.add(
  "GET",
  "/settings",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const settings = yield* engine.settings;

    return yield* HttpServerResponse.json(settings);
  }),
);

const settingsPostRoute = HttpRouter.add(
  "POST",
  "/settings",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const body = yield* readJsonBody.pipe(Effect.catch(() => Effect.succeed({})));

    const { publicKey } = yield* Schema.decodeUnknownEffect(Schema.Struct({ publicKey: SettingsRequestSchema.fields.publicKey }))(
      body,
    ).pipe(Effect.orElseSucceed(() => ({ publicKey: "" })));

    const { secretKey } = yield* Schema.decodeUnknownEffect(Schema.Struct({ secretKey: SettingsRequestSchema.fields.secretKey }))(
      body,
    ).pipe(Effect.orElseSucceed(() => ({ secretKey: "" })));

    const valid = yield* engine.setSettings({ publicKey, secretKey });

    return yield* HttpServerResponse.json({ valid });
  }),
);

const eventsRoute = HttpRouter.add(
  "GET",
  "/events",
  Effect.gen(function* () {
    const engine = yield* DownloadEngineTag;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const socket = yield* request.upgrade;
    const reader = yield* socket.reader;
    const writer = yield* socket.writer;
    const pushEvents = Stream.runForEach(engine.events, (event) => writer.write(JSON.stringify(event)));
    yield* Effect.forkScoped(pushEvents);
    yield* Effect.forever(reader.pull);

    return HttpServerResponse.empty();
  }),
);

export const router = Layer.mergeAll(
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
