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

const SLIDESHOW_NEXT_SELECTOR = ".right_arrow[aria-label='Next page']";
const SLIDESHOW_PAGE_CAP = 500;
const SLIDESHOW_IMG_TIMEOUT_MS = 15_000;
const SLIDESHOW_CLICK_TIMEOUT_MS = 5_000;

const detectSlideshow = (page: Page, url: string): Effect.Effect<boolean, PageProcessFailed, never> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate((selector: string) => {
        // eslint-disable-next-line no-undef
        return !!document.querySelector(selector);
      }, SLIDESHOW_NEXT_SELECTOR),
    catch: (cause) => new PageProcessFailed({ url, cause }),
  });

interface VisiblePageInfo {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

const getVisibleSlidePage = (page: Page, url: string): Effect.Effect<VisiblePageInfo | null, PageProcessFailed, never> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(() => {
        // eslint-disable-next-line no-undef
        const nodes = document.querySelectorAll("div.outer_page_container .newpage");
        for (const node of Array.from(nodes)) {
          const el = node as HTMLElement;
          // eslint-disable-next-line no-undef
          if (getComputedStyle(el).display === "none") continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          return { id: el.id, width: Math.round(rect.width), height: Math.round(rect.height) };
        }
        return null;
      }),
    catch: (cause) => new PageProcessFailed({ url, cause }),
  });

const waitVisibleSlideImage = (page: Page, url: string, pageId: string, timeoutMs: number): Effect.Effect<void, PageProcessFailed, never> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(
        async (id: string, deadline: number) =>
          new Promise<void>((resolve) => {
            const tick = () => {
              // eslint-disable-next-line no-undef
              const el = document.getElementById(id);
              if (!el) return resolve();
              const imgs = Array.from(el.querySelectorAll("img")) as Array<HTMLImageElement>;
              if (imgs.length === 0) {
                // Some pages legitimately have no images (pure text); accept after a short grace.
                if (Date.now() >= deadline) return resolve();
                // eslint-disable-next-line no-undef
                setTimeout(tick, 150);
                return;
              }
              const done = imgs.every((i) => i.src && i.src.length > 0 && i.complete && i.naturalWidth > 0);
              if (done) return resolve();
              if (Date.now() >= deadline) return resolve();
              // eslint-disable-next-line no-undef
              setTimeout(tick, 100);
            };
            tick();
          }),
        pageId,
        Date.now() + timeoutMs,
      ),
    catch: (cause) => new PageProcessFailed({ url, cause }),
  });

type ClickNextOutcome = "changed" | "disabled" | "no-next" | "no-change";

const clickNextAndWait = (
  page: Page,
  url: string,
  prevId: string,
  timeoutMs: number,
): Effect.Effect<ClickNextOutcome, PageProcessFailed, never> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(
        async (selector: string, prev: string, deadline: number): Promise<ClickNextOutcome> => {
          // eslint-disable-next-line no-undef
          const next = document.querySelector(selector) as HTMLElement | null;
          if (!next) return "no-next";
          if (next.getAttribute("aria-disabled") === "true" || next.classList.contains("disabled")) {
            return "disabled";
          }
          next.click();
          return new Promise<ClickNextOutcome>((resolve) => {
            const tick = () => {
              // eslint-disable-next-line no-undef
              const nodes = document.querySelectorAll("div.outer_page_container .newpage");
              for (const node of Array.from(nodes)) {
                const el = node as HTMLElement;
                // eslint-disable-next-line no-undef
                if (getComputedStyle(el).display === "none") continue;
                if (el.id !== prev) return resolve("changed");
              }
              if (Date.now() >= deadline) return resolve("no-change");
              // eslint-disable-next-line no-undef
              setTimeout(tick, 50);
            };
            tick();
          });
        },
        SLIDESHOW_NEXT_SELECTOR,
        prevId,
        Date.now() + timeoutMs,
      ),
    catch: (cause) => new PageProcessFailed({ url, cause }),
  });

interface RunSlideshowArgs {
  readonly page: Page;
  readonly embedUrl: string;
  readonly folder: string;
  readonly safeIdentifier: string;
  readonly pdfPath: string;
  readonly onEvent: OnEvent;
  readonly debug: boolean;
  readonly puppeteerSg: Context.Tag.Service<PuppeteerSg>;
  readonly pdfGenerator: Context.Tag.Service<PdfGenerator>;
  readonly directoryIo: Context.Tag.Service<DirectoryIo>;
}

const maskSlideshowChrome = (page: Page, url: string): Effect.Effect<void, PageProcessFailed, never> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(() => {
        // Drop pre-rendered consent overlays so they don't reappear; the CSS
        // below pins them off if Scribd re-injects later.
        // eslint-disable-next-line no-undef
        document
          .querySelectorAll(
            "div.customOptInDialog,div[aria-label='Cookie Consent Banner'],.osano-cm-window,.osano-cm-dialog,.osano-cm-info-dialog",
          )
          .forEach((el) => el.remove());

        // visibility:hidden on every body descendant + visible on the page-content
        // subtree leaves only the slide visible to page.pdf. Layout space is
        // preserved (no DOM mutation, no broken Scribd navigation state).
        // element.click() on the Next button still works because synthetic
        // clicks don't check visibility.
        // eslint-disable-next-line no-undef
        const style = document.createElement("style");
        style.id = "scribd-dl-slideshow-mask";
        style.textContent = `
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          body { width: min-content; height: min-content;}
          body * { visibility: hidden !important; }
          body *:not(.not_visible, .center_tools, .outer_page *) { display: contents!important; }
          .outer_page *, .newpage, .newpage * { visibility: visible !important; }
          .outer_page { width:auto!important; height:auto!important }
          .newpage { transform: none!important; position:fixed!important; }
        `;
        // eslint-disable-next-line no-undef
        document.head.appendChild(style);
      }),
    catch: (cause) => new PageProcessFailed({ url, cause }),
  });

const runSlideshow = ({
  page,
  embedUrl,
  folder,
  safeIdentifier,
  pdfPath,
  onEvent,
  debug,
  puppeteerSg,
  pdfGenerator,
  directoryIo,
}: RunSlideshowArgs): Effect.Effect<void, PageProcessFailed | PdfGenerationFailed, never> =>
  Effect.gen(function* () {
    const tempDir = `${folder}/${safeIdentifier}_temp`;
    yield* directoryIo.create(tempDir);

    yield* maskSlideshowChrome(page, embedUrl);

    if (debug) {
      yield* Effect.promise(async () => {
        try {
          const html = await page.content();
          await Bun.write(`${folder}/${safeIdentifier}.debug.html`, html);
        } catch (cause) {
          console.warn(`[debug] HTML dump failed for ${embedUrl}:`, cause);
        }
      });
    }

    const pdfPaths: string[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < SLIDESHOW_PAGE_CAP; i++) {
      const visible = yield* getVisibleSlidePage(page, embedUrl);
      if (!visible) break;
      if (seenIds.has(visible.id)) break;
      seenIds.add(visible.id);

      yield* waitVisibleSlideImage(page, embedUrl, visible.id, SLIDESHOW_IMG_TIMEOUT_MS);

      const slidePath = `${tempDir}/${(i + 1).toString().padStart(5, "0")}.pdf`;
      yield* puppeteerSg.generatePDF(page, slidePath, { width: visible.width, height: visible.height });
      pdfPaths.push(slidePath);

      yield* onEvent({ _tag: "ScrapeProgress", done: i + 1, total: i + 1 });
      yield* onEvent({ _tag: "RenderProgress", done: i + 1, total: i + 1 });

      const outcome = yield* clickNextAndWait(page, embedUrl, visible.id, SLIDESHOW_CLICK_TIMEOUT_MS);
      if (outcome !== "changed") break;
    }

    if (pdfPaths.length === 0) {
      return yield* Effect.fail(new PageProcessFailed({ url: embedUrl, cause: "slideshow click loop produced 0 pages" }));
    }

    yield* pdfGenerator.merge(pdfPaths, pdfPath);
    if (!debug) {
      yield* directoryIo.remove(tempDir);
    }
  });

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

    const deriveDisplayTitle = (url: string): string => {
      const doc = scribdRegex.DOCUMENT.exec(url);
      if (doc) return `Scribd document ${doc[2]}`;
      const embed = scribdRegex.EMBED.exec(url);
      if (embed) return `Scribd document ${embed[1]}`;
      return "Scribd document";
    };

    const execute = (url: string, folder: string, onEvent: OnEvent, debug?: boolean): Effect.Effect<void, ScraperError, never> =>
      Effect.scoped(
        Effect.gen(function* () {
          const embedUrl = yield* resolveEmbedUrl(url);
          const id = yield* extractId(embedUrl);

          const titleEff = config.directory.filename === "title" ? titleResolver.resolve(url, id) : Effect.succeed(id);
          const pageEff = Effect.acquireRelease(puppeteerSg.getPage(embedUrl), (p) => Effect.promise(() => p.close()));

          const [title, page] = yield* Effect.all([titleEff, pageEff], { concurrency: "unbounded" });

          yield* onEvent({ _tag: "TitleResolved", title });

          const identifier = sanitize(title);
          const safeIdentifier = identifier === "" ? id : identifier;
          yield* directoryIo.create(folder);
          const pdfPath = resolvePdfPath({ folder, displayTitle: title, fallbackId: id });

          const isSlideshow = yield* detectSlideshow(page, embedUrl);

          if (isSlideshow) {
            yield* runSlideshow({
              page,
              embedUrl,
              folder,
              safeIdentifier,
              pdfPath,
              onEvent,
              debug: debug === true,
              puppeteerSg,
              pdfGenerator,
              directoryIo,
            });
            return;
          }

          // Scrollable embed — existing flow.
          const { pages } = yield* processPage(page, embedUrl, config.scribd.rendertime);
          const meta: DocumentMeta = { title, id, pages };

          yield* onEvent({ _tag: "ScrapeProgress", done: meta.pages.length, total: meta.pages.length });

          if (debug === true) {
            // Debug-only side-effect — must not fail the scrape if the dump can't be written.
            yield* Effect.promise(async () => {
              try {
                const html = await page.content();
                await Bun.write(`${folder}/${safeIdentifier}.debug.html`, html);
              } catch (cause) {
                console.warn(`[debug] HTML dump failed for ${embedUrl}:`, cause);
              }
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

    return ScribdDownloader.of({ id: "scribd", canHandle, deriveDisplayTitle, execute });
  }),
);
