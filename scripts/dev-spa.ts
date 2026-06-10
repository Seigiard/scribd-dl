#!/usr/bin/env bun
// Runs the engine (HTTP/WS) and the Vite dev server side-by-side so the
// browser-first SPA workflow is one command. Interleaves stdout from both
// processes with a tag prefix, and propagates SIGINT/SIGTERM to children.

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ENGINE_PORT = process.env.SCRIBD_DL_ENGINE_PORT ?? "4747";

const procs: ReturnType<typeof spawn>[] = [];

const tag = (label: string, color: string) => (line: string) => process.stdout.write(`\x1b[${color}m[${label}]\x1b[0m ${line}\n`);

const launch = (label: string, color: string, command: string, args: string[], cwd: string) => {
  const tagger = tag(label, color);
  const child = spawn(command, args, { cwd, env: process.env });
  procs.push(child);

  let stdoutBuf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      tagger(stdoutBuf.slice(0, nl));
      stdoutBuf = stdoutBuf.slice(nl + 1);
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = stderrBuf.indexOf("\n")) >= 0) {
      tagger(stderrBuf.slice(0, nl));
      stderrBuf = stderrBuf.slice(nl + 1);
    }
  });

  child.on("exit", (code, signal) => {
    tagger(`exited (code=${code ?? "?"}, signal=${signal ?? "?"})`);
    shutdown(code ?? 1);
  });
};

let shuttingDown = false;
const shutdown = (exitCode: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.killed) p.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const p of procs) {
      if (!p.killed) p.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 1500);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

launch("engine", "36", "bun", ["packages/engine/engine.ts", "--port", ENGINE_PORT], ROOT);
launch("vite", "35", "bun", ["run", "dev"], resolve(ROOT, "apps/web"));

process.stdout.write(`\x1b[2mdev:spa — engine on http://127.0.0.1:${ENGINE_PORT}, Vite on http://127.0.0.1:5173\x1b[0m\n`);
