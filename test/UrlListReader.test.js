import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { urlListReader } from "../src/utils/io/UrlListReader.js";

let workDir;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "url-list-reader-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeFixture(name, content) {
  const fullPath = join(workDir, name);
  writeFileSync(fullPath, content);
  return fullPath;
}

describe("UrlListReader.read", () => {
  test("parses markdown bullet list with three URLs", async () => {
    const file = writeFixture(
      "markdown.md",
      [
        "- https://www.scribd.com/document/1/Foo",
        "- https://www.scribd.com/document/2/Bar",
        "- https://www.slideshare.net/slideshow/baz",
      ].join("\n"),
    );
    const urls = await urlListReader.read(file);
    expect(urls).toEqual([
      "https://www.scribd.com/document/1/Foo",
      "https://www.scribd.com/document/2/Bar",
      "https://www.slideshare.net/slideshow/baz",
    ]);
  });

  test("parses plain text one URL per line", async () => {
    const file = writeFixture("plain.txt", ["https://www.scribd.com/document/1/Foo", "https://www.scribd.com/document/2/Bar"].join("\n"));
    const urls = await urlListReader.read(file);
    expect(urls).toEqual(["https://www.scribd.com/document/1/Foo", "https://www.scribd.com/document/2/Bar"]);
  });

  test("handles mixed bullets, bare URLs, comments, and headers", async () => {
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
    const urls = await urlListReader.read(file);
    expect(urls).toEqual([
      "https://www.scribd.com/document/1/Foo",
      "https://www.scribd.com/document/2/Bar",
      "https://www.scribd.com/document/3/Baz",
    ]);
  });

  test("ignores empty lines and whitespace-only lines", async () => {
    const file = writeFixture(
      "blanks.txt",
      ["", "   ", "https://www.scribd.com/document/1/Foo", "\t", "https://www.scribd.com/document/2/Bar"].join("\n"),
    );
    const urls = await urlListReader.read(file);
    expect(urls).toEqual(["https://www.scribd.com/document/1/Foo", "https://www.scribd.com/document/2/Bar"]);
  });

  test("ignores lines without URLs", async () => {
    const file = writeFixture(
      "no-url.txt",
      ["random text without link", "https://www.scribd.com/document/1/Foo", "another note"].join("\n"),
    );
    const urls = await urlListReader.read(file);
    expect(urls).toEqual(["https://www.scribd.com/document/1/Foo"]);
  });

  test("returns empty array for empty file", async () => {
    const file = writeFixture("empty.txt", "");
    const urls = await urlListReader.read(file);
    expect(urls).toEqual([]);
  });

  test("throws when file does not exist", async () => {
    await expect(urlListReader.read(join(workDir, "missing.txt"))).rejects.toThrow();
  });
});
