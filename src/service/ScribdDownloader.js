import cliProgress from "cli-progress"
import sanitize from "sanitize-filename";
import { configLoader } from "../utils/io/ConfigLoader.js";
import { directoryIo } from "../utils/io/DirectoryIo.js"
import { pdfGenerator } from "../utils/io/PdfGenerator.js";
import { puppeteerSg } from "../utils/request/PuppeteerSg.js";
import * as scribdRegex from "../const/ScribdRegex.js"


const output = configLoader.load("DIRECTORY", "output")
const filename = configLoader.load("DIRECTORY", "filename")
const rendertime = parseInt(configLoader.load("SCRIBD", "rendertime"))

class ScribdDownloader {
    static progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    constructor() {
        if (!ScribdDownloader.instance) {
            ScribdDownloader.instance = this
        }
        return ScribdDownloader.instance
    }

    async execute(url) {
        let fn = this.embedsDefault.bind(this)
        if (url.match(scribdRegex.DOCUMENT)) {
            await fn(`https://www.scribd.com/embeds/${scribdRegex.DOCUMENT.exec(url)[2]}/content`)
        } else if (url.match(scribdRegex.EMBED)) {
            await fn(url)
        } else {
            throw new Error(`Unsupported URL: ${url}`)
        }
    }

    /**
     * Generate PDF by directly printing the pages
     */
    async embedsDefault(url) {
        const m = scribdRegex.EMBED.exec(url)
        if (!m) {
            throw new Error(`Unsupported URL: ${url}`)
        }
        const id = m[1]
        const page = await puppeteerSg.getPage(url)
        try {
            const {title, pages} = await this.processPage(page);
            const identifier = `${sanitize(filename === "title" ? title : id)}`
            const pdfPath = `${output}/${identifier}.pdf`
            if (pages.every(p => p.width === pages[0].width && p.height === pages[0].height)) {
                await puppeteerSg.generatePDF(page, pdfPath, {
                    width: pages[0].width,
                    height: pages[0].height
                })
            } else {
                const tempDir = `${output}/${identifier}_temp`
                const groups = await this.groupPagesByDimensions(pages)
                const pdfPaths = await this.generatePDFs(page, groups, tempDir);
                await pdfGenerator.merge(pdfPaths, pdfPath);
                directoryIo.remove(tempDir)
            }
            console.log(`Generated: ${pdfPath}`);
        } catch (err) {
            throw err;
        } finally {
            await page.close()
            await puppeteerSg.close()
        }
    }

    /**
     * Process the page to get title and page dimensions, and clean up unnecessary elements
     */
    async processPage(page) {
        console.log(`Processing page...`)
        return await page.evaluate(async (rendertime) => {
            ["div.customOptInDialog", "div[aria-label='Cookie Consent Banner']"].forEach(sel => {
                window.__helpers__.removeSelectorAll(sel);
            });
            await window.__helpers__.lazyLoad('div.document_scroller', rendertime);

            window.__helpers__.removeMarginSelectorAll("div.outer_page_container div[id^='outer_page_']");
            
            const overlay = document.querySelector("div.mobile_overlay a");
            const title = overlay ? decodeURIComponent(overlay.href.split('/').pop().trim()) : null;
            const pages = [];
            document.querySelectorAll("div.outer_page_container div[id^='outer_page_']").forEach(dom => {
                const style = getComputedStyle(dom);
                pages.push({
                    id: dom.id,
                    width: parseInt(style.width),
                    height: parseInt(style.height)
                })
            });
            document.body.innerHTML = document.querySelector("div.outer_page_container").innerHTML
            return { title: title, pages: pages };
        }, rendertime);
    }

    /**
     * Group pages by their dimensions
     */
    async groupPagesByDimensions(pages) {
        console.log(`Grouping pages by dimensions...`)
        const groups = [];
        if (pages.length === 0) {
            return groups;
        }
        let ids = [pages[0].id];
        ScribdDownloader.progressBar.start(pages.length, 1);
        for (let i = 1; i < pages.length; i++) {
            const prev = pages[i - 1];
            const curr = pages[i];
            if (curr.width === prev.width && curr.height === prev.height) {
                ids.push(curr.id);
            } else {
                groups.push({
                    ids: ids,
                    width: prev.width,
                    height: prev.height,
                });
                ids = [curr.id];
            }
            ScribdDownloader.progressBar.update(i + 1);
        }
        ScribdDownloader.progressBar.update(pages.length);
        ScribdDownloader.progressBar.stop();
        groups.push({
            ids: ids,
            width: pages[pages.length - 1].width,
            height: pages[pages.length - 1].height,
        });
        return groups;
    }

    /**
     * Generate PDFs for each group of pages with the same dimensions
     */
    async generatePDFs(page, groups, tempDir) {
        console.log(`Generating PDFs for ${groups.length} groups of pages...`)
        const pdfPaths = [];
        await page.evaluate(() => {
            window.__helpers__.hideSelectorAll("div[id^='outer_page_']");
        });
        ScribdDownloader.progressBar.start(groups.length, 0);
        for (let i = 0; i < groups.length; i++) {
            await page.evaluate((ids) => {
                window.__helpers__.showSelectorAll(ids.map(id => `div#${id}`).join(','));
            }, groups[i].ids);
            const pdfPath = `${tempDir}/${(i + 1).toString().padStart(5, '0')}.pdf`;
            await puppeteerSg.generatePDF(page, pdfPath, {
                width: groups[i].width,
                height: groups[i].height
            });
            pdfPaths.push(pdfPath);
            await page.evaluate((ids) => {
                window.__helpers__.removeSelectorAll(ids.map(id => `div#${id}`).join(','));
            }, groups[i].ids);
            ScribdDownloader.progressBar.update(i + 1);
        }
        ScribdDownloader.progressBar.update(groups.length);
        ScribdDownloader.progressBar.stop();
        return pdfPaths;
    }

}

export const scribdDownloader = new ScribdDownloader()
