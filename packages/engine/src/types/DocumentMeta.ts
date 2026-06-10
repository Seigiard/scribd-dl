import type { PageDimensions } from "./PageDimensions";

export interface DocumentMeta {
  readonly title: string;
  readonly id: string;
  readonly pages: ReadonlyArray<PageDimensions>;
}
