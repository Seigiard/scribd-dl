import { Options } from "@effect/cli";

export const portOpt = Options.integer("port").pipe(
  Options.withDescription("HTTP server port. 0 selects a random free port (default: 0)."),
  Options.withDefault(0),
);
