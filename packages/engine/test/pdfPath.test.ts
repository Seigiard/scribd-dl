import { describe, expect, test } from "bun:test";
import { resolvePdfPath, scribdIdFromUrl } from "../src/utils/io/pdfPath";

describe("resolvePdfPath", () => {
  test("uses sanitized displayTitle when non-empty", () => {
    // #given
    const input = { folder: "/tmp/out", displayTitle: "My Doc", fallbackId: "12345" };

    // #when
    const path = resolvePdfPath(input);

    // #then
    expect(path).toBe("/tmp/out/My Doc.pdf");
  });

  test("falls back to id when displayTitle sanitizes to empty", () => {
    // #given
    const input = { folder: "/tmp/out", displayTitle: "////", fallbackId: "12345" };

    // #when
    const path = resolvePdfPath(input);

    // #then
    expect(path).toBe("/tmp/out/12345.pdf");
  });

  test("strips trailing slash from folder", () => {
    // #given
    const withSlash = { folder: "/tmp/out/", displayTitle: "doc", fallbackId: "1" };
    const withoutSlash = { folder: "/tmp/out", displayTitle: "doc", fallbackId: "1" };

    // #when
    const a = resolvePdfPath(withSlash);
    const b = resolvePdfPath(withoutSlash);

    // #then
    expect(a).toBe(b);
  });

  test("sanitizes filesystem-unsafe characters", () => {
    // #given
    const input = { folder: "/out", displayTitle: "bad/name?with*chars", fallbackId: "1" };

    // #when
    const path = resolvePdfPath(input);

    // #then
    expect(path).not.toContain("/bad/name");
    expect(path).toMatch(/\.pdf$/);
  });
});

describe("scribdIdFromUrl", () => {
  test("extracts id from /document/ URL", () => {
    // #given
    const url = "https://www.scribd.com/document/123456/some-title";

    // #when
    const id = scribdIdFromUrl(url);

    // #then
    expect(id).toBe("123456");
  });

  test("extracts id from /embeds/ URL", () => {
    // #given
    const url = "https://www.scribd.com/embeds/789/content";

    // #when
    const id = scribdIdFromUrl(url);

    // #then
    expect(id).toBe("789");
  });

  test("returns null for non-Scribd URL", () => {
    // #given
    const url = "https://example.com/foo";

    // #when
    const id = scribdIdFromUrl(url);

    // #then
    expect(id).toBeNull();
  });
});
