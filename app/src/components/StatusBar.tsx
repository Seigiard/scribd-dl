import { cn } from "@/lib/utils";

export interface StatusBarProps {
  readonly transientMessage?: string | null;
}

const HINT = "Press ⌘V to add links";

export const StatusBar = ({ transientMessage }: StatusBarProps) => (
  <footer className="border-t border-neutral-800 bg-neutral-950 px-4 py-2">
    <span className={cn("text-xs", transientMessage ? "text-amber-400" : "text-neutral-500")}>{transientMessage ?? HINT}</span>
  </footer>
);
