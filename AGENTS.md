# AGENTS.md

Obsidian GTD plugin (TypeScript + esbuild). Rewrite of TaskLoops: **notes are the source of truth** (bucket = which file the line is in; context = `## @context` heading; priority = `#urgent`/`#important`; done = checkbox). `data.json` is config only — never per-task state.

Working code on `main` is now the v2 notes-as-truth rewrite. `src/store.ts` is the write engine. `src/main.ts` no longer keeps an `items` map; `data.json` holds config only.

## Commands

- `npm run build` — **gate before commit**: `tsc -noEmit -skipLibCheck` → `eslint .` → esbuild production. No separate typecheck script.
- `npm run lint` — ESLint only (type-aware + `eslint-plugin-obsidianmd`). `obsidianmd/ui/sentence-case` is off (product name / tag literals).
- `npm test` — `node test/run.mjs`: esbuild-bundles `src/store.ts` against `test/obsidian-stub.mjs`, runs every `test/*.test.mjs`. No single-file test flag; add suites as `*.test.mjs`.
- `npm run dev` — esbuild watch, inline sourcemaps, non-minified `main.js`.
- `npm run deploy` — build, then copy `main.js` / `manifest.json` / `styles.css` → `$vault/$OBSIDIAN_CONFIG_DIR/plugins/another-gtd` (default config dir `.obsidian`). Vault path: `OBSIDIAN_VAULT` or gitignored `.vault-path`. **Never copies `data.json`.**

## Build output

Root `main.js` (+ map), `styles.css`, `manifest.json` are what Obsidian loads. `main.js` / map / `test/.bundle.mjs` are gitignored — do not hand-edit. `styles.css` and `manifest.json` are tracked.

## Release

- `npm version patch` (then push tags). `.npmrc` has `tag-version-prefix=""` → bare version tag, **no `v`** (Obsidian requirement).
- `version` script runs `scripts/version-bump.mjs` and stages `manifest.json` + `versions.json` — do not bump those by hand.
- Tag push → `.github/workflows/release.yml`: `lint` → `test` → `build` → tag must equal `manifest.json` version → **draft** GitHub release with the three plugin files.

## Architecture (agent-relevant)

- Entry: `src/main.ts` (plugin + store). UI is hand-DOM, no framework: `view.ts` + `board.ts` / `calendar.ts` via `PanelHost` (`host.ts`).
- `src/store.ts` — bucket↔file moves, insert-under-`## @context`, reorder, checkbox/tag edits (Eisenhower, due, waiting-on). Every edit re-finds the line by exact prior text.
- `src/scanner.ts` — checkbox task detection, identity, line-part parsing, context/priority/due/waiting extraction.
- Plugin id / deploy folder: `another-gtd`.

### Target storage (v2 — see `PLAN.md`)

| State | Encoding |
|-------|----------|
| Bucket | file: `00_inbox.md`, `10_next-actions.md`, `20_waiting-for.md`, `40_someday-maybe.md`, `30_projects.md` + `projects/`, `reference/` |
| Context | `## @context` heading (mandatory on Next) |
| Priority / due / waiting | `#urgent` `#not-urgent` `#important` `#not-important` / `#due(yyyy-mm-dd)` / `#waiting-on: Name` |
| Done / order / project | checkbox / physical line order / indent under project line / next-action duplicated into Next |
| Config only | `data.json` |

v1 `items` map and reconciliation go away when the rewrite lands.

## `integrations/`

Separate Node package (own `package.json` / `node_modules`). Not in root `build`/`test`. `cd integrations && npm install && npm start` (or `node mcp-server.mjs`). Vault: `OBSIDIAN_VAULT` or `integrations/.env` (gitignored). v2 path writes notes, not `items`.

## Conventions

- Tabs (`.editorconfig`). No comments unless load-bearing; keep existing ones.
- Never strip/reformat task-line chrome when rewriting a line.
