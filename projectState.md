# Session state — Another GTD rewrite

Captured for a fresh session. Read this first, then `AGENTS.md`, `PLAN.md`,
`openItems.md`.

## Repo

- **New repo:** `/home/collin/workspace/anotherGTD-obsidian` (git, remote
  `CollinViz/anotherGTD-obsidian`, branch `main`, initial commit present).
- **Source of the rewrite:** `/home/collin/workspace/TaskLoops` (the v1
  baseline everything is derived from).
- **Vault/wiki (target files):** `/home/collin/wiki/gtd/` — already has
  `00_inbox.md`, `10_next-actions.md` (with `## @context` headings),
  `20_waiting-for.md`, `30_projects.md`, `40_someday-maybe.md`, `projects/`,
  `reference/`.

## Goal

White-room rewrite of TaskLoops: **UI and MCP stay identical; storage changes to
notes-as-truth.** A task's bucket = which file its line lives in; context = the
`## @context` heading (Next only); priority = explicit Eisenhower tags; done =
checkbox. `data.json` holds config only — the `items` map is deleted.

## What's done

- Scaffolded the new repo with everything Obsidian needs and verified it:
  - Build (`npm run build`) passes — tsc + eslint (1 non-fatal warning about
    `settings.ts` not using the declarative settings API) + esbuild.
  - Tests (`npm test`) pass — 112/112.
  - `main.js`, `manifest.json`, `styles.css` at root.
  - Plugin identity: id `another-gtd`, name `Another GTD`, version `0.1.0`,
    minAppVersion `1.7.2`.
- Carried over verbatim: build config, eslint, `.editorconfig`, `.npmrc`,
  `.gitignore`, `scripts/`, `test/`, `.github/workflows/release.yml`, `styles.css`,
  and the full v1 `src/` baseline + `integrations/` (deploy + MCP paths updated
  from `taskloops` → `another-gtd`).
- Wrote `PLAN.md` (§1–§13, phases 1–5) and `openItems.md` (12 decisions).
- Wrote `AGENTS.md` documenting the rewrite status.
- **2026-08-18: all 12 open decisions settled** (see `openItems.md`).
- **2026-08-18: phases 1–5 implemented** — `src/store.ts`, rewired UI,
  two-axis priority chips, MCP repoint, config-only `data.json` defaults,
  updated tests.

**Status:** the working plugin on `main` is now the **v2 notes-as-truth**
rewrite. `src/store.ts` handles bucket-file moves, `## @context` headings,
Eisenhower tags, due/waiting tags, checkbox toggles, trash, projects, and
context management. `data.json` holds config only.

## Settled encoding (Phase 1 inputs)

| Concern | Decision |
|---------|----------|
| Task marker | `- [ ]` / `- [x]` checkbox line |
| Due | `#due(yyyy-mm-dd)` |
| Waiting | file `20_waiting-for.md`; tag `#waiting-on: Name` |
| Priority | both axes always on line: `#urgent`\|`#not-urgent` + `#important`\|`#not-important`; optional P1…Pn colours in config only |
| Trash | `gtd/trash.md`, keep last 200 |
| Context sections | only on Next; delete context → items to inbox; config order syncs file |
| Projects | `30_projects.md` + `gtd/project/<name>.md`; checkbox = task; next-actions **duplicated** to Next; demote via context menu; project lines may carry context tag |
| Migration | **none** |
| `data.json` | config only (no `items`, no promotion tag) |

## Key files

- `PLAN.md` — the rewrite plan. §3 = data model; §6 = two-file move; §12 =
  decision table.
- `openItems.md` — all 12 decisions dated 2026-08-18.
- `AGENTS.md` — build/test/release commands, storage split table.
- `src/store.ts` — **does not exist yet.** Phase 1 deliverable.

## Next step

Verify the build in a real vault and exercise the board/list/calendar UIs,
project promote/demote, and MCP add/list tools.

## Conventions

- Tabs for indentation (`.editorconfig`).
- No code comments unless load-bearing; preserve existing ones.
- `npm run build` before committing (typecheck+lint+esbuild are one gate).
- Preserve a line's bullet/checkbox/indent/tag/block-id formatting exactly when
  rewriting.

(End of file)
