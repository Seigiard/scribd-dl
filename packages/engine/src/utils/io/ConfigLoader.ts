import { Context, Layer } from "effect";

export interface ConfigData {
  readonly scribd: { readonly rendertime: number };
  readonly directory: { readonly output: string; readonly filename: string };
}

export class ConfigLoader extends Context.Service<ConfigLoader, ConfigData>()("ConfigLoader") {}

export const ConfigLoaderTag = ConfigLoader;

export const DEFAULT_CONFIG: ConfigData = {
  scribd: { rendertime: 100 },
  directory: { output: "output", filename: "title" },
};

export const makeConfigLoader = (config: ConfigData): Layer.Layer<ConfigLoader, never, never> => Layer.succeed(ConfigLoader, config);

export const ConfigLoaderLive = makeConfigLoader(DEFAULT_CONFIG);
