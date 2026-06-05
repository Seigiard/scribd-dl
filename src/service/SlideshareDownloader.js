import cliProgress from "cli-progress"
import { puppeteerSg } from "../utils/request/PuppeteerSg.js";
import { pdfGenerator } from "../utils/io/PdfGenerator.js";
import { configLoader } from "../utils/io/ConfigLoader.js";
import { directoryIo } from "../utils/io/DirectoryIo.js"
import * as slideshareRegex from "../const/SlideshareRegex.js"
import { Image } from "../object/Image.js"
import sharp from "sharp";
import axios from "axios";
import fs from "fs"
import sanitize from "sanitize-filename";


const output = configLoader.load("DIRECTORY", "output")
const filename = configLoader.load("DIRECTORY", "filename")
const rendertime = parseInt(configLoader.load("SLIDESHARE", "rendertime"))

class SlideshareDownloader {
    static progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    constructor() {
        if (!SlideshareDownloader.instance) {
            SlideshareDownloader.instance = this
        }
        return SlideshareDownloader.instance
    }

    async execute(url) {
        if (url.match(slideshareRegex.SLIDESHOW)) {
            await this.slideshow(url, slideshareRegex.SLIDESHOW.exec(url)[1])
        } else if (url.match(slideshareRegex.PPT)) {
            await this.slideshow(url, slideshareRegex.PPT.exec(url)[1])
        } else {
            throw new Error(`Unsupported URL: ${url}`)
        }
    }

    async slideshow(url, id) {
        const page = await puppeteerSg.getPage(url, true)
        try {
            const {title} = await this.processPage(page);
            const identifier = `${sanitize(filename === "title" ? title : id)}`
            const pdfPath = `${output}/${identifier}.pdf`

            // get slides images
            const srcs = await page.$$eval("img[id^='slide-image-']", imgs => imgs.map(img => img.src));

            // iterate all images
            const tempDir = await directoryIo.create(`${output}/${id}`)
            const images = []
            SlideshareDownloader.progressBar.start(srcs.length, 0);
            for (let i = 0; i < srcs.length; i++) {
                const imagePath = `${tempDir}/${(i + 1).toString().padStart(5, '0')}.png`

                // convert the webp (even it shows jpg) to png
                const resp = await axios.get(srcs[i], { responseType: 'arraybuffer' })
                const imageBuffer = await sharp(resp.data).toFormat('png').toBuffer();
                fs.writeFileSync(imagePath, Buffer.from(imageBuffer, 'binary'))

                const metadata = await sharp(imagePath).metadata();
                images.push(new Image(imagePath, metadata.width, metadata.height));
                SlideshareDownloader.progressBar.update(i + 1);
            }
            SlideshareDownloader.progressBar.update(srcs.length);
            SlideshareDownloader.progressBar.stop();
            await pdfGenerator.generate(images, pdfPath)
            directoryIo.remove(`${tempDir}`)
        } catch (err) {
            throw err;
        } finally {
            await page.close()
            await puppeteerSg.close()
        }
    }
    
    async processPage(page) {
        console.log(`Processing page...`)
        return await page.evaluate(async (rendertime) => {
            await window.__helpers__.lazyLoad(null, rendertime);

            const h1 = document.querySelector("h1.title");
            const title = decodeURIComponent(h1.textContent.trim());

            return { title: title };
        }, rendertime);
    }
}

export const slideshareDownloader = new SlideshareDownloader()