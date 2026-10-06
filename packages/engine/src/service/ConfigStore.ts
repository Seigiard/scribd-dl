import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { PersistenceFailed } from "../errors/DomainErrors";
import { ConfigLoaderTag, type ConfigLoader } from "../utils/io/ConfigLoader";
import { expandHome } from "../utils/io/path";

export interface Settings {
  readonly outputFolder: string;
  readonly ilovepdfPublicKey: string;
  readonly ilovepdfSecretKey: string;
  readonly ilovepdfKeysValid: boolean;
}

export interface ConfigStoreService {
  readonly read: Effect.Effect<Settings, never, never>;
  readonly write: (settings: Settings) => Effect.Effect<void, PersistenceFailed, never>;
}

export class ConfigStore extends Context.Tag("ConfigStore")<ConfigStore, ConfigStoreService>() {}

export const ConfigStoreTag: Context.Tag<ConfigStore, ConfigStoreService> = ConfigStore;

const SETTINGS_FILENAME = "settings.json";

export const defaultBaseDir = (): string => path.join(os.homedir(), ".config", "scribd-dl");

const StoredSettings = Schema.Struct({
  outputFolder: Schema.String,
  ilovepdfPublicKey: Schema.optional(Schema.Unknown),
  ilovepdfSecretKey: Schema.optional(Schema.Unknown),
  ilovepdfKeysValid: Schema.optional(Schema.Unknown),
});

const parseSettings = (raw: string): Settings | null => {
  try {
    const parsed = Schema.decodeUnknownSync(Schema.parseJson(StoredSettings))(raw);

    return {
      outputFolder: expandHome(parsed.outputFolder),
      // Invalid optional credentials must not discard a valid output folder.
      ilovepdfPublicKey: Option.getOrElse(
        Schema.decodeUnknownOption(Schema.String)(parsed.ilovepdfPublicKey),
        () => "",
      ),
      ilovepdfSecretKey: Option.getOrElse(
        Schema.decodeUnknownOption(Schema.String)(parsed.ilovepdfSecretKey),
        () => "",
      ),
      ilovepdfKeysValid: Option.getOrElse(
        Schema.decodeUnknownOption(Schema.Boolean)(parsed.ilovepdfKeysValid),
        () => false,
      ),
    };
  } catch {
    return null;
  }
};

export type ConfigStoreIo = Pick<typeof fs, "mkdir" | "writeFile" | "rename" | "chmod">;

export const makeConfigStore = (
  baseDir: string,
  io: ConfigStoreIo = fs,
): Layer.Layer<ConfigStore, never, ConfigLoader> =>
  Layer.effect(
    ConfigStore,
    Effect.gen(function* () {
      const defaults = yield* ConfigLoaderTag;
      const filePath = path.join(baseDir, SETTINGS_FILENAME);
      const tmpPath = `${filePath}.tmp`;
      const writeLock = yield* Effect.makeSemaphore(1);

      const fallback = (): Settings => ({
        outputFolder: defaults.directory.output,
        ilovepdfPublicKey: "",
        ilovepdfSecretKey: "",
        ilovepdfKeysValid: false,
      });

      const read: Effect.Effect<Settings, never, never> = Effect.sync(() => {
        try {
          const raw = fsSync.readFileSync(filePath, "utf8");
          const parsed = parseSettings(raw);

          if (!parsed) {
            console.warn(
              `[ConfigStore] ${filePath} malformed or missing outputFolder; using defaults`,
            );

            return fallback();
          }

          return parsed;
        } catch (cause) {
          const err = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }))(cause);

          if (Option.isNone(err) || err.value.code !== "ENOENT") {
            console.warn(`[ConfigStore] failed to read ${filePath}; using defaults`, cause);
          }

          return fallback();
        }
      });

      const performWrite = (settings: Settings): Effect.Effect<void, PersistenceFailed, never> =>
        Effect.tryPromise({
          try: async () => {
            await io.mkdir(baseDir, { recursive: true });

            const body = `${JSON.stringify(
              {
                outputFolder: settings.outputFolder,
                ilovepdfPublicKey: settings.ilovepdfPublicKey,
                ilovepdfSecretKey: settings.ilovepdfSecretKey,
                ilovepdfKeysValid: settings.ilovepdfKeysValid,
              },
              null,
              2,
            )}\n`;

            // File holds the iLovePDF secret key — keep it owner-only (0o600).
            await io.writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
            await io.rename(tmpPath, filePath);
            await io.chmod(filePath, 0o600);
          },
          catch: (cause) => new PersistenceFailed({ path: filePath, op: "write", cause }),
        });

      const write = (settings: Settings): Effect.Effect<void, PersistenceFailed, never> =>
        writeLock.withPermits(1)(Effect.uninterruptible(performWrite(settings)));

      return { read, write };
    }),
  );

export const ConfigStoreLive: Layer.Layer<ConfigStore, never, ConfigLoader> =
  makeConfigStore(defaultBaseDir());
