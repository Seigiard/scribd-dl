import { useEffect } from "react";

export interface UsePasteHandlerOptions {
  readonly onText: (text: string) => void;
}

export const usePasteHandler = ({ onText }: UsePasteHandlerOptions): void => {
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim().length === 0) return;
      onText(text);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [onText]);
};
