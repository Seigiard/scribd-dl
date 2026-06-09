import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { PdfMergeFailed } from "../../errors/DomainErrors";

export interface PdfGeneratorService {
  readonly merge: (inputPdfPaths: ReadonlyArray<string>, outputPath: string) => Effect.Effect<void, PdfMergeFailed, never>;
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

export const PdfGeneratorLive = Layer.succeed(PdfGenerator, { merge });
