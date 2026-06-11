import { render, type Hole } from "uhtml";
import "./styles.css";
import "./store";
import { $connected, $folder, $jobs, $modal, $transient } from "./store";
import { statusbar } from "./views/statusbar";
import { disconnectBanner } from "./views/disconnect-banner";
import { header } from "./views/header";
import { queue } from "./views/queue";
import { folderModal, $modalError } from "./views/folder-modal";
import { installFakeJobs } from "./devFixtures";
import { attachPasteHandler, startEngineClient } from "./engineClient";

const mount = (selector: string, view: () => Hole | null): (() => void) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`mount target not found: ${selector}`);
  return () => render(el, view());
};

const renderStatusbar = mount(".mount-statusbar", () => statusbar({ transient: $transient.get() }));
$transient.listen(renderStatusbar);
renderStatusbar();

const renderBanner = mount(".mount-banner", () => disconnectBanner({ connected: $connected.get() }));
$connected.listen(renderBanner);
renderBanner();

const renderHeader = mount(".mount-header", () => header({ folder: $folder.get() }));
$folder.listen(renderHeader);
renderHeader();

const renderQueue = mount(".mount-queue", () => queue({ jobs: $jobs.get() }));
$jobs.listen(renderQueue);
renderQueue();

const renderModal = mount(".mount-modal", () => folderModal({ mode: $modal.get(), folder: $folder.get(), error: $modalError.get() }));
$modal.listen(renderModal);
$folder.listen(renderModal);
$modalError.listen(renderModal);
renderModal();

if (import.meta.env.DEV) installFakeJobs();
void startEngineClient();
attachPasteHandler();
