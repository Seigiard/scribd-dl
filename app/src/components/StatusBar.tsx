import { cn } from "@/lib/utils";

export interface StatusBarProps {
  readonly transientMessage?: string | null;
}

const HINT = "Press ⌘V to add links";

export const StatusBar = ({ transientMessage }: StatusBarProps) => (
  <footer className="border-t border-hairline bg-canvas px-6 py-2.5">
    <span
      className={cn(
        "text-[12px] tracking-[0.01em]",
        transientMessage ? "text-ink-muted" : "text-ink-subtle",
      )}
    >
      {transientMessage ?? HINT}
    </span>
  </footer>
);
