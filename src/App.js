import { scribdDownloader } from "./service/ScribdDownloader.js";
import { slideshareDownloader } from "./service/SlideshareDownloader.js";
import { everandDownloader } from "./service/EverandDownloader.js";
import * as scribdRegex from "./const/ScribdRegex.js";
import * as slideshareRegex from "./const/SlideshareRegex.js";
import * as everandRegex from "./const/EverandRegex.js";
import { configLoader } from "./utils/io/ConfigLoader.js";
import { directoryIo } from "./utils/io/DirectoryIo.js";

class App {
  constructor() {
    if (!App.instance) {
      App.instance = this;
    }
    return App.instance;
  }

  async execute(url) {
    await directoryIo.create(configLoader.load("DIRECTORY", "output"));

    if (url.match(scribdRegex.DOMAIN)) {
      await scribdDownloader.execute(url);
    } else if (url.match(slideshareRegex.DOMAIN)) {
      await slideshareDownloader.execute(url);
    } else if (url.match(everandRegex.DOMAIN)) {
      await everandDownloader.execute(url);
    } else {
      throw new Error(`Unsupported URL: ${url}`);
    }
  }

  async executeBatch(urls) {
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] ${url}`);
      try {
        await this.execute(url);
        results.push({ url, status: "ok" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[FAIL] ${url}: ${message}`);
        results.push({ url, status: "fail", error: message });
      }
    }
    const ok = results.filter((r) => r.status === "ok").length;
    const failed = results.length - ok;
    return { total: results.length, ok, failed, results };
  }
}

export const app = new App();
