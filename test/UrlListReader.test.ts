import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UrlListReader, UrlListReaderLive } from "../src/utils/io/UrlListReader";

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "url-list-reader-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const fullPath = join(workDir, name);
  writeFileSync(fullPath, content);
  return fullPath;
}

const runRead = (filePath: string) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.gen(function* () {
        const svc = yield* UrlListReader;
        return yield* svc.read(filePath);
      }),
      UrlListReaderLive,
    ),
  );

const isUrlListUnreadable = (exit: Exit.Exit<unknown, unknown>, expectedPath: string): boolean => {
  if (!Exit.isFailure(exit)) {
    return false;
  }
  const failures = Array.from(exit.cause.failures ?? []);
  const candidates = failures.length > 0 ? failures : [(exit.cause as { error?: unknown }).error];
  return candidates.some((f) => {
    const err = f as { _tag?: string; path?: string } | undefined;
    return err?._tag === "UrlListUnreadable" && err?.path === expectedPath;
  });
};

const expectUrls = (exit: Exit.Exit<ReadonlyArray<string>, unknown>, urls: ReadonlyArray<string>) => {
  expect(Exit.isSuccess(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    expect(exit.value).toEqual(urls);
  }
};

describe("UrlListReader.read", () => {
  test("parses three plain URLs one per line", async () => {
    // #given
    const file = writeFixture(
      "plain.txt",
      ["https://www.scribd.com/document/1/Foo", "https://www.scribd.com/document/2/Bar", "https://www.slideshare.net/slideshow/baz"].join(
        "\n",
      ),
    );

    // #when
    const exit = await runRead(file);

    // #then
    expectUrls(exit, [
      "https://www.scribd.com/document/1/Foo",
      "https://www.scribd.com/document/2/Bar",
      "https://www.slideshare.net/slideshow/baz",
    ]);
  });

  test("skips empty and whitespace-only lines", async () => {
    // #given
    const file = writeFixture(
      "blanks.txt",
      ["", "   ", "https://www.scribd.com/document/1/Foo", "\t", "https://www.scribd.com/document/2/Bar"].join("\n"),
    );

    // #when
    const exit = await runRead(file);

    // #then
    expectUrls(exit, ["https://www.scribd.com/document/1/Foo", "https://www.scribd.com/document/2/Bar"]);
  });

  test("skips lines starting with #", async () => {
    // #given
    const file = writeFixture(
      "commented.txt",
      ["# header comment", "https://www.scribd.com/document/1/Foo", "# another", "https://www.scribd.com/document/2/Bar"].join("\n"),
    );

    // #when
    const exit = await runRead(file);

    // #then
    expectUrls(exit, ["https://www.scribd.com/document/1/Foo", "https://www.scribd.com/document/2/Bar"]);
  });

  test("extracts URL from a markdown bullet line", async () => {
    // #given
    const file = writeFixture("bullet.md", ["- https://example.com/one", "* https://example.com/two"].join("\n"));

    // #when
    const exit = await runRead(file);

    // #then
    expectUrls(exit, ["https://example.com/one", "https://example.com/two"]);
  });

  test("extracts URL when inline text precedes it", async () => {
    // #given
    const file = writeFixture("inline.txt", "Check this: https://example.com — interesting");

    // #when
    const exit = await runRead(file);

    // #then
    expectUrls(exit, ["https://example.com"]);
  });

  test("returns empty array for an empty file", async () => {
    // #given
    const file = writeFixture("empty.txt", "");

    // #when
    const exit = await runRead(file);

    // #then
    expectUrls(exit, []);
  });

  test("fails with UrlListUnreadable when file is missing", async () => {
    // #given
    const missing = join(workDir, "does-not-exist.txt");

    // #when
    const exit = await runRead(missing);

    // #then
    expect(isUrlListUnreadable(exit, missing)).toBe(true);
  });

  test("handles mixed real-world markdown list in line order", async () => {
    // #given
    const file = writeFixture(
      "mixed.md",
      [
        "# Scribd links from zsh history",
        "",
        "- https://www.scribd.com/document/1/Foo",
        "https://www.scribd.com/document/2/Bar",
        "# inline comment",
        "* https://www.scribd.com/document/3/Baz",
      ].join("\n"),
    );

    // #when
    const exit = await runRead(file);

    // #then
    expectUrls(exit, [
      "https://www.scribd.com/document/1/Foo",
      "https://www.scribd.com/document/2/Bar",
      "https://www.scribd.com/document/3/Baz",
    ]);
  });
});
