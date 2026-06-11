import { html, type Hole } from "uhtml";
import { reconnect } from "@/engineClient";

export type DisconnectBannerProps = {
  connected: boolean;
};

export const disconnectBanner = ({ connected }: DisconnectBannerProps): Hole => {
  if (connected) return html``;
  return html`<div class="terminal-alert terminal-alert-error">
    <span>Disconnected from engine.</span>
    <button type="button" class="btn btn-default" @click=${reconnect}>Reconnect</button>
  </div>`;
};
