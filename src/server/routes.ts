import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import type { NotRemovable, NotRetryable } from "../errors/DomainErrors";
import { DownloadEngine, type JobId } from "../service/DownloadEngine";

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

export const router = HttpRouter.empty.pipe(snapshotRoute, enqueueRoute, removeRoute, retryRoute, folderGetRoute, folderPostRoute);
