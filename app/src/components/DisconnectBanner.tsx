import { Button } from "@/components/ui/button";

export interface DisconnectBannerProps {
  readonly onReconnect: () => void;
}

export const DisconnectBanner = ({ onReconnect }: DisconnectBannerProps) => (
  <div
    role="alert"
    data-testid="disconnect-banner"
    className="flex items-center justify-between gap-2 border-b border-red-900 bg-red-950/80 px-4 py-2 text-sm text-red-200"
  >
    <span>Backend disconnected — engine is not reachable.</span>
    <Button variant="outline" size="sm" onClick={onReconnect}>
      Reconnect
    </Button>
  </div>
);
