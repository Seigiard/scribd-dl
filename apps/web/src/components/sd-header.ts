import { define } from "nanotags";
import { $folder, $modal } from "@/store";

define("sd-header").setup((ctx) => {
  ctx.host.innerHTML = `
    <div class="folder-row">
      <span>Download folder: <span data-ref="display">—</span></span>
      <button type="button" class="btn btn-default" data-ref="change">Change</button>
    </div>
  `;

  const display = ctx.getElement<HTMLSpanElement>('[data-ref="display"]');
  const change = ctx.getElement<HTMLButtonElement>('[data-ref="change"]');

  ctx.effect($folder, (folder) => {
    display.textContent = folder ?? "—";
  });

  ctx.on(change, "click", () => {
    $modal.set("folder");
  });
});
