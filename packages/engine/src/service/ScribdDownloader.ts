import { Context, Effect, Layer } from "effect";
import type { Page } from "puppeteer";
import sanitize from "sanitize-filename";
import { ConfigLoader } from "../utils/io/ConfigLoader";
import { DirectoryIo } from "../utils/io/DirectoryIo";
import { PdfGenerator } from "../utils/io/PdfGenerator";
import { resolvePdfPath } from "../utils/io/pdfPath";
import { PuppeteerSg } from "../utils/request/PuppeteerSg";
import { TitleResolver } from "../utils/request/TitleResolver";
import { PageProcessFailed, PdfGenerationFailed, UnsupportedUrl } from "../errors/DomainErrors";
import type { PageDimensions } from "../types/PageDimensions";
import type { DocumentMeta } from "../types/DocumentMeta";
import * as scribdRegex from "../const/ScribdRegex";
import type { OnEvent, Scraper, ScraperError } from "./Scraper";

export type { OnEvent, ScraperError as ScribdError } from "./Scraper";

export interface ScribdDownloaderService extends Scraper {
  readonly id: "scribd";
}

export class ScribdDownloader extends Context.Tag("ScribdDownloader")<ScribdDownloader, ScribdDownloaderService>() {}

interface PageGroup {
  readonly ids: ReadonlyArray<string>;
  readonly width: number;
  readonly height: number;
}

const resolveEmbedUrl = (url: string): Effect.Effect<string, UnsupportedUrl, never> => {
  const documentMatch = scribdRegex.DOCUMENT.exec(url);
  if (documentMatch) {
    return Effect.succeed(`https://www.scribd.com/embeds/${documentMatch[2]}/content`);
  }
  if (scribdRegex.EMBED.test(url)) {
    return Effect.succeed(url);
  }
  return Effect.fail(new UnsupportedUrl({ url }));
};

const extractId = (embedUrl: string): Effect.Effect<string, UnsupportedUrl, never> => {
  const match = scribdRegex.EMBED.exec(embedUrl);
  if (!match) {
    return Effect.fail(new UnsupportedUrl({ url: embedUrl }));
  }
  return Effect.succeed(match[1]!);
};

const processPage = (
  page: Page,
  url: string,
  rendertime: number,
): Effect.Effect<{ readonly pages: ReadonlyArray<PageDimensions> }, PageProcessFailed, never> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(async (rendertime: number) => {
        // eslint-disable-next-line no-undef
        const win = window as unknown as {
          __helpers__: {
            removeSelectorAll: (selector: string) => void;
            lazyLoad: (selector: string, rendertime: number) => Promise<void>;
            removeMarginSelectorAll: (selector: string) => void;
          };
        };
        ["div.customOptInDialog", "div[aria-label='Cookie Consent Banner']"].forEach((sel) => {
          win.__helpers__.removeSelectorAll(sel);
        });

        // eslint-disable-next-line no-undef
        const style = document.createElement("style");
        style.innerHTML = `
                html, body, div.document_scroller {
                    background: transparent;
                    background-color: transparent;
                }

                .text_layer, .text_layer span, .text_layer div, .text_layer p {
                    opacity: 1 !important;
                    text-shadow: none !important;
                    color: #000000 !important;
                    -webkit-font-smoothing: antialiased !important;
                }
            `;
        // eslint-disable-next-line no-undef
        document.head.appendChild(style);

        await win.__helpers__.lazyLoad("div.document_scroller", rendertime);

        win.__helpers__.removeMarginSelectorAll("div.outer_page_container div[id^='outer_page_']");

        const pages: Array<{ id: string; width: number; height: number }> = [];
        // eslint-disable-next-line no-undef
        document.querySelectorAll("div.outer_page_container div[id^='outer_page_']").forEach((dom) => {
          // eslint-disable-next-line no-undef
          const computed = getComputedStyle(dom);
          pages.push({
            id: (dom as HTMLElement).id,
            width: parseInt(computed.width),
            height: parseInt(computed.height),
          });
        });
        // eslint-disable-next-line no-undef
        const container = document.querySelector("div.outer_page_container");
        if (container) {
          // eslint-disable-next-line no-undef
          document.body.innerHTML = container.innerHTML;
        }
        return { pages };
      }, rendertime),
    catch: (cause) => new PageProcessFailed({ url, cause }),
  });

const groupPagesByDimensions = (pages: ReadonlyArray<PageDimensions>): Effect.Effect<ReadonlyArray<PageGroup>, never, never> =>
  Effect.sync(() => {
    const groups: PageGroup[] = [];
    if (pages.length === 0) {
      return groups;
    }
    let ids: string[] = [pages[0]!.id];
    for (let i = 1; i < pages.length; i++) {
      const prev = pages[i - 1]!;
      const curr = pages[i]!;
      if (curr.width === prev.width && curr.height === prev.height) {
        ids.push(curr.id);
      } else {
        groups.push({ ids, width: prev.width, height: prev.height });
        ids = [curr.id];
      }
    }
    const last = pages[pages.length - 1]!;
    groups.push({ ids, width: last.width, height: last.height });
    return groups;
  });

const generatePDFs = (
  page: Page,
  groups: ReadonlyArray<PageGroup>,
  tempDir: string,
  puppeteerSg: Context.Tag.Service<PuppeteerSg>,
  onEvent: OnEvent,
): Effect.Effect<ReadonlyArray<string>, PageProcessFailed | PdfGenerationFailed, never> =>
  Effect.gen(function* () {
    const pdfPaths: string[] = [];
    yield* Effect.tryPromise({
      try: () =>
        page.evaluate(() => {
          // eslint-disable-next-line no-undef
          (window as unknown as { __helpers__: { hideSelectorAll: (s: string) => void } }).__helpers__.hideSelectorAll(
            "div[id^='outer_page_']",
          );
        }),
      catch: (cause) => new PageProcessFailed({ url: "", cause }),
    });
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const idsArr = [...group.ids];
      yield* Effect.tryPromise({
        try: () =>
          page.evaluate((ids: string[]) => {
            // eslint-disable-next-line no-undef
            (window as unknown as { __helpers__: { showSelectorAll: (s: string) => void } }).__helpers__.showSelectorAll(
              ids.map((id) => `div#${id}`).join(","),
            );
          }, idsArr),
        catch: (cause) => new PageProcessFailed({ url: "", cause }),
      });
      const pdfPath = `${tempDir}/${(i + 1).toString().padStart(5, "0")}.pdf`;
      yield* puppeteerSg.generatePDF(page, pdfPath, { width: group.width, height: group.height });
      pdfPaths.push(pdfPath);
      yield* Effect.tryPromise({
        try: () =>
          page.evaluate((ids: string[]) => {
            // eslint-disable-next-line no-undef
            (window as unknown as { __helpers__: { removeSelectorAll: (s: string) => void } }).__helpers__.removeSelectorAll(
              ids.map((id) => `div#${id}`).join(","),
            );
          }, idsArr),
        catch: (cause) => new PageProcessFailed({ url: "", cause }),
      });
      yield* onEvent({ _tag: "RenderProgress", done: i + 1, total: groups.length });
    }
    return pdfPaths;
  });

const allSameDimensions = (pages: ReadonlyArray<PageDimensions>): boolean => {
  if (pages.length === 0) return true;
  const first = pages[0]!;
  return pages.every((p) => p.width === first.width && p.height === first.height);
};

export const ScribdDownloaderLive: Layer.Layer<
  ScribdDownloader,
  never,
  PuppeteerSg | PdfGenerator | ConfigLoader | DirectoryIo | TitleResolver
> = Layer.effect(
  ScribdDownloader,
  Effect.gen(function* () {
    const puppeteerSg = yield* PuppeteerSg;
    const pdfGenerator = yield* PdfGenerator;
    const config = yield* ConfigLoader;
    const directoryIo = yield* DirectoryIo;
    const titleResolver = yield* TitleResolver;

    const canHandle = (url: string): boolean => scribdRegex.DOMAIN.test(url);

    const execute = (url: string, folder: string, onEvent: OnEvent, debug?: boolean): Effect.Effect<void, ScraperError, never> =>
      Effect.scoped(
        Effect.gen(function* () {
          const embedUrl = yield* resolveEmbedUrl(url);
          const id = yield* extractId(embedUrl);

          const titleEff = config.directory.filename === "title" ? titleResolver.resolve(url, id) : Effect.succeed(id);
          const pageEff = Effect.acquireRelease(puppeteerSg.getPage(embedUrl), (p) => Effect.promise(() => p.close()));

          const [title, page] = yield* Effect.all([titleEff, pageEff], { concurrency: "unbounded" });

          const { pages } = yield* processPage(page, embedUrl, config.scribd.rendertime);
          const meta: DocumentMeta = { title, id, pages };

          yield* onEvent({ _tag: "TitleResolved", title: meta.title });
          yield* onEvent({ _tag: "ScrapeProgress", done: meta.pages.length, total: meta.pages.length });

          const identifier = sanitize(meta.title);
          const safeIdentifier = identifier === "" ? id : identifier;
          yield* directoryIo.create(folder);
          const pdfPath = resolvePdfPath({ folder, displayTitle: meta.title, fallbackId: id });

          if (debug === true) {
            yield* Effect.tryPromise({
              try: async () => {
                const html = await page.content();
                await Bun.write(`${folder}/${safeIdentifier}.debug.html`, html);
              },
              catch: (cause) => new PageProcessFailed({ url: embedUrl, cause }),
            });
          }

          if (allSameDimensions(meta.pages)) {
            const dims = meta.pages[0];
            if (dims) {
              yield* puppeteerSg.generatePDF(page, pdfPath, { width: dims.width, height: dims.height });
            } else {
              yield* puppeteerSg.generatePDF(page, pdfPath);
            }
            yield* onEvent({ _tag: "RenderProgress", done: 1, total: 1 });
          } else {
            const tempDir = `${folder}/${safeIdentifier}_temp`;
            yield* directoryIo.create(tempDir);
            const groups = yield* groupPagesByDimensions(meta.pages);
            const pdfPaths = yield* generatePDFs(page, groups, tempDir, puppeteerSg, onEvent);
            yield* pdfGenerator.merge(pdfPaths, pdfPath);
            if (debug !== true) {
              yield* directoryIo.remove(tempDir);
            }
          }
        }),
      );

    return ScribdDownloader.of({ id: "scribd", canHandle, execute });
  }),
);
