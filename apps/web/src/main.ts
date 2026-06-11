import { render, type Hole } from "uhtml";
import "./styles.css";
import "./store";
import { $folder, $jobs, $modal, $transient } from "./store";
import { statusZone } from "./views/status-zone";
import { header } from "./views/header";
import { queue } from "./views/queue";
import { folderModal, $modalError, $draftFolder } from "./views/folder-modal";
import { installFakeJobs } from "./devFixtures";
import { attachPasteHandler, startEngineClient } from "./engineClient";

const mount = (selector: string, view: () => Hole | null): (() => void) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`mount target not found: ${selector}`);
  return () => render(el, view());
};

const renderStatusZone = mount(".mount-status-zone", () => statusZone({ transient: $transient.get(), jobs: $jobs.get() }));
$transient.listen(renderStatusZone);
$jobs.listen(renderStatusZone);
renderStatusZone();

const renderHeader = mount(".mount-header", () => header({ folder: $folder.get() }));
$folder.listen(renderHeader);
renderHeader();

const renderQueue = mount(".mount-queue", () => queue({ jobs: $jobs.get() }));
$jobs.listen(renderQueue);
renderQueue();

const renderModal = mount(".mount-modal", () =>
  folderModal({
    mode: $modal.get(),
    folder: $folder.get(),
    error: $modalError.get(),
    draft: $draftFolder.get(),
  }),
);
$modal.listen(renderModal);
$folder.listen(renderModal);
$modalError.listen(renderModal);
$draftFolder.listen(renderModal);
renderModal();

if (import.meta.env.DEV) installFakeJobs();
void startEngineClient();
attachPasteHandler();
