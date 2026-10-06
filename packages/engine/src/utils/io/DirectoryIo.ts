import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import { DirectoryIoFailed } from "../../errors/DomainErrors";

export interface DirectoryIoService {
  readonly create: (path: string) => Effect.Effect<void, DirectoryIoFailed, never>;
  readonly remove: (path: string) => Effect.Effect<void, DirectoryIoFailed, never>;
}

export class DirectoryIo extends Context.Tag("DirectoryIo")<DirectoryIo, DirectoryIoService>() {}

export const DirectoryIoTag: Context.Tag<DirectoryIo, DirectoryIoService> = DirectoryIo;

interface DirectoryOperations {
  readonly mkdir: (path: string) => Promise<string | undefined>;
  readonly rm: (path: string) => Promise<void>;
}

export const makeDirectoryIo = (
  io: DirectoryOperations = {
    mkdir: (path) => fs.mkdir(path, { recursive: true }),
    rm: (path) => fs.rm(path, { recursive: true, force: true }),
  },
): DirectoryIoService => ({
  // Filesystem promises cannot be canceled; wait for IO before callers can reuse the path.
  create: (path) =>
    Effect.tryPromise({
      try: async () => {
        await io.mkdir(path);
      },
      catch: (cause) => new DirectoryIoFailed({ path, op: "create", cause }),
    }).pipe(Effect.uninterruptible),
  remove: (path) =>
    Effect.tryPromise({
      try: () => io.rm(path),
      catch: (cause) => new DirectoryIoFailed({ path, op: "remove", cause }),
    }).pipe(Effect.uninterruptible),
});

export const DirectoryIoLive: Layer.Layer<DirectoryIo, never, never> = Layer.succeed(
  DirectoryIo,
  makeDirectoryIo(),
);
