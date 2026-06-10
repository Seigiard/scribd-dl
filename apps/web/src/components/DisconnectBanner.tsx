import { Button } from "@/components/ui/button";

export interface DisconnectBannerProps {
  readonly onReconnect: () => void;
}

export const DisconnectBanner = ({ onReconnect }: DisconnectBannerProps) => (
  <div
    role="alert"
    data-testid="disconnect-banner"
    className="flex items-center justify-between gap-3 border-b border-hairline bg-surface-1 px-6 py-2.5"
  >
    <div className="flex items-center gap-2 text-[13px] text-ink-muted">
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-status-failed-fg" />
      <span>Backend disconnected — engine is not reachable.</span>
    </div>
    <Button variant="secondary" size="sm" onClick={onReconnect}>
      Reconnect
    </Button>
  </div>
);
