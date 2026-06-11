import { html, type Hole } from "uhtml";
import type { Job, JobId } from "@scribd-dl/shared";
import type { TransientState } from "@/store";
import { commandClearAll, commandClearFinished } from "@/engineClient";

const DEFAULT_HINT = "Press Ctrl/Cmd+V to download links";

export type StatusZoneProps = {
  transient: TransientState | null;
  jobs: Record<JobId, Job | undefined>;
};

const isTerminal = (status: Job["status"]): boolean => status === "Downloaded" || status === "Failed";

export const statusZone = ({ transient, jobs }: StatusZoneProps): Hole => {
  const present = Object.values(jobs).filter((j): j is Job => j !== undefined);
  const total = present.length;
  const terminalCount = present.filter((j) => isTerminal(j.status)).length;

  const messageText = transient?.message ?? DEFAULT_HINT;
  const messageCls = transient ? `status-zone-text status-zone-${transient.severity}` : "status-zone-text";

  return html`<div class="status-zone">
    <div class=${messageCls}>${messageText}</div>
    <div class="status-zone-actions">
      <button
        type="button"
        class="btn btn-default"
        ?disabled=${terminalCount === 0}
        @click=${() => void commandClearFinished()}
      >
        Clear Finished
      </button>
      <button
        type="button"
        class="btn btn-error"
        ?disabled=${total === 0}
        @click=${() => void commandClearAll()}
      >
        Clear All
      </button>
    </div>
  </div>`;
};
