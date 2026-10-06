import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import puppeteer from "puppeteer";
import type { LaunchOptions, Page, PDFOptions } from "puppeteer";
import { BrowserLaunchFailed, PageLoadFailed, PdfGenerationFailed } from "../../errors/DomainErrors";

const PAGE_BUFFER_MS = 1000;

declare global {
  interface Window {
    __helpers__?: {
      removeSelectorAll: (selector: string) => void;
      lazyLoad: (selector: string, rendertime: number) => Promise<void>;
      removeMarginSelectorAll: (selector: string) => void;
      hideSelectorAll: (selector: string) => void;
      showSelectorAll: (selector: string) => void;
    };
  }
}

const BROWSER_HELPERS_SOURCE = `
      window.__helpers__ = {
        lazyLoad: async (selector = null, rendertime = 100) => {
          await new Promise(resolve => {
            const container = selector ? document.querySelector(selector) : null;
            if (selector && !container) {
              return resolve();
            }
            let prevScroll = 0;
            const timer = setInterval(() => {
              if (container) {
                container.scrollTop += container.clientHeight;
                if (container.scrollTop === prevScroll) {
                  clearInterval(timer);
                  resolve();
                }
                prevScroll = container.scrollTop;
                if (container.scrollTop + container.clientHeight >= container.scrollHeight) {
                  clearInterval(timer);
                  resolve();
                }
              } else {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, window.innerHeight * 0.8);
                if (window.innerHeight + window.scrollY >= scrollHeight) {
                  clearInterval(timer);
                  resolve();
                }
              }
            }, rendertime);
          });
        },
        hideSelectorAll: (selector) => {
          document.querySelectorAll(selector).forEach(el => el.style.display = 'none');
        },
        showSelectorAll: (selector) => {
          document.querySelectorAll(selector).forEach(el => el.style.display = 'block');
        },
        removeSelectorAll: (selector) => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        },
        removeMarginSelectorAll: (selector) => {
          document.querySelectorAll(selector).forEach(el => el.style.margin = '0');
        },
        timeout: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      };
    `;

export interface PuppeteerPdfOptions {
  readonly width?: number;
  readonly height?: number;
  readonly pageRanges?: string;
}

export interface PuppeteerSgService {
  readonly getPage: (url: string) => Effect.Effect<Page, PageLoadFailed, never>;
  readonly generatePDF: (page: Page, path: string, options?: PuppeteerPdfOptions) => Effect.Effect<void, PdfGenerationFailed, never>;
}

export class PuppeteerSg extends Context.Service<PuppeteerSg, PuppeteerSgService>()("PuppeteerSg") {}

export const PuppeteerSgTag = PuppeteerSg;

export interface PuppeteerSgOptions {
  readonly headful: boolean;
}

export interface BrowserSession {
  readonly newPage: () => Promise<Page>;
  readonly close: () => Promise<void>;
}

export type BrowserLauncher = (options: LaunchOptions) => Promise<BrowserSession>;

export type PuppeteerPdfIo = Pick<typeof fs, "writeFile">;

const buildLaunchOptions = (opts: PuppeteerSgOptions): LaunchOptions => {
  const useNoSandbox = process.env.CI === "true" || process.env.PUPPETEER_NO_SANDBOX === "true";
  const args: string[] = [];

  if (useNoSandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
  }

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  const options: LaunchOptions = {
    headless: !opts.headful,
    defaultViewport: null,
    args,
    timeout: 0,
    // Production keeps puppeteer's default 180s CDP timeout so a hung Scribd page
    // surfaces as a job failure instead of wedging the single-fiber worker queue.
    // Debug runs interactively under the developer's eye, so we disable the limit
    // to let heavy documents finish without false timeouts.
  };

  if (opts.headful) options.protocolTimeout = 0;

  if (executablePath) {
    return { ...options, executablePath };
  }

  return options;
};

export const makePuppeteerSgLive = (
  opts: PuppeteerSgOptions,
  launch: BrowserLauncher = (options) => puppeteer.launch(options),
  io: PuppeteerPdfIo = fs,
): Layer.Layer<PuppeteerSg, BrowserLaunchFailed, never> =>
  Layer.effect(
    PuppeteerSg,
    Effect.gen(function* () {
      const browser = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => launch(buildLaunchOptions(opts)),
          catch: (cause) => new BrowserLaunchFailed({ cause }),
        }),
        (b) => Effect.promise(() => b.close()),
      );

      const getPage = (url: string): Effect.Effect<Page, PageLoadFailed, never> =>
        Effect.uninterruptibleMask(() =>
          Effect.gen(function* () {
            const allocation = yield* Effect.try({
              try: () => browser.newPage(),
              catch: (cause) => new PageLoadFailed({ url, cause }),
            });

            const page = yield* Effect.interruptible(
              Effect.tryPromise({
                try: () => allocation,
                catch: (cause) => new PageLoadFailed({ url, cause }),
              }),
            ).pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  // The browser promise cannot be canceled. Release its eventual page
                  // without waiting for an allocation that may never resolve.
                  void allocation.then((allocated) => allocated.close()).catch(() => undefined);
                }),
              ),
            );

            const initialize = Effect.gen(function* () {
              yield* Effect.tryPromise({
                try: () => page.goto(url, { waitUntil: "load" }),
                catch: (cause) => new PageLoadFailed({ url, cause }),
              });
              yield* Effect.tryPromise({
                try: () => page.emulateMediaType("screen"),
                catch: (cause) => new PageLoadFailed({ url, cause }),
              });
              yield* Effect.tryPromise({
                try: () => page.evaluate(BROWSER_HELPERS_SOURCE),
                catch: (cause) => new PageLoadFailed({ url, cause }),
              });
              yield* Effect.sleep(PAGE_BUFFER_MS);

              return page;
            });

            return yield* Effect.interruptible(initialize).pipe(
              Effect.onError(() => Effect.tryPromise(() => page.close()).pipe(Effect.ignore)),
            );
          }),
        );

      const generatePDF = (page: Page, pdfPath: string, options?: PuppeteerPdfOptions): Effect.Effect<void, PdfGenerationFailed, never> =>
        Effect.gen(function* () {
          const pdfOptions: PDFOptions = {
            printBackground: true,
            timeout: 0,
          };

          if (options?.width !== undefined) pdfOptions.width = options.width;

          if (options?.height !== undefined) pdfOptions.height = options.height;

          if (options?.pageRanges !== undefined) pdfOptions.pageRanges = options.pageRanges;

          const bytes = yield* Effect.interruptible(
            Effect.tryPromise({
              try: () => page.pdf(pdfOptions),
              catch: (cause) => new PdfGenerationFailed({ path: pdfPath, cause }),
            }),
          );

          yield* Effect.uninterruptible(
            Effect.tryPromise({
              try: () => io.writeFile(pdfPath, bytes),
              catch: (cause) => new PdfGenerationFailed({ path: pdfPath, cause }),
            }),
          );
        });

      return PuppeteerSg.of({ getPage, generatePDF });
    }),
  );

export const PuppeteerSgLive = makePuppeteerSgLive({ headful: false });

export const PuppeteerSgDebugLive = makePuppeteerSgLive({ headful: true });
