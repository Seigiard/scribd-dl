import sanitize from "sanitize-filename";
import * as scribdRegex from "../../const/ScribdRegex";

export interface PdfPathInput {
  readonly folder: string;
  readonly displayTitle: string;
  readonly fallbackId: string;
}

export const resolvePdfPath = ({ folder, displayTitle, fallbackId }: PdfPathInput): string => {
  const sanitized = sanitize(displayTitle);
  const identifier = sanitized === "" ? fallbackId : sanitized;
  const cleanFolder = folder.replace(/\/+$/, "");
  return `${cleanFolder}/${identifier}.pdf`;
};

export const scribdIdFromUrl = (url: string): string | null => {
  const match = scribdRegex.DOCUMENT.exec(url) ?? scribdRegex.EMBED.exec(url);
  if (!match) return null;
  return scribdRegex.DOCUMENT.exec(url) ? match[2]! : match[1]!;
};
