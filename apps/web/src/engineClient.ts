import { containsUrl, JobEventSchema, summarizeEnqueueFeedback, type JobEvent } from "@scribd-dl/shared";
import * as defaultApi from "@/lib/api";
import { Result, Match, Schema } from "effect";
import { getBackendUrl, toWsUrl } from "@/lib/backendUrl";
import { $connected, $folder, $jobs, $settings, applySnapshot, dismissSticky, showTransient } from "@/store";

let ws: WebSocket | null = null;

let api: typeof defaultApi = defaultApi;

let baseUrl: string | null = null;

let starting: Promise<void> | null = null;

const refresh = async (): Promise<void> => {
  if (!baseUrl) return;

  try {
    const snap = await api.fetchSnapshot(baseUrl);
    applySnapshot(snap);
  } catch {
    // transport errors surface via the disconnect banner (R6)
  }
};

const loadFolder = async (): Promise<void> => {
  if (!baseUrl) return;

  try {
    $folder.set(await api.fetchFolder(baseUrl));
  } catch {
    $folder.set(null);
  }
};

const loadSettings = async (): Promise<void> => {
  if (!baseUrl) return;

  try {
    $settings.set(await api.fetchSettings(baseUrl));
  } catch {
    $settings.set(null);
  }
};

const handleWsEvent = (event: JobEvent): void => {
  Match.value(event).pipe(
    Match.tag("OutputFolderChanged", ({ path }) => $folder.set(path)),
    Match.tag("SnapshotReplaced", ({ snapshot }) => applySnapshot(snapshot)),
    Match.orElse(() => void refresh()),
  );
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
    void loadSettings();
  };

  next.onmessage = (msg) => {
    if (ws !== next) return;
    const event = Schema.decodeUnknownResult(Schema.fromJsonString(JobEventSchema))(msg.data);

    if (Result.isSuccess(event)) handleWsEvent(event.success);
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
  await api.setFolder(baseUrl, path);
  $folder.set(path);
};

export const saveSettingsCommand = async (publicKey: string, secretKey: string): Promise<boolean> => {
  if (!baseUrl) throw new Error("Engine not connected");
  const { valid } = await api.saveSettings(baseUrl, { publicKey, secretKey });
  const cleared = publicKey === "" && secretKey === "";
  $settings.set({ publicKey, secretKey, valid: cleared ? null : valid });

  return valid;
};

export const removeJobById = async (id: string): Promise<void> => {
  if (!baseUrl) return;
  await api.removeJob(baseUrl, id);
};

export const retryJobById = async (id: string): Promise<void> => {
  if (!baseUrl) return;
  await api.retryJob(baseUrl, id);
};

export const commandClearFinished = async (): Promise<void> => {
  if (!baseUrl) return;

  try {
    await api.clearFinished(baseUrl);
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
    await api.clearAll(baseUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to clear all jobs";
    showTransient("error", msg);
  }
};

const showFeedback = (feedback: ReturnType<typeof summarizeEnqueueFeedback>): void => {
  if (feedback === null) return;
  showTransient(feedback.severity, feedback.message, { sticky: feedback.sticky });
};

export const handlePastedText = async (text: string): Promise<void> => {
  if (!baseUrl) return;

  if (!containsUrl(text)) {
    showFeedback(summarizeEnqueueFeedback([]));

    return;
  }

  try {
    const { jobs } = await api.enqueueText(baseUrl, text);
    showFeedback(summarizeEnqueueFeedback(jobs));
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
  setApi: (dependencies: typeof defaultApi): void => {
    api = dependencies;
  },
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

    api = defaultApi;
    baseUrl = null;
    starting = null;
    detachPasteHandler();
  },
};
