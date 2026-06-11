import { describe, expect, test } from "bun:test";
import { normalizeUrl } from "../src/utils/url";

describe("normalizeUrl", () => {
  test("is idempotent for canonical URLs", () => {
    // #given
    const input = "https://scribd.com/document/123/title";

    // #when
    const once = normalizeUrl(input);
    const twice = normalizeUrl(once);

    // #then
    expect(twice).toBe(once);
  });

  test("drops trailing slash on path", () => {
    // #given
    const withSlash = "https://scribd.com/document/123/title/";
    const withoutSlash = "https://scribd.com/document/123/title";

    // #when
    const a = normalizeUrl(withSlash);
    const b = normalizeUrl(withoutSlash);

    // #then
    expect(a).toBe(b);
  });

  test("preserves trailing slash on root path", () => {
    // #given
    const root = "https://scribd.com/";

    // #when
    const result = normalizeUrl(root);

    // #then
    expect(result).toBe("https://scribd.com/");
  });

  test("lowercases host", () => {
    // #given
    const upperHost = "https://SCRIBD.com/document/123";
    const lowerHost = "https://scribd.com/document/123";

    // #when
    const a = normalizeUrl(upperHost);
    const b = normalizeUrl(lowerHost);

    // #then
    expect(a).toBe(b);
  });

  test("drops fragment", () => {
    // #given
    const withFragment = "https://scribd.com/document/123#page=5";

    // #when
    const result = normalizeUrl(withFragment);

    // #then
    expect(result).toBe("https://scribd.com/document/123");
  });

  test("preserves query string", () => {
    // #given
    const withQuery = "https://scribd.com/document/123?embed=true";
    const withoutQuery = "https://scribd.com/document/123";

    // #when
    const a = normalizeUrl(withQuery);
    const b = normalizeUrl(withoutQuery);

    // #then
    expect(a).not.toBe(b);
  });

  test("returns trimmed raw for invalid URL", () => {
    // #given
    const invalid = "  not-a-url  ";

    // #when
    const result = normalizeUrl(invalid);

    // #then
    expect(result).toBe("not-a-url");
  });

  test("trims whitespace around valid URL", () => {
    // #given
    const padded = "  https://scribd.com/document/123  ";

    // #when
    const result = normalizeUrl(padded);

    // #then
    expect(result).toBe("https://scribd.com/document/123");
  });
});
