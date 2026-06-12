import type { Job } from "./jobs";

export type TransientSeverity = "info" | "warning" | "error";

export interface TransientState {
  readonly severity: TransientSeverity;
  readonly message: string;
  readonly sticky: boolean;
}

export interface IncomingTransient {
  readonly severity: TransientSeverity;
  readonly message: string;
  readonly sticky?: boolean;
}

export type TransientApplyResult =
  | { readonly kind: "ignored" }
  | { readonly kind: "applied"; readonly state: TransientState; readonly dismissAfterMs: number | null };

export const TRANSIENT_DURATIONS: Readonly<Record<TransientSeverity, number>> = {
  info: 2000,
  warning: 4000,
  error: 6000,
};

export const NO_LINKS_MESSAGE = "No links found in clipboard";

const SEVERITY_RANK: Readonly<Record<TransientSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
};

const IGNORED: TransientApplyResult = { kind: "ignored" };

const URL_PREFLIGHT_REGEX = /https?:\/\/\S+/;

export const containsUrl = (text: string): boolean => URL_PREFLIGHT_REGEX.test(text);

export const applyTransient = (current: TransientState | null, incoming: IncomingTransient): TransientApplyResult => {
  const sticky = incoming.sticky === true;
  if (current !== null) {
    const currentRank = SEVERITY_RANK[current.severity];
    const incomingRank = SEVERITY_RANK[incoming.severity];
    if (incomingRank < currentRank) return IGNORED;
  }
  const state: TransientState = { severity: incoming.severity, message: incoming.message, sticky };
  return {
    kind: "applied",
    state,
    dismissAfterMs: sticky ? null : TRANSIENT_DURATIONS[incoming.severity],
  };
};

const isNonRetryableRejection = (job: Job): boolean =>
  job.status === "Failed" && job.failure !== undefined && job.failure.retryable === false;

export const summarizeEnqueueFeedback = (jobs: ReadonlyArray<Job>): TransientState | null => {
  if (jobs.length === 0) {
    return { severity: "info", message: NO_LINKS_MESSAGE, sticky: false };
  }

  let rejectedCount = 0;
  let firstReason = "Unsupported link";
  for (const job of jobs) {
    if (isNonRetryableRejection(job)) {
      rejectedCount += 1;
      if (rejectedCount === 1 && job.failure) firstReason = job.failure.reason;
    }
  }

  if (rejectedCount === 0) return null;

  if (rejectedCount === jobs.length) {
    const message = rejectedCount === 1 ? firstReason : `${firstReason} (${rejectedCount} links)`;
    return { severity: "warning", message, sticky: false };
  }

  return { severity: "warning", message: `${rejectedCount} of ${jobs.length} links rejected`, sticky: false };
};
