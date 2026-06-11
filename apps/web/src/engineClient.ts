import type { JobEvent } from "@scribd-dl/shared";
import { clearAll, clearFinished, enqueueText, fetchFolder, fetchSnapshot, removeJob, retryJob, setFolder } from "@/lib/api";
import { getBackendUrl, toWsUrl } from "@/lib/backendUrl";
import { $connected, $folder, $jobs, applySnapshot, dismissSticky, showTransient } from "@/store";

const NO_LINKS_MESSAGE = "No links found in clipboard";
const URL_REGEX = /(https?:\/\/\S+)/g;

let ws: WebSocket | null = null;
let baseUrl: string | null = null;
let starting: Promise<void> | null = null;

const refresh = async (): Promise<void> => {
  if (!baseUrl) return;
  try {
    const snap = await fetchSnapshot(baseUrl);
    applySnapshot(snap);
  } catch {
    // transport errors surface via the disconnect banner (R6)
  }
};

const loadFolder = async (): Promise<void> => {
  if (!baseUrl) return;
  try {
    $folder.set(await fetchFolder(baseUrl));
  } catch {
    $folder.set(null);
  }
};

const handleWsEvent = (event: JobEvent): void => {
  if (event._tag === "OutputFolderChanged") {
    $folder.set(event.path);
    return;
  }
  if (event._tag === "SnapshotReplaced") {
    applySnapshot(event.snapshot);
    return;
  }
  void refresh();
};

const parseEvent = (data: unknown): JobEvent | null => {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as JobEvent;
  } catch {
    return null;
  }
};

const openSocket = (): void => {
  if (!baseUrl) return;
  const next = new WebSocket(`${toWsUrl(baseUrl)}/events`);
  ws = next;

  next.onopen = () => {
    if (ws !== next) return;
    $connected.set(true);
    dismissSticky();
    void refresh();
    void loadFolder();
  };
  next.onmessage = (msg) => {
    if (ws !== next) return;
    const event = parseEvent(msg.data);
    if (event) handleWsEvent(event);
    else void refresh();
  };
  next.onclose = () => {
    if (ws !== next) return;
    $connected.set(false);
    showTransient("error", "Disconnected from engine", { sticky: true });
  };
  next.onerror = () => {
    if (ws !== next) return;
    $connected.set(false);
    showTransient("error", "Disconnected from engine", { sticky: true });
  };
};

export const startEngineClient = async (): Promise<void> => {
  if (starting) return starting;
  starting = (async () => {
    baseUrl = await getBackendUrl();
    openSocket();
  })();
  return starting;
};

export const reconnect = (): void => {
  if (ws) {
    const old = ws;
    ws = null;
    old.close();
  }
  openSocket();
};

export const getBaseUrl = (): string | null => baseUrl;

export const saveFolder = async (path: string): Promise<void> => {
  if (!baseUrl) throw new Error("Engine not connected");
  await setFolder(baseUrl, path);
  $folder.set(path);
};

export const removeJobById = async (id: string): Promise<void> => {
  if (!baseUrl) return;
  await removeJob(baseUrl, id);
};

export const retryJobById = async (id: string): Promise<void> => {
  if (!baseUrl) return;
  await retryJob(baseUrl, id);
};

export const commandClearFinished = async (): Promise<void> => {
  if (!baseUrl) return;
  try {
    await clearFinished(baseUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to clear finished jobs";
    showTransient("error", msg);
  }
};

export const commandClearAll = async (): Promise<void> => {
  if (!baseUrl) return;
  const total = Object.values($jobs.get()).filter((j): j is NonNullable<typeof j> => j !== undefined).length;
  if (total === 0) return;
  const confirmed = window.confirm(`Remove all ${total} jobs and cancel any active downloads? Files on disk are kept.`);
  if (!confirmed) return;
  try {
    await clearAll(baseUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to clear all jobs";
    showTransient("error", msg);
  }
};

const extractUrls = (text: string): string[] => text.match(URL_REGEX) ?? [];

export const handlePastedText = async (text: string): Promise<void> => {
  if (!baseUrl) return;
  const links = extractUrls(text);
  if (links.length === 0) {
    showTransient("info", NO_LINKS_MESSAGE);
    return;
  }
  try {
    const { jobs } = await enqueueText(baseUrl, text);
    if (jobs.length === 0) showTransient("info", NO_LINKS_MESSAGE);
  } catch {
    // transport errors surface via the disconnect banner
  }
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
};

let pasteHandler: ((event: ClipboardEvent) => void) | null = null;

export const attachPasteHandler = (): void => {
  if (pasteHandler) return;
  pasteHandler = (event: ClipboardEvent) => {
    if (isEditableTarget(event.target)) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (!text) return;
    void handlePastedText(text);
  };
  window.addEventListener("paste", pasteHandler);
};

export const detachPasteHandler = (): void => {
  if (!pasteHandler) return;
  window.removeEventListener("paste", pasteHandler);
  pasteHandler = null;
};

export const __testing = {
  setBaseUrl: (url: string | null): void => {
    baseUrl = url;
  },
  handleWsEvent,
  reset: (): void => {
    if (ws) {
      const old = ws;
      ws = null;
      old.close();
    }
    baseUrl = null;
    starting = null;
    detachPasteHandler();
  },
};
