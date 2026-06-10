import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Context, Effect, Layer } from "effect";
import { PersistenceFailed } from "../errors/DomainErrors";
import { ConfigLoader } from "../utils/io/ConfigLoader";
import { expandHome } from "../utils/io/path";

export interface Settings {
  readonly outputFolder: string;
}

export interface ConfigStoreService {
  readonly read: Effect.Effect<Settings, never, never>;
  readonly write: (settings: Settings) => Effect.Effect<void, PersistenceFailed, never>;
}

export class ConfigStore extends Context.Tag("ConfigStore")<ConfigStore, ConfigStoreService>() {}

const SETTINGS_FILENAME = "settings.json";

export const defaultBaseDir = (): string => path.join(os.homedir(), ".config", "scribd-dl");

const parseSettings = (raw: string): Settings | null => {
  try {
    const parsed = JSON.parse(raw) as { outputFolder?: unknown };
    if (typeof parsed.outputFolder !== "string") return null;
    return { outputFolder: expandHome(parsed.outputFolder) };
  } catch {
    return null;
  }
};

export const makeConfigStore = (baseDir: string): Layer.Layer<ConfigStore, never, ConfigLoader> =>
  Layer.effect(
    ConfigStore,
    Effect.gen(function* () {
      const defaults = yield* ConfigLoader;
      const filePath = path.join(baseDir, SETTINGS_FILENAME);
      const tmpPath = `${filePath}.tmp`;

      const fallback = (): Settings => ({ outputFolder: defaults.directory.output });

      const read: Effect.Effect<Settings, never, never> = Effect.sync(() => {
        try {
          const raw = fsSync.readFileSync(filePath, "utf8");
          const parsed = parseSettings(raw);
          if (!parsed) {
            console.warn(`[ConfigStore] ${filePath} malformed or missing outputFolder; using defaults`);
            return fallback();
          }
          return parsed;
        } catch (cause) {
          const err = cause as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") {
            console.warn(`[ConfigStore] failed to read ${filePath} (${err.code}); using defaults`);
          }
          return fallback();
        }
      });

      const write = (settings: Settings): Effect.Effect<void, PersistenceFailed, never> =>
        Effect.tryPromise({
          try: async () => {
            await fs.mkdir(baseDir, { recursive: true });
            const body = `${JSON.stringify({ outputFolder: settings.outputFolder }, null, 2)}\n`;
            await fs.writeFile(tmpPath, body, "utf8");
            await fs.rename(tmpPath, filePath);
          },
          catch: (cause) => new PersistenceFailed({ path: filePath, op: "write", cause }),
        });

      return { read, write };
    }),
  );

export const ConfigStoreLive: Layer.Layer<ConfigStore, never, ConfigLoader> = makeConfigStore(defaultBaseDir());
