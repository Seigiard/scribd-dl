import type { PageDimensions } from "./PageDimensions.js";

export interface DocumentMeta {
  readonly title: string | null;
  readonly id: string;
  readonly pages: ReadonlyArray<PageDimensions>;
}
