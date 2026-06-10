---
title: "refactor: Migrate scribd-dl to Bun workspaces monorepo"
status: active
date: 2026-06-10
type: refactor
origin: docs/brainstorms/2026-06-10-monorepo-migration-requirements.md
---

# refactor: Migrate scribd-dl to Bun workspaces monorepo

## Summary

Reorganise the repository into a Bun workspaces monorepo with `packages/{engine,shared}` and `apps/{web,desktop}` layout. The engine (current root) moves to `packages/engine`, the SPA (current `app/`) moves to `apps/web`, and a new `packages/shared` package becomes the single source of truth for the job/HTTP/WS contract currently duplicated between the engine and the SPA. `apps/desktop` is reserved as an empty stub for the future Tauri client. Delivered as a single PR.

---

## Problem Frame

The repo already contains two packages with separate `package.json`/`bun.lock`/`node_modules` and a duplicated TypeScript contract. The brainstorm (see origin) names three concrete pains: manual type duplication (`src/service/DownloadEngine.ts` types vs `app/src/lib/types.ts`), awkward cross-package scripts (`cd app && bun run …`), and no clean slot for the upcoming Tauri desktop client. The brainstorm picked **Bun workspaces** with the `packages/` + `apps/` layout and `workspace:*` internal versioning, and resolved all outstanding questions during dialogue.

No product behaviour changes. This is purely a structural reorganisation.

---

## Requirements (carried from origin)

- **R1.** Single `bun.lock` at repo root after `bun install`.
- **R2.** Job/HTTP/WS contract types defined exactly once, in `packages/shared`; engine and web import via `@scribd-dl/shared`.
- **R3.** Removing or modifying a field on `JobEvent` in `packages/shared` causes a TypeScript error in both `packages/engine` and `apps/web` until the consumers are updated.
- **R4.** `bun test`, `bun run lint`, `bun run format` from repo root cover both packages via `bun --filter`.
- **R5.** `bun start <url>`, `bun run tui`, `bun run engine`, `bun run app:dev` (or workspace-filtered equivalents) continue to work from repo root.
- **R6.** `./docker-download.sh <url>` continues to work end-to-end.
- **R7.** `links.md` removed; `docs/` and `output/` remain at repo root.
- **R8.** `apps/desktop` slot reserved (empty package with README stub) so Tauri integration later does not require restructuring other packages.
- **R9.** No engine/SPA functional changes; existing tests pass without modification beyond import path updates.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Workspace tool | Bun workspaces only | Self-use project, 3 packages — Turborepo overkill. Native Bun, no extra config to maintain. |
| Layout | `packages/{engine,shared}` + `apps/{web,desktop}` | Clear lib/service vs app split; future-proof for Tauri. Confirmed in brainstorm. |
| Internal package versioning | `"@scribd-dl/shared": "workspace:*"` | Idiomatic; no manual version sync. Confirmed in brainstorm. |
| Migration strategy | Single PR, big-bang | Self-use project, single dev. Staged migration would mean transient duplication and zero review benefit. Confirmed in scoping synthesis. |
| Shared types as source of truth | Move `Job`/`JobId`/`JobEvent`/`EngineSnapshot`/`JobProgress`/`JobFailure`/`JobStatus`/`JobDomain`/`ProgressStage` physically to `packages/shared`; engine imports from `@scribd-dl/shared` | Single source of truth eliminates drift risk between engine and clients. The current "engine defines, clients duplicate" pattern is exactly the problem we are removing. Confirmed in scoping synthesis. |
| HTTP request/response body shapes | Co-locate in `packages/shared` next to `JobEvent` | They are part of the same wire contract. Defining them as types now (even though they are minimal — `{ text }`, `{ path }`, `{ jobs }`) gives the engine routes and any future client a single contract to import. |
| `apps/desktop` slot | Create empty package directory with `package.json` and `README.md` stub | Zero cost, fixes the slot, prevents future "where does this go?" question. Confirmed in scoping synthesis. |
| Shared package surface | Single `src/index.ts` barrel re-exporting from per-concern files (`jobs.ts`, `http.ts`) | Conventional Bun-workspace shape; consumers do `import { JobEvent } from "@scribd-dl/shared"` without caring about internal layout. |
| What does NOT move to shared | `DocumentMeta`, `PageDimensions` (engine-internal scraping types not crossing wire boundary) | Out of scope per Engine-internal vs cross-boundary distinction. |
| Root `package.json` | Manifest-only — `name`, `private: true`, `workspaces`, dev scripts via `bun --filter`. No runtime deps. | Standard workspace-root pattern. Runtime deps live in their owning workspace. |

---

## Output Structure

```text
scribd-dl/
├── package.json                          # workspaces root, dev scripts
├── bun.lock                              # single lockfile
├── bunfig.toml                           # stays at root (bun config is global)
├── tsconfig.json                         # references composite (or simple root excluding workspace dirs)
├── docker-download.sh                    # stays at root, paths updated
├── README.md                             # updated for new commands
├── CLAUDE.md                             # updated for new structure
├── docs/                                 # unchanged
├── output/                               # unchanged (runtime artefacts)
├── packages/
│   ├── shared/
│   │   ├── package.json                  # name: @scribd-dl/shared
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # barrel
│   │       ├── jobs.ts                   # Job, JobId, JobEvent, EngineSnapshot, etc.
│   │       └── http.ts                   # HTTP/WS request/response body shapes
│   └── engine/
│       ├── package.json                  # name: @scribd-dl/engine, deps from old root
│       ├── tsconfig.json
│       ├── bunfig.toml                   # if engine-specific config needed; otherwise rely on root
│       ├── run.ts                        # moved from root
│       ├── tui.ts                        # moved from root
│       ├── engine.ts                     # moved from root
│       ├── src/                          # moved from root, imports updated
│       └── test/                         # moved from root
└── apps/
    ├── web/                              # renamed from app/
    │   ├── package.json                  # name: @scribd-dl/web, deps unchanged
    │   ├── tsconfig.json                 # paths unchanged
    │   ├── vite.config.ts
    │   ├── index.html
    │   └── src/                          # lib/types.ts removed, imports rewired
    └── desktop/                          # new stub
        ├── package.json                  # name: @scribd-dl/desktop, private, no deps
        └── README.md                     # stub describing future Tauri integration
```

---

## High-Level Technical Design

### Type dependency before and after

**Before**

```text
src/service/DownloadEngine.ts ──defines──> Job, JobEvent, JobId, ...
                                                 │
                                                 │ (no actual import — duplicated by hand)
                                                 ▼
                                  app/src/lib/types.ts (mirror copy)
                                                 │
                                                 ▼
                                  app/src/{hooks,components}/**
```

**After**

```text
                          packages/shared/src/{jobs,http}.ts
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
        packages/engine/src/service/             apps/web/src/**
        DownloadEngine.ts (imports)              (imports)
                          │
                          ▼
        packages/engine/src/server/routes.ts
        (also imports HTTP body shapes)
```

Single arrow into each consumer. Removing a field in `packages/shared` breaks both consumers at compile time.

### Workspace resolution

Root `package.json` declares:

```jsonc
{
  "name": "scribd-dl",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": { /* see U6 */ },
  "devDependencies": { "oxlint": "...", "oxfmt": "..." }
}
```

Each workspace's `package.json` declares its own `dependencies` and `devDependencies`. `@scribd-dl/shared` appears as `"workspace:*"` in `packages/engine/package.json` and `apps/web/package.json`. `bun install` at root creates a single hoisted `node_modules/` plus symlinks for the internal packages.

---

## Scope Boundaries

### In scope

- Workspace setup (root manifest, per-package manifests).
- Creating `packages/shared` with the cross-boundary type contract.
- Moving engine code (`run.ts`, `tui.ts`, `engine.ts`, `src/`, `test/`) into `packages/engine` and updating imports to use `@scribd-dl/shared`.
- Moving SPA (`app/`) into `apps/web` and rewiring all imports of `app/src/lib/types.ts` to `@scribd-dl/shared`. Deleting the local types file.
- Creating `apps/desktop` stub.
- Updating root `package.json` scripts to use `bun --filter`.
- Updating `scripts/dev-spa.ts` to new paths.
- Updating `docker-download.sh` to new paths (if it references the engine location).
- Updating `tsconfig.json` files for the new layout.
- Updating `oxlint`/`oxfmt` glob arguments for the new layout.
- Updating `README.md` and `CLAUDE.md` for new commands and structure.
- Deleting `links.md`.

### Deferred to Follow-Up Work

- Real Tauri integration in `apps/desktop` (the stub is the slot only).
- Codegen of the HTTP contract (OpenAPI / typed RPC) — `packages/shared` is the current bridge; further automation is a separate decision.
- Dependency dedup as an explicit goal (will happen as a byproduct of single lockfile; not driving the work).
- Reorganising `docs/`, `output/`, or `scripts/`.

### Outside this product's identity

- Adopting Turborepo, Nx, or any monorepo orchestrator. Reaffirmed in brainstorm and KTDs.
- Publishing `@scribd-dl/shared` as an external npm package. Internal-only.

---

## Implementation Units

Units are ordered so that each leaves the working tree in a state where TypeScript could resolve (modulo not-yet-moved files). The whole sequence lands as a single PR/commit; the ordering exists for reviewer comprehension and to keep diff localised per unit.

### U1. Workspace root scaffolding

**Goal:** Convert root `package.json` into a workspace manifest and create empty workspace directories.

**Requirements:** R1, R4.

**Dependencies:** none.

**Files:**
- `package.json` (rewrite — see Approach)
- `packages/shared/` (new directory)
- `packages/engine/` (new directory, empty for now)
- `apps/web/` (new directory, empty for now)
- `apps/desktop/` (new directory, empty for now)
- `.gitignore` (verify it covers `**/node_modules`, `**/dist`)

**Approach:**
- Strip the root `package.json` down to: `name`, `private: true`, `type: "module"`, `workspaces: ["packages/*", "apps/*"]`, root dev scripts (filled in U6), and dev-tool deps (`oxlint`, `oxfmt`). Runtime deps move to engine in U3.
- Keep `bunfig.toml` at root (Bun reads it globally; can stay).
- Do NOT delete `app/`, root `src/`, `run.ts`, `tui.ts`, `engine.ts` yet — moves happen in subsequent units.
- This unit is purely structural — directories exist, but workspace globs match empty dirs harmlessly.

**Patterns to follow:** User's existing oxlint/oxfmt-using monorepo project (mentioned in brainstorm — same convention works).

**Test scenarios:** none — purely structural scaffolding with no behaviour. `Test expectation: none -- workspace manifest change verified by U2/U3 install succeeding.`

**Verification:**
- `cat package.json` shows `workspaces` array and no runtime deps.
- `packages/shared/`, `packages/engine/`, `apps/web/`, `apps/desktop/` exist.

---

### U2. Create `packages/shared` with the wire contract

**Goal:** Define the single source of truth for job/HTTP types. This unit is created **before** engine and web move so that subsequent units can import from `@scribd-dl/shared` immediately.

**Requirements:** R2, R3.

**Dependencies:** U1.

**Files:**
- `packages/shared/package.json` (new)
- `packages/shared/tsconfig.json` (new)
- `packages/shared/src/index.ts` (new — barrel)
- `packages/shared/src/jobs.ts` (new)
- `packages/shared/src/http.ts` (new)

**Approach:**
- `packages/shared/package.json`:
  - `name: "@scribd-dl/shared"`, `private: true`, `type: "module"`, `version: "0.0.0"`.
  - `main`/`exports` pointing at `./src/index.ts` (Bun resolves TS directly; no build step needed).
  - No `dependencies`. No `devDependencies` (TypeScript inherits from root or engine; types-only package).
- `jobs.ts` defines: `JobStatus`, `JobDomain`, `ProgressStage`, `JobFailure`, `JobProgress`, `Job`, `EngineSnapshot`, `JobEvent`, `JobId` (the branded string type currently in `src/service/DownloadEngine.ts:8`).
- `http.ts` defines: request/response body shapes for the engine HTTP endpoints — `EnqueueRequest = { text: string }`, `EnqueueResponse = { jobs: ReadonlyArray<Job> }`, `FolderResponse = { path: string }`, `FolderRequest = { path: string }`, error response shape (matching `jsonError` in `src/server/routes.ts`).
- `index.ts` re-exports everything: `export * from "./jobs"; export * from "./http";`.
- `tsconfig.json` mirrors root (`strict`, `verbatimModuleSyntax`, `noEmit`, `moduleResolution: "bundler"`).

**Patterns to follow:** Existing wire-contract shapes in `src/service/DownloadEngine.ts` (lines around `JobEvent`, `EngineSnapshot`) and the duplicated definitions in `app/src/lib/types.ts`. Definitions must be byte-equivalent to the existing engine versions so engine code does not need behavioural changes — only import-path changes.

**Test scenarios:** none — types-only package, behaviour verified transitively by engine and web tests after U3/U4.

**Verification:**
- `bun install` at root succeeds; `node_modules/@scribd-dl/shared` is a symlink to `packages/shared`.
- `bun --cwd packages/shared run tsc --noEmit` (or equivalent type-check) passes.
- Manual diff: every type currently in `app/src/lib/types.ts` has a corresponding definition in `packages/shared/src/jobs.ts` with identical fields.

---

### U3. Move engine to `packages/engine` and import shared types

**Goal:** Relocate all engine source, tests, and entry points into `packages/engine`, replace inline job/HTTP type definitions with imports from `@scribd-dl/shared`.

**Requirements:** R2, R3, R5, R9.

**Dependencies:** U1, U2.

**Files (moves):**
- `run.ts` → `packages/engine/run.ts`
- `tui.ts` → `packages/engine/tui.ts`
- `engine.ts` → `packages/engine/engine.ts`
- `src/` → `packages/engine/src/`
- `test/` → `packages/engine/test/`
- `tsconfig.json` → `packages/engine/tsconfig.json` (with `include` paths adjusted)

**Files (new/modified):**
- `packages/engine/package.json` (new) — `name: "@scribd-dl/engine"`, `private: true`, `type: "module"`, all runtime deps from old root (`@effect/cli`, `@effect/platform`, `@effect/platform-bun`, `cli-progress`, `effect`, `ink`, `pdf-lib`, `puppeteer`, `react`, `sanitize-filename`), all `@types/*` dev deps. Add `"@scribd-dl/shared": "workspace:*"`.
- `packages/engine/src/service/DownloadEngine.ts` — delete the local `JobId`, `Job`, `JobEvent`, `EngineSnapshot`, etc. type declarations; import them from `@scribd-dl/shared` instead. Keep service Tag/Layer logic untouched.
- `packages/engine/src/server/routes.ts` — replace inline body shape inference with explicit imports from `@scribd-dl/shared` (`EnqueueRequest`, `FolderRequest`, etc.). The runtime `typeof body.text === "string"` validation stays — types-at-the-boundary remain runtime-checked.
- `packages/engine/src/types/{DocumentMeta,PageDimensions}.ts` — stay engine-internal. Do not move.
- Root-level deleted: `run.ts`, `tui.ts`, `engine.ts`, `src/`, `test/`, `tsconfig.json` (the old root tsconfig is replaced by per-package ones; if a root `tsconfig.json` is kept for editor support, it should reference workspaces only).

**Approach:**
- The move is a `git mv` of each top-level item into `packages/engine/`. Resist temptation to refactor anything else.
- After move, sweep imports inside `packages/engine/src/` that previously referenced `./types/...` or local job types: replace consumer-side imports that need shared types (`Job`, `JobEvent`, etc.) with `import { ... } from "@scribd-dl/shared"`. Keep engine-internal references (`DocumentMeta`, `PageDimensions`) as relative imports.
- Engine entry points (`run.ts`, `tui.ts`, `engine.ts`) — their internal imports stay relative because they live alongside `src/` (paths remain `./src/...`).
- `packages/engine/tsconfig.json` — copy of old root tsconfig with `include` adjusted to `["run.ts", "tui.ts", "engine.ts", "src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx"]`.
- TUI's React deps stay in `packages/engine/package.json` (Ink consumes React in the engine process, not the SPA's React).

**Execution note:** Run `bun test` from `packages/engine` after the move to confirm no behavioural regression. Test files import only from within the package and from `@scribd-dl/shared` — no changes to test logic.

**Patterns to follow:** Existing module organisation under `src/` (cli, server, service, tui, utils, types, const, errors) — preserve unchanged. Effect-Layer composition in `run.ts` unchanged.

**Test scenarios:**
- All existing engine tests under `packages/engine/test/` pass unchanged after import-path updates.
- `bun --cwd packages/engine run start <test-url>` from a checkout produces the same PDF output as before the migration (smoke test, not automated).
- `bun --cwd packages/engine run engine` starts the HTTP sidecar and `/snapshot` returns valid `EngineSnapshot` shape per `@scribd-dl/shared`.

**Verification:**
- `bun test` from `packages/engine` passes.
- `grep -rn "JobEvent\|EngineSnapshot\|JobId\b" packages/engine/src/` shows only imports from `@scribd-dl/shared`, no local type definitions (except inside the import statements themselves).
- TUI launches: `bun --cwd packages/engine run tui` opens the Ink interface.

---

### U4. Move SPA to `apps/web` and replace local types with shared

**Goal:** Relocate the Vite SPA from `app/` to `apps/web`, delete `app/src/lib/types.ts`, rewire all consumers to `@scribd-dl/shared`.

**Requirements:** R2, R3, R5, R9.

**Dependencies:** U2 (must exist before imports can resolve).

**Files (moves):**
- `app/` → `apps/web/` (entire tree, including `index.html`, `vite.config.ts`, `tsconfig.json`, `src/`, `test/`)
- Delete `apps/web/src/lib/types.ts` after rewiring.
- Delete `apps/web/bun.lock` (single lockfile lives at repo root).
- Delete `apps/web/node_modules/` (re-installed at root by `bun install`).

**Files (modified):**
- `apps/web/package.json` — keep `name: "scribd-dl-app"` or rename to `"@scribd-dl/web"` (rename — consistent with `@scribd-dl/*` family). Add `"@scribd-dl/shared": "workspace:*"` to `dependencies`. Other deps unchanged.
- `apps/web/src/**` — find every `import { ... } from "@/lib/types"` (or relative variant) and replace with `import { ... } from "@scribd-dl/shared"`. The `@/*` alias remains for non-types imports.
- `apps/web/tsconfig.json` — unchanged paths config (the `@/*` alias is still local). Verify `include` still resolves under the new location.
- `apps/web/vite.config.ts` — verify path-alias config (`@` → `./src`) still works (it's relative, should be fine). React plugin and Tailwind unchanged.

**Approach:**
- `git mv app apps/web`.
- Delete `apps/web/bun.lock` and `apps/web/node_modules/`.
- Rewire types: a single `find apps/web/src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec grep -l "@/lib/types\|lib/types" {} \;` identifies consumer files. Each gets its `import` line edited.
- Delete `apps/web/src/lib/types.ts` only after all consumers compile against the shared package.
- Vitest config under `apps/web/` is self-contained; no path changes.

**Patterns to follow:** Existing import style in `apps/web/src/hooks/` and `apps/web/src/components/` — only the source of `Job`, `JobEvent`, etc. changes. The variable names and usage stay identical because `packages/shared/src/jobs.ts` is byte-equivalent (U2).

**Test scenarios:**
- `bun --cwd apps/web run test` (vitest) passes all existing test suites without modification beyond the import path change.
- `bun --cwd apps/web run build` produces a dist bundle the same shape as before.
- `bun --cwd apps/web run dev` boots Vite; the SPA renders against the engine (manual smoke).
- Removing a field from `Job` in `packages/shared/src/jobs.ts` causes `tsc` to fail in `apps/web` — verified manually once during this unit, then reverted (R3 acceptance demonstration).

**Verification:**
- `apps/web/src/lib/types.ts` no longer exists.
- `grep -rn "JobEvent\|EngineSnapshot" apps/web/src/` shows only imports from `@scribd-dl/shared`.
- `apps/web/bun.lock` and `apps/web/node_modules` do not exist.
- Vitest passes.

---

### U5. Reserve `apps/desktop` stub

**Goal:** Create the empty desktop slot so the future Tauri client has a defined home.

**Requirements:** R8.

**Dependencies:** U1.

**Files:**
- `apps/desktop/package.json` (new)
- `apps/desktop/README.md` (new)

**Approach:**
- `package.json`: `name: "@scribd-dl/desktop"`, `private: true`, `type: "module"`, no deps, no scripts beyond a placeholder. Marks the workspace as present so `bun install` recognises it.
- `README.md`: one-paragraph stub explaining the slot is reserved for the Tauri desktop client; current plan-of-record is `docs/plans/2026-06-09-007-feat-desktop-app-tauri-bun-plan.md` (referenced, not duplicated).

**Test scenarios:** none — zero behaviour. `Test expectation: none -- placeholder workspace with no code.`

**Verification:**
- `bun install` at root succeeds; `apps/desktop` appears under workspace resolution (`bun pm ls` or equivalent shows it).
- `apps/desktop/README.md` exists and links to the desktop plan.

---

### U6. Root scripts, `scripts/dev-spa.ts`, `docker-download.sh`

**Goal:** Make every developer command runnable from repo root and update tooling that referenced the old paths.

**Requirements:** R4, R5, R6.

**Dependencies:** U3, U4 (the targets of the filters must exist).

**Files:**
- `package.json` (root — scripts section)
- `scripts/dev-spa.ts` (path updates)
- `docker-download.sh` (path updates if it references the engine location)

**Approach:**

Root `package.json` scripts:

| Script | Command | Notes |
|---|---|---|
| `start` | `bun --cwd packages/engine run start` | preserves `bun start <url>` shape |
| `tui` | `bun --cwd packages/engine run tui` | |
| `engine` | `bun --cwd packages/engine run engine` | |
| `app:dev` | `bun --cwd apps/web run dev` | keeps legacy alias |
| `app:build` | `bun --cwd apps/web run build` | |
| `app:test` | `bun --cwd apps/web run test` | |
| `dev:spa` | `bun scripts/dev-spa.ts` | path inside script updated below |
| `test` | `bun --filter '*' test` | runs both engine (`bun:test`) and web (`vitest`) |
| `lint` | `bun --filter '*' lint` OR root-level `oxlint packages/*/src packages/*/test apps/*/src apps/*/test scripts` | choose root-level for single command — oxlint handles globs natively |
| `lint:fix` | as above with `--fix` | |
| `format` | `oxfmt --write packages apps scripts package.json` | |
| `format:check` | `oxfmt --check packages apps scripts package.json` | |

- Engine workspace `package.json` declares its own `start`/`tui`/`engine` scripts (`bun run.ts`, `bun tui.ts`, `bun engine.ts`) so root `--cwd` invocations resolve.
- Web workspace `package.json` `scripts` are unchanged (`vite`, `vite build`, `vitest run`).
- `scripts/dev-spa.ts`: update `ROOT` resolution — script lives at `scripts/dev-spa.ts`, ROOT = `..` (unchanged), but the launch commands change:
  - Engine: `launch("engine", "...", "bun", ["packages/engine/engine.ts", "--port", ENGINE_PORT, "--output", OUTPUT], ROOT)` instead of `["engine.ts", ...]`.
  - Web: `launch("web", "...", "bun", ["run", "dev"], resolve(ROOT, "apps/web"))` instead of `resolve(ROOT, "app")`.
- `docker-download.sh`: read it first; if it `cd`s into the repo or references `run.ts`, update to point at `packages/engine/run.ts`. If it uses `bun run start` against root, the root script alias above keeps it working unchanged.

**Patterns to follow:** Existing script style in current root `package.json` — flat, named after the operation, no orchestrator.

**Test scenarios:**
- `bun test` at root runs both engine and web tests and they all pass.
- `bun run lint` at root reports clean across both packages.
- `bun run format:check` at root reports clean.
- `bun run app:dev` boots Vite (smoke).
- `bun start <test-url>` downloads a test document (smoke, optional in CI).
- `bun run dev:spa` interleaves engine + Vite output as before.
- `./docker-download.sh <test-url>` produces a PDF (smoke, optional).

**Verification:**
- Manually invoke each script from a clean checkout.
- `package.json` diff is the visible source of truth for what changed.

---

### U7. Documentation update and final cleanup

**Goal:** Update `README.md` and `CLAUDE.md` for the new structure, delete `links.md`, confirm no orphan files remain at root.

**Requirements:** R7.

**Dependencies:** U1–U6.

**Files:**
- `README.md` (modify — update commands and structure section)
- `CLAUDE.md` (modify — update architecture description and conventions)
- `links.md` (delete)
- Verify root: no leftover `app/`, `src/`, `test/`, `run.ts`, `tui.ts`, `engine.ts`, `tsconfig.json` (or, if root `tsconfig.json` is kept as an editor-aid stub that references workspace tsconfigs, document that).

**Approach:**
- `README.md`:
  - Update the "Runtime and commands" section to use root-level scripts (`bun start`, `bun run tui`, `bun --cwd ...` examples).
  - Add a brief "Repository layout" section showing `packages/` and `apps/`.
  - Update Docker workflow only if `docker-download.sh` arguments changed.
- `CLAUDE.md`:
  - Section "Architecture": replace the "Entry point `run.ts` ..." paragraph's path references with `packages/engine/run.ts`, `packages/engine/src/service/...`, etc.
  - Add a new short section "Repository layout" describing the workspaces and the rule that `packages/shared` is the source of truth for the wire contract.
  - Update the "Conventions" list: add a bullet "Cross-package types live in `packages/shared`; duplicating them in consumers is forbidden."
- `git rm links.md`.

**Test scenarios:** none — documentation. `Test expectation: none -- prose update, verified by manual read.`

**Verification:**
- Re-read both docs end-to-end; every file path mentioned exists at the stated location.
- `find . -maxdepth 1 -name "run.ts" -o -name "tui.ts" -o -name "engine.ts" -o -name "src" -o -name "test" -o -name "app" -o -name "links.md"` returns nothing.
- `bun install && bun test && bun run lint && bun run format:check` from a clean clone of the migrated branch all succeed.

---

## System-Wide Impact

- **CI**: not currently set up (the brainstorm flagged this as open). If/when CI is added, jobs should run from repo root with `bun --filter` or per-workspace `--cwd`. No CI changes in this PR.
- **Docker**: `docker-download.sh` continues to work; the container only needs to know the root-level `bun start <arg>` entry, which the root script alias preserves.
- **Editor/IDE**: TypeScript path resolution changes. Developers may need to reload TS server after pulling. No `paths` config in root tsconfig means each workspace is independent — VSCode/Cursor handle Bun workspaces natively via per-folder tsconfigs.
- **`output/` directory**: unchanged (runtime artefact at repo root). No script writes to a different relative path because all `output/` references resolve from the engine workspace's `cwd`, which is now `packages/engine/` — **this is a behavioural change**. The engine, when run via root `bun start`, will have `process.cwd()` of `packages/engine/`, not the repo root. To preserve "output lands at repo root", either:
  - **Option A** (recommended): the root `start` script `cd`s into root before invoking engine: `cd packages/engine && bun run.ts ...` — `process.cwd()` becomes `packages/engine/`, so `output/` lands inside the package. Acceptable only if we move `output/` into `packages/engine/output/`.
  - **Option B**: engine resolves `--output` relative to repo root (find via `process.env.SCRIBD_DL_REPO_ROOT` or walk up to nearest `packages/` ancestor). More surgery.
  - **Option C** (chosen): keep `output/` at repo root per R7; root `start` script becomes `bun packages/engine/run.ts ...` (no `--cwd`), so `process.cwd()` stays at repo root. The script table in U6 reflects Option C — verify there it uses `bun packages/engine/run.ts` rather than `--cwd packages/engine run start` for any entry point that writes to `output/`.

  **Decision for the plan: Option C.** Root scripts that produce output (`start`, `tui` via the engine that downloads, `engine` HTTP server, `dev:spa`) invoke `bun packages/engine/<file>.ts` from repo root. The `--cwd` form is reserved for commands whose `cwd` doesn't matter (test, lint, format). Update U6's script table accordingly during implementation.

---

## Risks & Mitigations

- **Risk: `process.cwd()` divergence breaking `output/` path.** Documented above; resolved by Option C in U6.
- **Risk: Bun workspace symlink for `@scribd-dl/shared` not resolving in `puppeteer`-spawned child contexts.** Puppeteer launches Chromium as a subprocess but doesn't load shared types at runtime (types are erased). Low risk.
- **Risk: oxlint/oxfmt globs miss files after move.** Mitigated by the user's prior monorepo experience with the same tools (confirmed in brainstorm). Run `bun run lint` and verify expected file count is non-zero before merging.
- **Risk: Vite's `@/*` alias breaks under workspace path resolution.** Vite resolves `@` relative to the Vite config file's location, which is now `apps/web/vite.config.ts`. The alias resolves to `apps/web/src` — unchanged from before relative to its config. Low risk.
- **Risk: Tests under `packages/engine/test/` reference paths via `import.meta.dir` or fixtures that assume old layout.** Mitigated by U3's verification — run `bun test` after the move and fix any path-relative fixtures.
- **Risk: User pulls the branch mid-flight on another machine with `node_modules` cached from the old layout.** `bun install` with the new workspaces config handles this correctly; document in PR description that contributors should `rm -rf node_modules app/node_modules && bun install` after pull.

---

## Dependencies / Assumptions

- Bun 1.3.14 workspaces handle the dep set (Effect, Puppeteer, Vite, React 19) cleanly. If a specific peer-dep issue surfaces, fix in-place rather than abandoning the plan.
- `oxlint`/`oxfmt` handle the new glob patterns — confirmed by user's other monorepo project.
- `puppeteer` does not encode the engine's pre-migration path anywhere persistent (it doesn't — Chromium cache is in `~/.cache/puppeteer/`).
- The `tauri://localhost` CORS allow-list in `src/server/HttpServerLive.ts` (now `packages/engine/src/server/HttpServerLive.ts`) does not need changes — Tauri integration is out of scope.

---

## Open Questions

None blocking. All brainstorm-outstanding questions were resolved during dialogue:
- Migration strategy: single PR (KTD).
- `links.md`: delete (R7).
- `docs/`, `output/`: stay at root (R7, refined by Option C in System-Wide Impact).
- Internal versioning: `workspace:*` (KTD).
- `oxlint`/`oxfmt` compatibility: confirmed via user's other project.
- `apps/desktop` timing: stub now, per U5 (KTD).
- Shared package naming: `@scribd-dl/shared` (settled in KTDs).

---

## Verification

After all units land:

1. `rm -rf node_modules app/node_modules packages/*/node_modules apps/*/node_modules && bun install` produces exactly one `bun.lock` at repo root and one hoisted `node_modules/`.
2. `bun test` at repo root runs both `packages/engine/test/` (via `bun:test`) and `apps/web/test/` (via vitest); all pass.
3. `bun run lint` and `bun run format:check` clean.
4. `grep -rn "JobEvent\|EngineSnapshot\|JobId\b" packages/engine/src/ apps/web/src/ | grep -v "@scribd-dl/shared"` returns no lines defining or duplicating these types (only imports).
5. Temporarily breaking a field in `packages/shared/src/jobs.ts` causes type errors in both `packages/engine` and `apps/web` (acceptance for R3).
6. `bun start <url>` downloads to `./output/` at repo root (acceptance for R6 path semantics and Option C).
7. `bun run tui` launches Ink TUI.
8. `bun run engine` boots HTTP server; `curl localhost:4747/snapshot` returns valid JSON matching `EngineSnapshot`.
9. `bun run dev:spa` brings up engine + Vite together.
10. `./docker-download.sh <url>` succeeds.
11. `apps/desktop/package.json` and `README.md` exist; no other files in `apps/desktop/`.
12. `links.md` no longer in the repo.
