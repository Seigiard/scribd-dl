import { define } from "nanotags";
import { saveFolder } from "@/engineClient";
import { $folder, $modal } from "@/store";

const EMPTY_ERROR = "Path cannot be empty";
const SAVE_ERROR = "Failed to save";

define("sd-folder-modal").setup((ctx) => {
  ctx.host.innerHTML = `
    <article class="terminal-card">
      <header>Change download folder</header>
      <div class="p-1">
        <div class="form-group">
          <input id="sd-folder-input" type="text" data-ref="input" autocomplete="off" spellcheck="false" />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-default" data-ref="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-ref="save">Save</button>
        </div>
        <div class="terminal-alert terminal-alert-error" data-ref="error" hidden></div>
      </div>
    </article>
  `;

  const input = ctx.getElement<HTMLInputElement>('[data-ref="input"]');
  const error = ctx.getElement<HTMLDivElement>('[data-ref="error"]');
  const cancel = ctx.getElement<HTMLButtonElement>('[data-ref="cancel"]');
  const save = ctx.getElement<HTMLButtonElement>('[data-ref="save"]');

  const showError = (msg: string): void => {
    error.textContent = msg;
    error.hidden = false;
  };

  const close = (): void => {
    $modal.set("none");
  };

  const trySave = async (): Promise<void> => {
    const val = input.value.trim();
    if (!val) {
      showError(EMPTY_ERROR);
      return;
    }
    try {
      await saveFolder(val);
      close();
    } catch {
      showError(SAVE_ERROR);
    }
  };

  ctx.effect($modal, (mode) => {
    const open = mode === "folder";
    ctx.host.hidden = !open;
    if (open) {
      input.value = $folder.get() ?? "";
      error.hidden = true;
      error.textContent = "";
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    }
  });

  ctx.on(
    document,
    "keydown",
    (event) => {
      if (ctx.host.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
    { capture: true },
  );

  ctx.on(input, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void trySave();
    }
  });

  ctx.on(save, "click", () => {
    void trySave();
  });

  ctx.on(cancel, "click", () => {
    close();
  });

  ctx.on(ctx.host, "click", (event) => {
    if (event.target === ctx.host) close();
  });
});
