import { Args, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { makeScrapersLayer } from "./src/composition";
import { findScraperForUrl, Scrapers, type OnEvent } from "./src/service/Scraper";
import { DEFAULT_CONFIG } from "./src/utils/io/ConfigLoader";
import { makePuppeteerSgLive } from "./src/utils/request/PuppeteerSg";

const DEBUG_OUTPUT_FOLDER = DEFAULT_CONFIG.directory.output;

const urlArg = Args.text({ name: "url" }).pipe(Args.withDescription("Scraper URL to debug (e.g. Scribd document URL)."));

const logEvent: OnEvent = (event) =>
  Effect.sync(() => {
    if (event._tag === "TitleResolved") {
      console.log(`[TitleResolved] ${event.title}`);
    } else if (event._tag === "ScrapeProgress") {
      console.log(`[ScrapeProgress] ${event.done}/${event.total}`);
    } else {
      console.log(`[RenderProgress] ${event.done}/${event.total}`);
    }
  });

const buildDebugLayer = () => makeScrapersLayer(makePuppeteerSgLive({ headful: true }));

class NoScraperForUrl {
  readonly _tag = "NoScraperForUrl";
  constructor(readonly url: string) {}
}

const program = (url: string) =>
  Effect.gen(function* () {
    const scrapers = yield* Scrapers;
    const scraper = findScraperForUrl(scrapers, url);
    if (!scraper) {
      return yield* Effect.fail(new NoScraperForUrl(url));
    }
    console.log(`[debug] scraper=${scraper.id} url=${url} folder=${DEBUG_OUTPUT_FOLDER} rendertime=${DEFAULT_CONFIG.scribd.rendertime}ms`);
    yield* scraper.execute(url, DEBUG_OUTPUT_FOLDER, logEvent, true);
    console.log(`[debug] done. Artifacts in ${DEBUG_OUTPUT_FOLDER}/`);
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() =>
        error._tag === "NoScraperForUrl"
          ? console.error(`No scraper registered for URL: ${error.url}`)
          : console.error("[debug] failed:", error),
      ),
    ),
  );

const command = Command.make("scribd-dl-debug", { url: urlArg }, ({ url }) =>
  program(url).pipe(Effect.provide(buildDebugLayer()), Effect.scoped),
).pipe(Command.withDescription("Run a scraper in debug mode (headful browser, keep artifacts)."));

const cli = Command.run(command, {
  name: "Scribd Downloader Debug Runner",
  version: "1.0.0",
});

if (import.meta.main) {
  BunRuntime.runMain(cli(process.argv).pipe(Effect.provide(BunContext.layer)));
}
