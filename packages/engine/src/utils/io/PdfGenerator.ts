import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { PdfMergeFailed, PdfMetadataFailed } from "../../errors/DomainErrors";

export interface PdfGeneratorService {
  readonly merge: (inputPdfPaths: ReadonlyArray<string>, outputPath: string) => Effect.Effect<void, PdfMergeFailed, never>;
  readonly setTitle: (pdfPath: string, title: string) => Effect.Effect<void, PdfMetadataFailed, never>;
}

export class PdfGenerator extends Context.Tag("PdfGenerator")<PdfGenerator, PdfGeneratorService>() {}

const merge = (inputPdfPaths: ReadonlyArray<string>, outputPath: string): Effect.Effect<void, PdfMergeFailed, never> => {
  if (inputPdfPaths.length === 0) {
    return Effect.fail(new PdfMergeFailed({ cause: new Error("no PDFs provided") }));
  }
  return Effect.tryPromise({
    try: async () => {
      const merged = await PDFDocument.create();
      for (const pdfPath of inputPdfPaths) {
        const pdfBytes = await fs.readFile(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const copiedPages = await merged.copyPages(pdfDoc, pdfDoc.getPageIndices());
        for (const page of copiedPages) {
          merged.addPage(page);
        }
      }
      const mergedBytes = await merged.save();
      await fs.writeFile(outputPath, mergedBytes);
    },
    catch: (cause) => new PdfMergeFailed({ cause }),
  });
};

// Stamps the PDF's document Title without touching Producer/ModDate, so a value written
// upstream by Chrome's print-to-PDF (the page <title>, e.g. "Scribd") or by a compression
// pass is replaced with our own filename-derived title. pdf-lib rewrites Producer to its
// own name inside updateInfoDict(), which runs at *load* time — so the load must pass
// updateMetadata:false, not just the save. Atomic tmp+rename: the source bytes are already
// in memory, so a partial write or crash never corrupts the finalized PDF.
const setTitle = (pdfPath: string, title: string): Effect.Effect<void, PdfMetadataFailed, never> =>
  Effect.tryPromise({
    try: async () => {
      const bytes = await fs.readFile(pdfPath);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      doc.setTitle(title);
      const stamped = await doc.save();
      const tmpPath = `${pdfPath}.tmp`;
      await fs.writeFile(tmpPath, stamped);
      await fs.rename(tmpPath, pdfPath);
    },
    catch: (cause) => new PdfMetadataFailed({ path: pdfPath, cause }),
  });

export const PdfGeneratorLive = Layer.succeed(PdfGenerator, { merge, setTitle });
