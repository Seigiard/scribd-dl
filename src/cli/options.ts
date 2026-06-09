import { Options } from "@effect/cli";
import { DEFAULT_CONFIG } from "../utils/io/ConfigLoader";

export const outputOpt = Options.text("output").pipe(
  Options.withAlias("o"),
  Options.withDescription(`Output directory (default: "${DEFAULT_CONFIG.directory.output}").`),
  Options.withDefault(DEFAULT_CONFIG.directory.output),
);

export const filenameOpt = Options.text("filename").pipe(
  Options.withDescription(
    `Filename mode: "title" (use document title) or any other value to fall back to document id (default: "${DEFAULT_CONFIG.directory.filename}").`,
  ),
  Options.withDefault(DEFAULT_CONFIG.directory.filename),
);

export const rendertimeOpt = Options.integer("rendertime").pipe(
  Options.withDescription(`Scribd lazy-load render time in ms before extracting pages (default: ${DEFAULT_CONFIG.scribd.rendertime}).`),
  Options.withDefault(DEFAULT_CONFIG.scribd.rendertime),
);
