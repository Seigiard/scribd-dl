import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import type { PdfMergeFailed, PdfMetadataFailed } from "../src/errors/DomainErrors";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { makePdfGenerator, PdfGenerator, PdfGeneratorLive } from "../src/utils/io/PdfGenerator";

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

const runSetTitle = (pdfPath: string, title: string) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const svc = yield* PdfGenerator;
        yield* svc.setTitle(pdfPath, title);
      }),
      PdfGeneratorLive,
    ),
  );

const failureTag = (exit: Exit.Exit<unknown, PdfMergeFailed | PdfMetadataFailed>): string | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }

  const failure = Cause.findErrorOption(exit.cause);

  return Option.isSome(failure) ? failure.value._tag : undefined;
};

const isPdfMergeFailure = (exit: Exit.Exit<unknown, PdfMergeFailed>): boolean => failureTag(exit) === "PdfMergeFailed";

describe("PdfGenerator file transaction cancellation", () => {
  for (const operation of ["merge", "setTitle"] as const) {
    test(`${operation} cancellation waits for a started real file write`, async () => {
      // #given
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-transaction-"));
      const input = path.join(directory, "input.pdf");
      const output = path.join(directory, "output.pdf");
      await createPdf(input, 1);
      await createPdf(output, 1);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const completed = Promise.withResolvers<void>();

      const layer = makePdfGenerator({
        readFile: fs.readFile,
        rename: fs.rename,
        writeFile: async (...args) => {
          entered.resolve();
          await release.promise;
          await fs.writeFile(...args);
          completed.resolve();
        },
      });

      const controller = new AbortController();
      let settled = false;

      const running = Effect.runPromiseExit(
        Effect.provide(
          Effect.flatMap(PdfGenerator, (svc): Effect.Effect<void, PdfMergeFailed | PdfMetadataFailed> =>
            operation === "merge" ? svc.merge([input], output) : svc.setTitle(output, "Old title"),
          ),
          layer,
        ),
        { signal: controller.signal },
      );

      void running.then(() => {
        settled = true;
      });

      try {
        await entered.promise;
        // #when
        controller.abort();
        await Bun.sleep(10);
        const canceledBeforeWriteFinished = settled;
        release.resolve();
        await completed.promise;
        const exit = await running;
        await runSetTitle(output, "New job title");

        // #then
        expect(canceledBeforeWriteFinished).toBe(false);
        expect(Exit.hasInterrupts(exit)).toBe(true);
        const doc = await PDFDocument.load(await fs.readFile(output));
        expect(doc.getTitle()).toBe("New job title");
      } finally {
        release.resolve();
        await running;
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }
});

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

describe("PdfGenerator.setTitle", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdfgen-title-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("overwrites an existing Title with the given value", async () => {
    // #given a PDF whose Title is already set to "Scribd"
    const file = path.join(tmpDir, "doc.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.setTitle("Scribd");
    await fs.writeFile(file, await doc.save());

    // #when
    const exit = await runSetTitle(file, "My Document (2019)");

    // #then
    expect(Exit.isSuccess(exit)).toBe(true);
    const reloaded = await PDFDocument.load(await fs.readFile(file));
    expect(reloaded.getTitle()).toBe("My Document (2019)");
  });

  test("preserves an existing Producer (Title-only stamp)", async () => {
    // #given a PDF with a Producer set by an upstream tool
    const file = path.join(tmpDir, "doc.pdf");
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([612, 792]);
    doc.setProducer("GPL Ghostscript 10.07.1");
    await fs.writeFile(file, await doc.save());

    // #when
    const exit = await runSetTitle(file, "My Document");

    // #then — load without metadata rewrite so we read the raw on-disk Producer
    expect(Exit.isSuccess(exit)).toBe(true);
    const reloaded = await PDFDocument.load(await fs.readFile(file), { updateMetadata: false });
    expect(reloaded.getTitle()).toBe("My Document");
    expect(reloaded.getProducer()).toBe("GPL Ghostscript 10.07.1");
  });

  test("fails with PdfMetadataFailed when the file does not exist", async () => {
    // #given a path with no file
    const missing = path.join(tmpDir, "nope.pdf");

    // #when
    const exit = await runSetTitle(missing, "Whatever");

    // #then
    expect(failureTag(exit)).toBe("PdfMetadataFailed");
  });

  test("fails with PdfMetadataFailed when the file is not a valid PDF", async () => {
    // #given a garbage file
    const garbage = path.join(tmpDir, "garbage.pdf");
    await fs.writeFile(garbage, "not a pdf");

    // #when
    const exit = await runSetTitle(garbage, "Whatever");

    // #then
    expect(failureTag(exit)).toBe("PdfMetadataFailed");
  });
});
