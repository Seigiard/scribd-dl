import { Flag } from "effect/cli";

export const portOpt = Flag.Int("port").pipe(
  Flag.withDescription("HTTP server port. 0 selects a random free port (default: 0)."),
  Flag.withDefault(0),
);
