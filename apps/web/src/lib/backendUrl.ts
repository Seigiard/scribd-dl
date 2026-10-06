import { Schema } from "effect";

const DEV_FALLBACK = "http://127.0.0.1:4747";

export type TauriInvoke = (
  cmd: "get_backend_url" | "pick_folder",
  args?: { readonly defaultPath: string | null },
) => Promise<string | null>;

interface TauriGlobal {
  readonly core: { readonly invoke: TauriInvoke };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
    readonly __SCRIBD_DL_BACKEND__?: string;
  }
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && Boolean(window.__TAURI__?.core?.invoke);

export const invokeTauri = async (
  cmd: "pick_folder",
  args: { readonly defaultPath: string | null },
): Promise<string | null> => {
  if (typeof window === "undefined" || !window.__TAURI__?.core?.invoke) {
    throw new Error("Tauri runtime not available");
  }

  return Schema.decodeUnknownSync(Schema.NullOr(Schema.String))(
    await window.__TAURI__.core.invoke(cmd, args),
  );
};

export const getBackendUrl = async (): Promise<string> => {
  // Test override (set in tests to control the resolved url).
  if (typeof window !== "undefined" && window.__SCRIBD_DL_BACKEND__) {
    return window.__SCRIBD_DL_BACKEND__;
  }

  // Tauri runtime: ask the Rust shim, which knows the sidecar's chosen port.
  if (typeof window !== "undefined" && window.__TAURI__?.core?.invoke) {
    try {
      return Schema.decodeUnknownSync(Schema.String)(
        await window.__TAURI__.core.invoke("get_backend_url"),
      );
    } catch {
      // fall through to dev fallback
    }
  }

  // Vite dev / plain browser.
  return DEV_FALLBACK;
};

export const toWsUrl = (httpUrl: string): string => httpUrl.replace(/^http/, "ws");
