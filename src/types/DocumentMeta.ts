import type { PageDimensions } from "./PageDimensions";

export interface DocumentMeta {
  readonly title: string | null;
  readonly id: string;
  readonly pages: ReadonlyArray<PageDimensions>;
}
