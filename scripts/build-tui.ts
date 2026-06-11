#!/usr/bin/env bun
// Two-step standalone build for the Ink TUI.
//
// Ink conditionally loads `react-devtools-core` in dev mode via dynamic import,
// but its `devtools.js` carries a top-level static `import devtools from
// 'react-devtools-core'` that Bun's bundler always traces. The package is not
// installed at runtime, so `bun build --compile` in one shot fails with
// "Cannot find package 'react-devtools-core'".
//
// Workaround mirrors the community fix from
// https://github.com/vadimdemedes/ink/issues/603:
//   1) Bundle with --external react-devtools-core to skip the resolve.
//   2) Strip the now-unresolvable static import from the bundle output.
//   3) Compile the patched bundle to a standalone binary.

import { $ } from "bun";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(ROOT, "apps/tui/tui.ts");
const DIST = resolve(ROOT, "dist");
const BUNDLE = resolve(DIST, "tui-bundle.mjs");
const BINARY = resolve(DIST, "scribd-dl-tui");

mkdirSync(DIST, { recursive: true });

await $`bun build ${ENTRY} --target=bun --format=esm --outfile=${BUNDLE} --external react-devtools-core`;

const original = readFileSync(BUNDLE, "utf8");
const patched = original.replace(/^\s*import\s+\w+\s+from\s+["']react-devtools-core["'];?\s*$/gm, "");

if (patched === original) {
  console.error("[build-tui] expected to strip a react-devtools-core import but none was found");
  process.exit(1);
}

writeFileSync(BUNDLE, patched);

await $`bun build --compile ${BUNDLE} --outfile=${BINARY}`;
