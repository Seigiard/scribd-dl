import { define } from "nanotags";
import { reconnect } from "@/engineClient";
import { $connected } from "@/store";

define("sd-disconnect-banner").setup((ctx) => {
  ctx.host.innerHTML = `
    <div class="terminal-alert terminal-alert-error">
      <span>Disconnected from engine.</span>
      <button type="button" class="btn btn-default" data-ref="reconnect">Reconnect</button>
    </div>
  `;

  const reconnectBtn = ctx.getElement<HTMLButtonElement>('[data-ref="reconnect"]');

  ctx.effect($connected, (connected) => {
    ctx.host.hidden = connected;
  });

  ctx.on(reconnectBtn, "click", () => {
    reconnect();
  });
});
