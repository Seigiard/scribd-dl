import { Context, Effect, Layer } from "effect";
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

// Structural view of the iLovePDF compress task — avoids a brittle deep import of
// `@ilovepdf/ilovepdf-js-core/tasks/CompressTask` (KTD6).
interface CompressTaskLike {
  // start() returns { remaining_files } and populates this getter; quota is only
  // decremented at process(), so reading it after start() is a free pre-flight check.
  readonly remainingFiles?: number;
  start(): Promise<unknown>;
  addFile(file: unknown): Promise<unknown>;
  process(params: { compression_level: "low" }): Promise<unknown>;
  download(): Promise<Uint8Array>;
}

interface ILovePDFApiLike {
  newTask(tool: "compress"): CompressTaskLike;
}

export type ApiFactory = (publicKey: string, secretKey: string) => ILovePDFApiLike;
export type FileFactory = (absolutePath: string) => unknown;

export interface PdfCompressorService {
  readonly compress: (pdfPath: string, keys: CompressionKeys) => Effect.Effect<void, CompressionFailed, never>;
  readonly validate: (keys: CompressionKeys) => Effect.Effect<boolean, never, never>;
}

export class PdfCompressor extends Context.Tag("PdfCompressor")<PdfCompressor, PdfCompressorService>() {}

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

const isPdfBytes = (bytes: Uint8Array): boolean => bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((b, i) => bytes[i] === b);

const statusOf = (cause: unknown): number | undefined => {
  const status = (cause as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" ? status : undefined;
};

const messageOf = (cause: unknown): string => {
  const msg = (cause as { message?: unknown } | null)?.message;
  return typeof msg === "string" ? msg : "";
};

// Maps a raw failure to a fixed, sanitized user-facing reason plus a scrubbed cause.
// Never surfaces raw library text (which could carry provider internals) and never
// retains the raw AxiosError (whose headers carry the bearer token).
const classifyFailure = (cause: unknown): { reason: string; cause: { message: string; status: number | undefined } } => {
  const status = statusOf(cause);
  const scrubbed = { message: messageOf(cause), status };

  if (cause instanceof InvalidResponseError) return { reason: "invalid response from compressor", cause: scrubbed };
  if (cause instanceof QuotaExhaustedError) return { reason: "quota exceeded", cause: scrubbed };
  if (status === 401) return { reason: "invalid credentials", cause: scrubbed };
  if (status === 402 || status === 429) return { reason: "quota exceeded", cause: scrubbed };
  if (status === undefined) {
    // No HTTP response: either a network error, or a local JWT-signing throw from a
    // malformed secret key (KTD5) — the latter is a credentials problem, not network.
    if (/jwt|sign|token/i.test(scrubbed.message)) return { reason: "invalid credentials", cause: scrubbed };
    return { reason: "network error", cause: scrubbed };
  }
  return { reason: "compression failed", cause: scrubbed };
};

export const makePdfCompressor = (makeApi: ApiFactory, makeFile: FileFactory): Layer.Layer<PdfCompressor, never, never> =>
  Layer.succeed(PdfCompressor, {
    compress: (pdfPath, keys) => {
      const absPath = path.resolve(pdfPath);
      return Effect.tryPromise({
        try: async () => {
          const api = makeApi(keys.publicKey, keys.secretKey);
          const task = api.newTask("compress");
          await task.start();
          // Pre-flight: start() reports the account's remaining allowance without
          // consuming it. Bail before uploading if the monthly quota is spent.
          if (typeof task.remainingFiles === "number" && task.remainingFiles <= 0) {
            throw new QuotaExhaustedError();
          }
          await task.addFile(makeFile(absPath));
          await task.process({ compression_level: "low" });
          const bytes = await task.download();
          if (!isPdfBytes(bytes)) throw new InvalidResponseError();
          // Atomic write: tmp + rename so a partial write, crash, or bad 200 never
          // corrupts the original (KTD8). The source bytes are already in memory
          // (ILovePDFFile reads them at construction), so the rename is safe.
          const tmpPath = `${absPath}.tmp`;
          await fs.writeFile(tmpPath, bytes);
          await fs.rename(tmpPath, absPath);
        },
        catch: (cause) => {
          const { reason, cause: scrubbed } = classifyFailure(cause);
          return new CompressionFailed({ path: absPath, reason, cause: scrubbed });
        },
      });
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

const liveApiFactory: ApiFactory = (publicKey, secretKey) => new ILovePDFApi(publicKey, secretKey) as unknown as ILovePDFApiLike;
const liveFileFactory: FileFactory = (absolutePath) => new ILovePDFFile(absolutePath);

export const PdfCompressorLive: Layer.Layer<PdfCompressor, never, never> = makePdfCompressor(liveApiFactory, liveFileFactory);
