import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { resetStores } = await import("@/store");

describe("SPA smoke", () => {
  beforeEach(async () => {
    resetStores();

    const html = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf8");

    const scaffold = new DOMParser().parseFromString(html, "text/html");
    document.body.replaceChildren(...Array.from(scaffold.body.childNodes));
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("scaffold has all mount containers", () => {
    expect(document.querySelector(".mount-header")).not.toBeNull();
    expect(document.querySelector(".mount-status-zone")).not.toBeNull();
    expect(document.querySelector(".mount-queue")).not.toBeNull();
    expect(document.querySelector(".mount-modal")).not.toBeNull();
  });
});
