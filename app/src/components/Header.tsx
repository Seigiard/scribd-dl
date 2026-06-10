import { Button } from "@/components/ui/button";

export interface HeaderProps {
  readonly folder: string | null;
  readonly onChangeFolder?: () => void;
}

export const Header = ({ folder, onChangeFolder }: HeaderProps) => (
  <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4 py-3">
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wider text-neutral-500">Download folder</span>
      <span className="font-mono text-sm text-neutral-200" data-testid="folder-path">
        {folder ?? "—"}
      </span>
    </div>
    <Button variant="outline" size="sm" onClick={onChangeFolder} disabled={!onChangeFolder}>
      Change folder
    </Button>
  </header>
);
