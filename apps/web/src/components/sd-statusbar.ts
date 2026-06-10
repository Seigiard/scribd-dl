import { define } from "nanotags";
import { $transient } from "@/store";

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

define("sd-statusbar").setup((ctx) => {
  ctx.effect($transient, (msg) => {
    ctx.host.textContent = msg ?? DEFAULT_HINT;
  });
});
