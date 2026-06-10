import "./styles.css";
import "./store";
import "./components/sd-app";
import "./components/sd-header";
import "./components/sd-disconnect-banner";
import "./components/sd-queue";
import "./components/sd-queue-item";
import "./components/sd-statusbar";
import "./components/sd-folder-modal";
import { attachPasteHandler, startEngineClient } from "./engineClient";

void startEngineClient();
attachPasteHandler();
