import { Context, Effect, Layer } from "effect";
import puppeteer from "puppeteer";
import type { LaunchOptions, Page, PDFOptions } from "puppeteer";
import { BrowserLaunchFailed, PageLoadFailed, PdfGenerationFailed } from "../../errors/DomainErrors";

const PAGE_BUFFER_MS = 1000;

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
}

export interface PuppeteerSgService {
  readonly getPage: (url: string) => Effect.Effect<Page, PageLoadFailed, never>;
  readonly generatePDF: (page: Page, path: string, options?: PuppeteerPdfOptions) => Effect.Effect<void, PdfGenerationFailed, never>;
}

export class PuppeteerSg extends Context.Tag("PuppeteerSg")<PuppeteerSg, PuppeteerSgService>() {}

const buildLaunchOptions = (): LaunchOptions => {
  const useNoSandbox = process.env.CI === "true" || process.env.PUPPETEER_NO_SANDBOX === "true";
  const args: string[] = [];
  if (useNoSandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
  }
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const options: LaunchOptions = {
    headless: true,
    defaultViewport: null,
    args,
    timeout: 0,
  };
  if (executablePath) {
    return { ...options, executablePath };
  }
  return options;
};

export const PuppeteerSgLive = Layer.scoped(
  PuppeteerSg,
  Effect.gen(function* () {
    const browser = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => puppeteer.launch(buildLaunchOptions()),
        catch: (cause) => new BrowserLaunchFailed({ cause }),
      }),
      (b) => Effect.promise(() => b.close()),
    );

    const getPage = (url: string): Effect.Effect<Page, PageLoadFailed, never> =>
      Effect.gen(function* () {
        const page = yield* Effect.tryPromise({
          try: () => browser.newPage(),
          catch: (cause) => new PageLoadFailed({ url, cause }),
        });
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
        yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, PAGE_BUFFER_MS)));
        return page;
      });

    const generatePDF = (page: Page, pdfPath: string, options?: PuppeteerPdfOptions): Effect.Effect<void, PdfGenerationFailed, never> =>
      Effect.tryPromise({
        try: () => {
          const pdfOptions: PDFOptions = {
            path: pdfPath,
            printBackground: true,
            timeout: 0,
            ...options,
          };
          return page.pdf(pdfOptions).then(() => undefined);
        },
        catch: (cause) => new PdfGenerationFailed({ path: pdfPath, cause }),
      });

    return PuppeteerSg.of({ getPage, generatePDF });
  }),
);
