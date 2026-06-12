import { useCallback, useEffect, useRef, useState } from "react";
import { applyTransient, type IncomingTransient, type TransientSeverity, type TransientState } from "@scribd-dl/shared";

export interface ShowOpts {
  readonly sticky?: boolean;
}

export interface UseTransient {
  readonly transient: TransientState | null;
  readonly showTransient: (severity: TransientSeverity, message: string, opts?: ShowOpts) => void;
  readonly dismissSticky: () => void;
}

export const useTransient = (): UseTransient => {
  const [transient, setTransient] = useState<TransientState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showTransient = useCallback(
    (severity: TransientSeverity, message: string, opts?: ShowOpts) => {
      setTransient((current) => {
        const incoming: IncomingTransient = opts?.sticky === undefined ? { severity, message } : { severity, message, sticky: opts.sticky };
        const result = applyTransient(current, incoming);
        if (result.kind === "ignored") return current;
        clearTimer();
        if (result.dismissAfterMs !== null) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setTransient(null);
          }, result.dismissAfterMs);
        }
        return result.state;
      });
    },
    [clearTimer],
  );

  const dismissSticky = useCallback(() => {
    clearTimer();
    setTransient(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { transient, showTransient, dismissSticky };
};
