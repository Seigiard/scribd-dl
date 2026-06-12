import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { PdfGenerator, PdfGeneratorLive } from "../src/utils/io/PdfGenerator";

const createPdf = async (filePath: string, pageCount: number): Promise<void> => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792]);
  }
  const bytes = await doc.save();
  await fs.writeFile(filePath, bytes);
};

const runMerge = (inputs: ReadonlyArray<string>, output: string) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const svc = yield* PdfGenerator;
        yield* svc.merge(inputs, output);
      }),
      PdfGeneratorLive,
    ),
  );

const isPdfMergeFailure = (exit: Exit.Exit<unknown, unknown>): boolean => {
  if (!Exit.isFailure(exit)) {
    return false;
  }
  const failure = Cause.failureOption(exit.cause);
  return failure._tag === "Some" && (failure.value as { _tag?: string })._tag === "PdfMergeFailed";
};

describe("PdfGenerator.merge", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdfgen-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("merges two single-page PDFs into a two-page output", async () => {
    const a = path.join(tmpDir, "a.pdf");
    const b = path.join(tmpDir, "b.pdf");
    const out = path.join(tmpDir, "out.pdf");
    await createPdf(a, 1);
    await createPdf(b, 1);

    const exit = await runMerge([a, b], out);
    expect(Exit.isSuccess(exit)).toBe(true);

    const bytes = await fs.readFile(out);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  test("fails with PdfMergeFailed when input array is empty", async () => {
    const out = path.join(tmpDir, "out.pdf");
    const exit = await runMerge([], out);
    expect(isPdfMergeFailure(exit)).toBe(true);
  });

  test("fails with PdfMergeFailed when an input file is not a valid PDF", async () => {
    const valid = path.join(tmpDir, "valid.pdf");
    const garbage = path.join(tmpDir, "garbage.pdf");
    const out = path.join(tmpDir, "out.pdf");
    await createPdf(valid, 1);
    await fs.writeFile(garbage, "not a pdf");

    const exit = await runMerge([garbage, valid], out);
    expect(isPdfMergeFailure(exit)).toBe(true);
  });

  test("fails with PdfMergeFailed when output path points to a non-existent directory", async () => {
    const valid = path.join(tmpDir, "valid.pdf");
    await createPdf(valid, 1);
    const out = path.join(tmpDir, "missing-subdir", "out.pdf");

    const exit = await runMerge([valid], out);
    expect(isPdfMergeFailure(exit)).toBe(true);
  });

  test("merges a 3-page PDF with a 1-page PDF into a 4-page output", async () => {
    const three = path.join(tmpDir, "three.pdf");
    const one = path.join(tmpDir, "one.pdf");
    const out = path.join(tmpDir, "out.pdf");
    await createPdf(three, 3);
    await createPdf(one, 1);

    const exit = await runMerge([three, one], out);
    expect(Exit.isSuccess(exit)).toBe(true);

    const bytes = await fs.readFile(out);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
  });
});
