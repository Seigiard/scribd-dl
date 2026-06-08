import { scribdDownloader } from "./service/ScribdDownloader.js"
import { slideshareDownloader } from "./service/SlideshareDownloader.js"
import { everandDownloader } from "./service/EverandDownloader.js"
import * as scribdRegex from "./const/ScribdRegex.js"
import * as slideshareRegex from "./const/SlideshareRegex.js"
import * as everandRegex from "./const/EverandRegex.js"
import { configLoader } from "./utils/io/ConfigLoader.js"
import { directoryIo } from "./utils/io/DirectoryIo.js"

class App {
    constructor() {
        if (!App.instance) {
            App.instance = this
        }
        return App.instance
    }

    async execute(url) {
        await directoryIo.create(configLoader.load("DIRECTORY", "output"))

        if (url.match(scribdRegex.DOMAIN)) {
            await scribdDownloader.execute(url)
        } else if (url.match(slideshareRegex.DOMAIN)) {
            await slideshareDownloader.execute(url)
        } else if (url.match(everandRegex.DOMAIN)) {
            await everandDownloader.execute(url)
        } else {
            throw new Error(`Unsupported URL: ${url}`)
        }
    }
}

export const app = new App()