import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "uhtml";
import { header } from "@/views/header";
import { $modal, resetStores } from "@/store";

describe("header()", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows placeholder when folder is null", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, header({ folder: null }));

    // #then
    expect(container.textContent).toContain("Download folder:");
    expect(container.textContent).toContain("—");
  });

  it("shows the folder path when provided", () => {
    // #given
    const container = document.createElement("div");

    // #when
    render(container, header({ folder: "/Users/foo" }));

    // #then
    expect(container.textContent).toContain("/Users/foo");
  });

  it("clicking Change sets $modal to 'folder'", () => {
    // #given
    const container = document.createElement("div");
    render(container, header({ folder: null }));
    const button = container.querySelector("button")!;

    // #when
    button.click();

    // #then
    expect($modal.get()).toBe("folder");
  });
});
