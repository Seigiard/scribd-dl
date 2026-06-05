import { puppeteerSg } from "./src/utils/request/PuppeteerSg.js";
import { configLoader } from "./src/utils/io/ConfigLoader.js";

async function run() {
    const url = "https://www.scribd.com/embeds/482542846/content";
    const page = await puppeteerSg.getPage(url);
    await page.waitForSelector('.outer_page_container');
    const html = await page.evaluate(() => document.querySelector('.outer_page_container').innerHTML);
    const fs = await import('fs');
    fs.writeFileSync('page_html.txt', html);
    await puppeteerSg.close();
}
run().catch(console.error);
