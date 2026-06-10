import { Button } from "@/components/ui/button";

export interface HeaderProps {
  readonly folder: string | null;
  readonly onChangeFolder?: () => void;
}

export const Header = ({ folder, onChangeFolder }: HeaderProps) => (
  <header className="flex h-14 items-center justify-between border-b border-hairline bg-canvas px-6">
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">Download folder</span>
      <span className="font-mono text-[13px] text-ink-muted" data-testid="folder-path">
        {folder ?? "—"}
      </span>
    </div>
    <Button variant="secondary" size="sm" onClick={onChangeFolder} disabled={!onChangeFolder}>
      Change folder
    </Button>
  </header>
);
