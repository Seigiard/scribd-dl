import { existsSync } from "node:fs";
import { app } from "./src/App.js";
import { urlListReader } from "./src/utils/io/UrlListReader.js";

if (process.argv.length !== 3) {
  console.error("Usage: bun start <url-or-file>");
  process.exit(1);
}

const arg = process.argv[2];

if (existsSync(arg)) {
  const urls = await urlListReader.read(arg);
  if (urls.length === 0) {
    console.error(`No URLs found in ${arg}`);
    process.exit(1);
  }
  const report = await app.executeBatch(urls);
  console.log(`\n=== Batch summary ===`);
  console.log(`Total: ${report.total}, OK: ${report.ok}, Failed: ${report.failed}`);
  if (report.failed > 0) {
    console.log(`Failed URLs:`);
    for (const r of report.results) {
      if (r.status === "fail") {
        console.log(`  - ${r.url}: ${r.error}`);
      }
    }
    process.exit(1);
  }
} else {
  await app.execute(arg);
}
