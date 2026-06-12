import { useCallback, useEffect, useRef, useState } from "react";
import { applyTransient, severityTimer, type ShowOpts, type TransientSeverity, type TransientState } from "../tui/transient";

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
        const next = applyTransient(current, severity, message, opts);
        if (next === current) return current;
        clearTimer();
        if (!next.sticky) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setTransient(null);
          }, severityTimer(next.severity));
        }
        return next;
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
