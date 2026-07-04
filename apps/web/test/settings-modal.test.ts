import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "uhtml";
import type { SettingsResponse } from "@scribd-dl/shared";

const saveSettingsCommandMock = vi.fn(async (_pub: string, _sec: string) => true);
vi.mock("@/engineClient", () => ({
  saveSettingsCommand: saveSettingsCommandMock,
}));

const { settingsModal, $settingsError, $draftPublicKey, $draftSecretKey, $settingsValidity } = await import("@/views/settings-modal");
const { $settings, $modal, resetStores } = await import("@/store");

type Props = {
  mode: "none" | "folder" | "settings";
  publicKey?: string;
  secretKey?: string;
  validity?: "unverified" | "validating" | "valid" | "invalid";
  error?: string | null;
};

const mount = (props: Props): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(
    container,
    settingsModal({
      mode: props.mode,
      publicKey: props.publicKey ?? "",
      secretKey: props.secretKey ?? "",
      validity: props.validity ?? "unverified",
      error: props.error ?? null,
    }),
  );
  return container;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("settingsModal()", () => {
  beforeEach(() => {
    resetStores();
    $settingsError.set(null);
    $draftPublicKey.set("");
    $draftSecretKey.set("");
    $settingsValidity.set("unverified");
    saveSettingsCommandMock.mockReset();
    saveSettingsCommandMock.mockResolvedValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing when mode is 'none'", () => {
    const root = mount({ mode: "none" });
    expect(root.querySelector(".settings-modal")).toBeNull();
  });

  it("renders both keys as plain text (not masked)", () => {
    const root = mount({ mode: "settings", publicKey: "pub123", secretKey: "sec456" });
    const inputs = root.querySelectorAll<HTMLInputElement>(".settings-input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.type).toBe("text");
    expect(inputs[1]!.type).toBe("text");
    expect(inputs[0]!.value).toBe("pub123");
    expect(inputs[1]!.value).toBe("sec456");
  });

  it("Save is disabled only when exactly one key is filled", () => {
    const saveBtn = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".btn-primary")!;

    // #then — exactly one filled → disabled
    expect(saveBtn(mount({ mode: "settings", publicKey: "pub", secretKey: "" })).disabled).toBe(true);
    document.body.innerHTML = "";
    expect(saveBtn(mount({ mode: "settings", publicKey: "", secretKey: "sec" })).disabled).toBe(true);
    document.body.innerHTML = "";
    // both filled → enabled
    expect(saveBtn(mount({ mode: "settings", publicKey: "pub", secretKey: "sec" })).disabled).toBe(false);
    document.body.innerHTML = "";
    // both empty (clear) → enabled
    expect(saveBtn(mount({ mode: "settings", publicKey: "", secretKey: "" })).disabled).toBe(false);
  });

  it("opening seeds validity from persisted flag: null → unverified", () => {
    // #given
    $settings.set({ publicKey: "", secretKey: "", valid: null } satisfies SettingsResponse);

    // #when
    $modal.set("settings");

    // #then
    expect($settingsValidity.get()).toBe("unverified");
  });

  it("opening seeds validity from persisted flag: true → valid", () => {
    // #given
    $settings.set({ publicKey: "p", secretKey: "s", valid: true } satisfies SettingsResponse);

    // #when
    $modal.set("settings");

    // #then
    expect($settingsValidity.get()).toBe("valid");
    expect($draftPublicKey.get()).toBe("p");
    expect($draftSecretKey.get()).toBe("s");
  });

  it("Save validates, resolves to valid, and keeps the modal open", async () => {
    // #given
    saveSettingsCommandMock.mockResolvedValue(true);
    $modal.set("settings");
    $draftPublicKey.set("pub");
    $draftSecretKey.set("sec");
    const root = mount({ mode: "settings", publicKey: "pub", secretKey: "sec" });

    // #when
    root.querySelector<HTMLButtonElement>(".btn-primary")!.click();
    await flush();

    // #then
    expect(saveSettingsCommandMock).toHaveBeenCalledWith("pub", "sec");
    expect($settingsValidity.get()).toBe("valid");
    expect($modal.get()).toBe("settings");
  });

  it("Save with invalid keys resolves to invalid and stays open", async () => {
    // #given
    saveSettingsCommandMock.mockResolvedValue(false);
    $modal.set("settings");
    $draftPublicKey.set("bad");
    $draftSecretKey.set("keys");
    const root = mount({ mode: "settings", publicKey: "bad", secretKey: "keys" });

    // #when
    root.querySelector<HTMLButtonElement>(".btn-primary")!.click();
    await flush();

    // #then
    expect($settingsValidity.get()).toBe("invalid");
    expect($modal.get()).toBe("settings");
  });

  it("Close dismisses the modal", () => {
    $modal.set("settings");
    const root = mount({ mode: "settings" });
    root.querySelector<HTMLButtonElement>(".btn-default")!.click();
    expect($modal.get()).toBe("none");
  });
});
