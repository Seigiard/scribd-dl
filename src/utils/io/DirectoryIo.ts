import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import { DirectoryIoFailed } from "../../errors/DomainErrors";

export interface DirectoryIoService {
  readonly create: (path: string) => Effect.Effect<void, DirectoryIoFailed, never>;
  readonly remove: (path: string) => Effect.Effect<void, DirectoryIoFailed, never>;
}

export class DirectoryIo extends Context.Tag("DirectoryIo")<DirectoryIo, DirectoryIoService>() {}

const create = (path: string): Effect.Effect<void, DirectoryIoFailed, never> =>
  Effect.tryPromise({
    try: async () => {
      await fs.mkdir(path, { recursive: true });
    },
    catch: (cause) => new DirectoryIoFailed({ path, op: "create", cause }),
  });

const remove = (path: string): Effect.Effect<void, DirectoryIoFailed, never> =>
  Effect.tryPromise({
    try: () => fs.rm(path, { recursive: true, force: true }),
    catch: (cause) => new DirectoryIoFailed({ path, op: "remove", cause }),
  });

export const DirectoryIoLive: Layer.Layer<DirectoryIo, never, never> = Layer.succeed(DirectoryIo, { create, remove });
