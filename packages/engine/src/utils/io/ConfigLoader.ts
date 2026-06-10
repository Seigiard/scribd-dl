import { Context, Layer } from "effect";

export interface ConfigData {
  readonly scribd: { readonly rendertime: number };
  readonly directory: { readonly output: string; readonly filename: string };
}

export class ConfigLoader extends Context.Tag("ConfigLoader")<ConfigLoader, ConfigData>() {}

export const DEFAULT_CONFIG: ConfigData = {
  scribd: { rendertime: 100 },
  directory: { output: "output", filename: "title" },
};

export const makeConfigLoader = (config: ConfigData): Layer.Layer<ConfigLoader, never, never> => Layer.succeed(ConfigLoader, config);
