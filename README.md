# Scribd-dl ![Bun](https://img.shields.io/badge/bun-1.3.14-000000.svg?style=flat&logo=bun&logoColor=white) ![Regression Tests](https://github.com/rkwyu/scribd-dl/actions/workflows/test.yml/badge.svg) 

<a href="https://buymeacoffee.com/r1y5i" target="_blank">
<img style="border-radius: 20px" src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174">
</a>

---

A command-line tool for downloading Scribd documents where you are authorized to do so.

(This project is not intended to bypass paywalls, violate terms of service, or download copyrighted content you are not permitted to access.)

## ⚠️ Important Legal & Ethical Notice ##
This tool is provided for use only on documents that you have legal permission to download, for example:

- Documents you have uploaded yourself
- Public-domain documents
- Works you have licensed
- Scribd content you have access to under your account *where offline saving is explicitly permitted*

Downloading or redistributing copyrighted material you don’t own or have a license for may violate copyright law and Scribd’s Terms of Service. Use responsibly.

(You should consult legal advice if unsure about rights.)

## About ##

Scribd-dl is a utility that helps generate local copies of [scribd.com](https://www.scribd.com/) documents for personal use where permitted. It works by rendering pages with a headless browser and saving them as PDF.

This tool does not remove paywalls, circumvent protections, or provide unauthorized access.

## Prerequisites ##

Install [Bun](https://bun.sh/docs/installation) (recommended: version `1.3.14` or newer) to run this tool locally.

Confirm installation:
```console
bun -v
```
The command should print the installed Bun version.

## Setup ##

Clone the repository and install dependencies (Bun workspaces — single `bun install` at the root hoists everything):
```console
git clone https://github.com/rkwyu/scribd-dl
cd scribd-dl
bun install
```

## Repository layout ##

```text
packages/
  engine/         # HTTP/WS sidecar (Effect.ts)
  shared/         # @scribd-dl/shared — job/HTTP/WS wire contract + thin client
apps/
  tui/            # @scribd-dl/tui — Ink/React terminal client (HTTP/WS)
  web/            # @scribd-dl/web — Vite SPA client (HTTP/WS)
  desktop/        # reserved slot for the future Tauri client
```

Cross-package types live in `@scribd-dl/shared`. Duplicating them in consumers is forbidden — engine and web both import the contract from there.

## Usage ##

The engine is a localhost HTTP/WS sidecar. Clients (Ink TUI, Vite SPA, future Tauri desktop) talk to it for queue and progress.

```console
bun run engine            # start the engine on default port 4747
bun run tui               # launch the Ink TUI client (auto-connects to a local engine)
bun run dev:spa           # run engine + Vite side-by-side with interleaved logs
```

Engine state (download folder and job queue) is persisted under `~/.config/scribd-dl/`:

| File | Purpose |
| --- | --- |
| `settings.json` | Persistent `outputFolder` chosen by the user. |
| `jobs.jsonl` | State-snapshot of the queue (one job per line). Jobs that were `Downloading` when the engine stopped are restored as `Queued`. |

There is no config file beyond `settings.json` — `outputFolder` is the only persistent setting; everything else lives as constants in the code.

### Other entry points ###

| Command | What it does |
| --- | --- |
| `bun run app:dev` | Start the Vite dev server for the SPA in `apps/web`. |
| `bun run test` | Run all workspace tests (engine `bun:test` + web Vitest). |

## Conventions ##

- Source files are TypeScript (`.ts`, strict mode), running on [Effect.ts](https://effect.website/): Layer-based dependency injection, Scope-based resource lifecycle, tagged errors.
- Bun runs `.ts` natively; no separate build step.

## Support URL Format ##
- https://www.scribd.com/doc/**
- https://www.scribd.com/document/**
- https://www.scribd.com/presentation/**
- https://www.scribd.com/embeds/**

## Why This Matters ##

Tools that automate downloading from websites can be misused to access content without proper authorization. This README clarifies that you should only use scribd-dl where you are permitted by law and by the site’s terms of service. It’s your responsibility to comply with those terms.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Scribd.

All trademarks and copyrights belong to their respective owners.

Users are solely responsible for ensuring their use of this tool complies with applicable laws and platform terms.

## License ##
This project is licensed under the [MIT License](LICENSE.md)
