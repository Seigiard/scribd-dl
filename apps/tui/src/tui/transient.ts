export type TransientSeverity = "info" | "warning" | "error";

export interface TransientState {
  readonly severity: TransientSeverity;
  readonly message: string;
  readonly sticky: boolean;
}

export interface ShowOpts {
  readonly sticky?: boolean;
}

export const SEVERITY_TIMERS: Readonly<Record<TransientSeverity, number>> = {
  info: 2000,
  warning: 4000,
  error: 6000,
};

const SEVERITY_RANK: Readonly<Record<TransientSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
};

export const compareSeverity = (a: TransientSeverity, b: TransientSeverity): number => SEVERITY_RANK[a] - SEVERITY_RANK[b];

export const severityTimer = (severity: TransientSeverity): number => SEVERITY_TIMERS[severity];

export const applyTransient = (
  current: TransientState | null,
  severity: TransientSeverity,
  message: string,
  opts: ShowOpts = {},
): TransientState => {
  if (current !== null) {
    if (compareSeverity(severity, current.severity) < 0) return current;
    if (current.sticky && compareSeverity(severity, "error") < 0) return current;
  }
  return { severity, message, sticky: opts.sticky === true };
};
