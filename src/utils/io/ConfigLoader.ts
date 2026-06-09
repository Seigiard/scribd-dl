import { Context, Effect, Layer, Schema } from "effect";
import ini from "ini";
import { ConfigInvalid } from "../../errors/DomainErrors.js";

export interface ConfigData {
  readonly scribd: { readonly rendertime: number };
  readonly directory: { readonly output: string; readonly filename: string };
}

export class ConfigLoader extends Context.Tag("ConfigLoader")<ConfigLoader, ConfigData>() {}

const RawIniSchema = Schema.Struct({
  SCRIBD: Schema.Struct({ rendertime: Schema.NumberFromString }),
  DIRECTORY: Schema.Struct({ output: Schema.String, filename: Schema.String }),
});

const CONFIG_FILENAME = "config.ini";

// Single-source today; layered lookup added by Bun-exec U4.
const loadConfig: Effect.Effect<ConfigData, ConfigInvalid, never> = Effect.gen(function* () {
  const text = yield* Effect.tryPromise({
    try: () => Bun.file(CONFIG_FILENAME).text(),
    catch: (cause) => new ConfigInvalid({ cause }),
  });

  const parsed = yield* Effect.try({
    try: () => ini.parse(text),
    catch: (cause) => new ConfigInvalid({ cause }),
  });

  const decoded = yield* Effect.mapError(Schema.decodeUnknown(RawIniSchema)(parsed), (cause) => new ConfigInvalid({ cause }));

  return {
    scribd: { rendertime: decoded.SCRIBD.rendertime },
    directory: { output: decoded.DIRECTORY.output, filename: decoded.DIRECTORY.filename },
  };
});

export const ConfigLoaderLive: Layer.Layer<ConfigLoader, ConfigInvalid, never> = Layer.effect(ConfigLoader, loadConfig);
