import { Context, Effect } from "effect";
import type { JobDomain } from "@scribd-dl/shared";
import {
  DirectoryIoFailed,
  PageLoadFailed,
  PageProcessFailed,
  PdfGenerationFailed,
  PdfMergeFailed,
  UnsupportedUrl,
} from "../errors/DomainErrors";

export type ScraperError = UnsupportedUrl | PageLoadFailed | PageProcessFailed | PdfGenerationFailed | PdfMergeFailed | DirectoryIoFailed;

export type ScraperEvent =
  | { readonly _tag: "TitleResolved"; readonly title: string }
  | { readonly _tag: "ScrapeProgress"; readonly done: number; readonly total: number }
  | { readonly _tag: "RenderProgress"; readonly done: number; readonly total: number };

export type OnEvent = (event: ScraperEvent) => Effect.Effect<void, never, never>;

export type ScraperId = Exclude<JobDomain, "unsupported">;

export interface Scraper {
  readonly id: ScraperId;
  readonly canHandle: (url: string) => boolean;
  readonly deriveDisplayTitle: (url: string) => string;
  readonly execute: (url: string, folder: string, onEvent: OnEvent, debug?: boolean) => Effect.Effect<void, ScraperError, never>;
}

export const findScraperForUrl = (scrapers: ReadonlyArray<Scraper>, url: string): Scraper | undefined =>
  scrapers.find((scraper) => scraper.canHandle(url));

export class Scrapers extends Context.Tag("Scrapers")<Scrapers, ReadonlyArray<Scraper>>() {}
