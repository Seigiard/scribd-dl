const DEV_FALLBACK = "http://127.0.0.1:4747";

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriGlobal {
  readonly core: { readonly invoke: TauriInvoke };
}

declare global {
  interface Window {
    readonly __TAURI__?: TauriGlobal;
    readonly __TAURI_INTERNALS__?: unknown;
    readonly __SCRIBD_DL_BACKEND__?: string;
  }
}

export const isTauri = (): boolean => typeof window !== "undefined" && Boolean(window.__TAURI__?.core?.invoke);

export const invokeTauri = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (typeof window === "undefined" || !window.__TAURI__?.core?.invoke) {
    throw new Error("Tauri runtime not available");
  }
  return window.__TAURI__.core.invoke<T>(cmd, args);
};

export const getBackendUrl = async (): Promise<string> => {
  // Test override (set in tests to control the resolved url).
  if (typeof window !== "undefined" && window.__SCRIBD_DL_BACKEND__) {
    return window.__SCRIBD_DL_BACKEND__;
  }
  // Tauri runtime: ask the Rust shim, which knows the sidecar's chosen port.
  if (typeof window !== "undefined" && window.__TAURI__?.core?.invoke) {
    try {
      return await window.__TAURI__.core.invoke<string>("get_backend_url");
    } catch {
      // fall through to dev fallback
    }
  }
  // Vite dev / plain browser.
  return DEV_FALLBACK;
};

export const toWsUrl = (httpUrl: string): string => httpUrl.replace(/^http/, "ws");
