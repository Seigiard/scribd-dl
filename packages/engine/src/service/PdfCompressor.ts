import { Context, Effect, Layer, Option, Schema } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import ILovePDFApi from "@ilovepdf/ilovepdf-nodejs";
import ILovePDFFile from "@ilovepdf/ilovepdf-nodejs/ILovePDFFile";
import { CompressionFailed } from "../errors/DomainErrors";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const; // "%PDF"

export interface CompressionKeys {
  readonly publicKey: string;
  readonly secretKey: string;
}

// Only completion matters for these commands; the adapter consumes provider responses.
interface CompressTaskLike {
  // start() populates this getter from remaining_files; quota is only
  // decremented at process(), so reading it after start() is a free pre-flight check.
  readonly remainingFiles?: number | undefined;
  start(): Promise<void>;
  addFile(file: ILovePDFFile): Promise<void>;
  process(params: { compression_level: "low" }): Promise<void>;
  download(): Promise<Uint8Array>;
}

interface ILovePDFApiLike {
  newTask(tool: "compress"): CompressTaskLike;
}

export type ApiFactory = (publicKey: string, secretKey: string) => ILovePDFApiLike;

export type FileFactory = (absolutePath: string) => ILovePDFFile;

export interface PdfCompressorService {
  readonly compress: (
    pdfPath: string,
    keys: CompressionKeys,
  ) => Effect.Effect<void, CompressionFailed, never>;
  readonly validate: (keys: CompressionKeys) => Effect.Effect<boolean, never, never>;
}

export class PdfCompressor extends Context.Tag("PdfCompressor")<
  PdfCompressor,
  PdfCompressorService
>() {}

export const PdfCompressorTag: Context.Tag<PdfCompressor, PdfCompressorService> = PdfCompressor;

class InvalidResponseError extends Error {
  constructor() {
    super("invalid response from compressor");
    this.name = "InvalidResponseError";
  }
}

class QuotaExhaustedError extends Error {
  constructor() {
    super("quota exceeded");
    this.name = "QuotaExhaustedError";
  }
}

const isPdfBytes = (bytes: Uint8Array): boolean =>
  bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((b, i) => bytes[i] === b);

const ProviderFailure = Schema.Struct({
  message: Schema.optionalWith(Schema.String, { default: () => "" }),
  response: Schema.optional(Schema.Struct({ status: Schema.Number })),
});

// Maps a raw failure to a fixed, sanitized user-facing reason plus a scrubbed cause.
// Never surfaces raw library text (which could carry provider internals) and never
// retains the raw AxiosError (whose headers carry the bearer token).
const classifyFailure = (cause: Error, status: number | undefined) => {
  const scrubbed = { message: cause.message, status };

  if (cause instanceof InvalidResponseError)
    return { reason: "invalid response from compressor", cause: scrubbed };

  if (cause instanceof QuotaExhaustedError) return { reason: "quota exceeded", cause: scrubbed };

  if (status === 401) return { reason: "invalid credentials", cause: scrubbed };

  if (status === 402 || status === 429) return { reason: "quota exceeded", cause: scrubbed };

  if (status === undefined) {
    // No HTTP response: either a network error, or a local JWT-signing throw from a
    // malformed secret key (KTD5) — the latter is a credentials problem, not network.
    if (/jwt|sign|token/i.test(scrubbed.message))
      return { reason: "invalid credentials", cause: scrubbed };

    return { reason: "network error", cause: scrubbed };
  }

  return { reason: "compression failed", cause: scrubbed };
};

export const makePdfCompressor = (
  makeApi: ApiFactory,
  makeFile: FileFactory,
  io: Pick<typeof fs, "writeFile" | "rename"> = fs,
): Layer.Layer<PdfCompressor, never, never> =>
  Layer.succeed(PdfCompressor, {
    compress: (pdfPath, keys) => {
      const absPath = path.resolve(pdfPath);

      const attempt = <A>(operation: () => Promise<A>) =>
        Effect.tryPromise({
          try: operation,
          catch: (cause) => cause,
        });

      return Effect.gen(function* () {
        const task = yield* attempt(async () =>
          makeApi(keys.publicKey, keys.secretKey).newTask("compress"),
        );

        yield* attempt(() => task.start());

        // Pre-flight: start() reports the account's remaining allowance without
        // consuming it. Bail before uploading if the monthly quota is spent.
        yield* attempt(async () => {
          if (task.remainingFiles !== undefined && task.remainingFiles <= 0) {
            throw new QuotaExhaustedError();
          }
        });

        yield* attempt(() => task.addFile(makeFile(absPath)));
        yield* attempt(() => task.process({ compression_level: "low" }));
        const bytes = yield* attempt(() => task.download());

        if (!isPdfBytes(bytes)) return yield* Effect.fail(new InvalidResponseError());
        // Atomic write: tmp + rename so a partial write, crash, or bad 200 never
        // corrupts the original (KTD8). The source bytes are already in memory
        // (ILovePDFFile reads them at construction), so the rename is safe.
        // Interruption must wait for a started transaction before another job uses this path.
        yield* Effect.uninterruptible(
          attempt(async () => {
            const tmpPath = `${absPath}.tmp`;
            await io.writeFile(tmpPath, bytes);
            await io.rename(tmpPath, absPath);
          }),
        );
      }).pipe(
        Effect.mapError((cause) => {
          const decoded = Schema.decodeUnknownOption(ProviderFailure)(cause);
          const status = Option.isSome(decoded) ? decoded.value.response?.status : undefined;

          const error =
            cause instanceof Error
              ? cause
              : new Error(Option.isSome(decoded) ? decoded.value.message : "");

          const { reason, cause: scrubbed } = classifyFailure(error, status);

          return new CompressionFailed({ path: absPath, reason, cause: scrubbed });
        }),
      );
    },
    validate: (keys) =>
      Effect.tryPromise(async () => {
        const api = makeApi(keys.publicKey, keys.secretKey);
        await api.newTask("compress").start();
      }).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
      ),
  });

const liveApiFactory: ApiFactory = (publicKey, secretKey) => {
  const api = new ILovePDFApi(publicKey, secretKey);

  return {
    newTask: (tool) => {
      const task = api.newTask(tool);

      return {
        get remainingFiles() {
          return task.remainingFiles;
        },
        start: async () => {
          await task.start();
        },
        addFile: async (file) => {
          await task.addFile(file);
        },
        process: async (params) => {
          await task.process(params);
        },
        download: () => task.download(),
      };
    },
  };
};

const liveFileFactory: FileFactory = (absolutePath) => new ILovePDFFile(absolutePath);

export const PdfCompressorLive: Layer.Layer<PdfCompressor, never, never> = makePdfCompressor(
  liveApiFactory,
  liveFileFactory,
);
