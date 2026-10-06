import { Argument, Command } from "effect/cli";
import { BunServices, BunRuntime } from "@effect/platform-bun";
import { Data, Effect, Match, Predicate } from "effect";
import { ScrapersDebugLive } from "./src/composition";
import { findScraperForUrl, ScrapersTag, type OnEvent } from "./src/service/Scraper";
import { DEFAULT_CONFIG } from "./src/utils/io/ConfigLoader";

const DEBUG_OUTPUT_FOLDER = DEFAULT_CONFIG.directory.output;

const urlArg = Argument.String("url").pipe(Argument.withDescription("Scraper URL to debug (e.g. Scribd document URL)."));

const logEvent: OnEvent = (event) =>
  Effect.sync(() => {
    Match.value(event).pipe(
      Match.tag("TitleResolved", (e) => console.log(`[TitleResolved] ${e.title}`)),
      Match.tag("ScrapeProgress", (e) => console.log(`[ScrapeProgress] ${e.done}/${e.total}`)),
      Match.tag("RenderProgress", (e) => console.log(`[RenderProgress] ${e.done}/${e.total}`)),
      Match.exhaustive,
    );
  });

class NoScraperForUrl extends Data.TaggedError("NoScraperForUrl")<{ readonly url: string }> {}

const program = (url: string) =>
  Effect.gen(function* () {
    const scrapers = yield* ScrapersTag;
    const scraper = findScraperForUrl(scrapers, url);

    if (!scraper) {
      return yield* Effect.fail(new NoScraperForUrl({ url }));
    }

    console.log(`[debug] scraper=${scraper.id} url=${url} folder=${DEBUG_OUTPUT_FOLDER} rendertime=${DEFAULT_CONFIG.scribd.rendertime}ms`);
    yield* scraper.execute(url, DEBUG_OUTPUT_FOLDER, logEvent, true);
    console.log(`[debug] done. Artifacts in ${DEBUG_OUTPUT_FOLDER}/`);
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() =>
        Predicate.isTagged(error, "NoScraperForUrl")
          ? console.error(`No scraper registered for URL: ${error.url}`)
          : console.error("[debug] failed:", error),
      ),
    ),
  );

const command = Command.make("scribd-dl-debug", { url: urlArg }, ({ url }) =>
  program(url).pipe(Effect.provide(ScrapersDebugLive), Effect.scoped),
).pipe(Command.withDescription("Run a scraper in debug mode (headful browser, keep artifacts)."));

const cli = Command.run(command, {
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli.pipe(Effect.provide(BunServices.layer)));
}
