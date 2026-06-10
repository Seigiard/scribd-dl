#!/usr/bin/env bun
// Runs the engine in the background and the TUI in the foreground.
// The TUI owns the terminal (alt-screen + raw input), so the engine's
// stdout/stderr cannot share it — they go to .dev-tui-engine.log instead.
// On TUI exit, the engine is killed.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_PORT = process.env.SCRIBD_DL_ENGINE_PORT ?? "4747";
const LOG_PATH = resolve(ROOT, ".dev-tui-engine.log");
const READY_TIMEOUT_MS = 10_000;

const log = createWriteStream(LOG_PATH, { flags: "w" });

const engine = spawn("bun", ["packages/engine/engine.ts", "--port", ENGINE_PORT], {
  cwd: ROOT,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let killed = false;
const killEngine = () => {
  if (killed) return;
  killed = true;
  if (!engine.killed) engine.kill("SIGTERM");
  setTimeout(() => {
    if (!engine.killed) engine.kill("SIGKILL");
  }, 1500);
};

process.on("SIGINT", () => killEngine());
process.on("SIGTERM", () => killEngine());
process.on("exit", () => killEngine());

engine.stderr.pipe(log);

const waitForReady = () =>
  new Promise<void>((resolveReady, rejectReady) => {
    let buf = "";
    const timeout = setTimeout(() => rejectReady(new Error(`engine did not emit READY within ${READY_TIMEOUT_MS}ms`)), READY_TIMEOUT_MS);
    engine.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      log.write(text);
      buf += text;
      if (buf.includes("READY")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    engine.on("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`engine exited before READY (code=${code ?? "?"})`));
    });
  });

try {
  await waitForReady();
} catch (err) {
  process.stderr.write(`dev:tui — ${(err as Error).message}\nSee ${LOG_PATH} for engine output.\n`);
  killEngine();
  process.exit(1);
}

// Detach engine stdout from this process now that we're handing the terminal to TUI;
// further engine output keeps streaming to the log file.
engine.stdout.removeAllListeners("data");
engine.stdout.pipe(log);

const tui = spawn("bun", ["apps/tui/tui.ts", "--engine-url", `http://localhost:${ENGINE_PORT}`], {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
});

tui.on("exit", (code) => {
  killEngine();
  process.exit(code ?? 0);
});
