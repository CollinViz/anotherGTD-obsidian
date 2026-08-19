# Another GTD — rewrite plan (notes-as-truth)

White-room rewrite of TaskLoops into this repo. The UI and the MCP stay; the
storage model changes: **the notes become the single source of truth for all
task state**, and `data.json` shrinks to configuration only.

## 1. The core diagnosis

TaskLoops v1 keeps every task's filing state in `data.json` (`items`:
`bucket`, `context`, `waitingFor`, `due`, `done`, `priority`, `projectUid`,
`order`, `sortedAt`, `doneAt`) and only ever writes one thing to the notes —
the `*(Handled)*` marker.

This rewrite inverts that. A task's bucket is *which file its line lives in*,
its context is *which `## @context` heading it sits under*, its priority is its
tags, its done state is its checkbox. This isn't a storage swap — it deletes
most of the plugin's hardest code, because the whole reconciliation engine
(`maybeMergeExternal`, `rehomePath`, `reconcileAll`, `persist`, `uid`, `occ`
remapping) exists only because state was divorced from the notes.

## 2. What stays, untouched

- **The UI.** The view/board/calendar split, the `PanelHost` contract
  (`src/host.ts`), card rendering, drag-and-drop, the clarify wizard, the ⋯
  menu, the CSS container queries. We keep `view.ts`, `board.ts`,
  `calendar.ts`, `host.ts`, `wizard.ts`, `modals.ts`, `settings.ts`,
  `dates.ts`, `text.ts` as-is; only the action methods they call are rewired
  from JSON-writes to note-writes. Priority chip / card edge / calendar tint
  change in Phase 3 (two-axis Eisenhower + optional cosmetic P-labels).
- **The MCP integration** (`integrations/`). Same tool surface; the write path
  changes (notes instead of `data.json` items).
- **The scanner's note-safety discipline** — line re-location by exact text,
  byte-preserving rewrites. This is now *everything*, because every filing
  action is a note edit.

## 3. The new data model

### 3a. What stays in `data.json` — config only

| Key | Meaning | Notes |
|-----|---------|-------|
| `contexts` | ordered list offered in the picker; also the `## @context` headings to create/sync in Next | config; rename/reorder → rewrite headings; delete context → items → inbox |
| `boardColumns` | board columns + order | config |
| `file.inbox/.next/.waiting/.projects/.someday/.reference/.projectFolder/.trash` | bucket files + project folder + trash | defaults under `gtd/` |
| `trash.keep` | max lines retained in trash | default `200` (undo buffer) |
| `priority.tags` | Eisenhower literals | `#urgent` `#not-urgent` `#important` `#not-important` |
| `priority.labels` | optional cosmetic `{ name, color }[]` | e.g. P1/red … P4/blue — not GTD source of truth |
| `dueSyntax` | due-date tag shape | default `#due(yyyy-mm-dd)` |
| `waitingSyntax` | waiting-on tag shape | default `#waiting-on: Name` |
| `lastBucket`, `lastMode`, `showFolder`, `captureNote` | UI prefs | config |

No `items` key. No promotion `tag` key — a task is a checkbox line.

### 3b. What lives in the notes — all task state

| State | v1 location | v2 note-based encoding |
|-------|-------------|------------------------|
| Task identity | `#task` / items map | **`- [ ]` / `- [x]` checkbox line** |
| Bucket | `item.bucket` | **which file the line is in** |
| Context | `item.context` | `## @context` heading under Next only; optional context tag on project actions for promote |
| Priority | `item.priority` (P1/P2/P3) | **both axes explicit:** `#urgent`\|`#not-urgent` + `#important`\|`#not-important` |
| Due | `item.due` | `#due(yyyy-mm-dd)` tag, any bucket |
| Waiting on | `item.waitingFor` | `#waiting-on: Name` tag in `20_waiting-for.md` |
| Done | `item.done` | `- [ ]` → `- [x]` |
| Project link | `item.projectUid` | indentation under the project's line; next-actions **duplicated** into Next |
| Order | `item.order` | physical line order in the file |
| Handled marker | `*(Handled)*` | **dropped** — a sorted task *is* its line elsewhere |
| Trash | delete / JSON | move line to `gtd/trash.md` (cap 200) |

Deleting `items` removes `uid`, `id`, `occ`, `path`, `text`, `sortedAt`,
`doneAt`, `provisional`, `order`, `projectUid`, `context`, `waitingFor`,
`due`, `priority`, `done` — all gone from JSON.

## 4. Bucket → file mapping

```
inbox     → gtd/00_inbox.md
next      → gtd/10_next-actions.md        (grouped by ## @context)
waiting   → gtd/20_waiting-for.md         (tag: #waiting-on: Name)
someday   → gtd/40_someday-maybe.md
project   → gtd/30_projects.md             (index of project outcomes)
            gtd/project/<name>.md           (each project's file + actions)
reference → gtd/reference/                  (files, not lines)
trash     → gtd/trash.md                    (undo buffer, last 200 lines)
done      → checkbox → [x] in place        (a crossed task stays where it was)
```

## 5. Note-based encoding, per attribute

**Task marker.** A line is a task iff it is a markdown checkbox (`- [ ]` or
`- [x]`). Priority / due / waiting tags are optional decorations. Non-checkbox
prose in project files (scope of work, notes) is not a task.

**Context (mandatory for `next` only).** Filing to Next *requires* a context —
the clarify flow and the ⋯ menu block "next" until one is chosen (no "No
context" skip). The plugin ensures `## @context` exists in `10_next-actions.md`
(creating it and adding the context to config if new), then moves/inserts the
line under it. Contexts as sections exist **only on Next**. Config `contexts`
order/rename is synced into that file; **deleting a context moves its items to
inbox** for re-sort. Project action lines may carry a context tag (e.g.
`#office`) so promote-to-Next knows the section.

**Priority → urgent/important (GTD cornerstone).** Every task carries **both**
axes explicitly: `#urgent` or `#not-urgent`, and `#important` or
`#not-important`. Two independent chips; four-quadrant card-edge colouring;
calendar dots tint off the higher axis. Optional cosmetic **P-labels**
(`priority.labels` in config: name + colour) are UI chrome only — they do not
replace the Eisenhower tags on the line.

**Due date.** A single tag, `#due(yyyy-mm-dd)` (configurable literal, lenient
parser). Works in any bucket file; set/clear rewrites only that tag.

**Waiting on.** Bucket file `20_waiting-for.md`; person is the
`#waiting-on: Name` tag on the line (colon form). The file implies "waiting";
the name comes from the line.

**Done.** Toggling flips `[ ]`→`[x]` in place; a done task stays in its file.
No JSON.

**Trash.** Move the line to `gtd/trash.md`. Keep only the last 200 items;
auto-drop older lines. Undo = move back out of trash.

**Projects.** `30_projects.md` holds one line per project (the outcome). Each
project's content lives in `gtd/project/<name>.md`. In a project file, only
`- [ ]` lines are actionable tasks; other prose is scope/notes. Indentation
under the project line links children (`assignParents`). **Next actions are
duplicated** into `10_next-actions.md` (with context tag → section); a
right-click / context menu can send a next-action back to its project file when
it is no longer current. `isStalled` = the project file has no open `- [ ]`
child. `projectUid` / "Standalone" pinning disappears.

## 6. Drag & drop — the two-file move

This is the heart of the rewrite and the new risky write path.

1. Remove the line from its source file (re-locate by exact prior text).
2. Insert it into the target file at the right position (under the matching
   `## @context` for Next; after the parent for projects).
3. If the target requires an attribute the source lacks — **context for Next**,
   **person for Waiting**, **date for Scheduled** — the picker/menu runs first.

**Promote project → Next** may **duplicate** rather than only move, so the
project file still lists the action while Next holds the do-now copy. Demote
(next → project) is available from the context menu.

**Reordering** = rewriting one file's line order. Dragging A onto B physically
moves A's line to B's position, so order *is* file order — no `item.order`.

**Safety:** a move is committed only after the target write succeeds; on
failure abort and leave the source untouched. Keep the metadata-cache
ignore-own-writes guard (`writing` set) so the scan doesn't fight the move.

## 7. The clarify flow

Same steps, same look — only the last step differs:
- **Next** has no "No context" skip; a context must be chosen.
- **Project** files the task into the project's file indented under the line.
- **Two-minute / done** flips the checkbox.
- `FilePatch` is interpreted as note edits instead of JSON writes.

## 8. ⋯ menu — full coverage

Keep every current action, all backed by note edits: edit text, context
(required for next), priority → **Urgent / Not-urgent / Important /
Not-important** toggles, due date (Today/Tomorrow/week + picker), waiting-on,
part-of-project, re-file to any bucket, promote/demote project↔next, move to
trash, move to done. Nothing that can't be expressed in the note.

## 9. What disappears (net simplification)

- `items` map, `uid`, `occ`, `provisional`
- `maybeMergeExternal` (no per-task state to merge — only config arrays)
- `rehomePath` / reword reconciliation — a reword edits the line in place;
  links via indentation survive automatically
- `reconcileAll` deletion pruning — deleting the line *is* deleting the task
  (trash path is an explicit move)
- `persist()`, id-remapping on rename — a moved/renamed note carries its tasks
- One-time TaskLoops migration / `*(Handled)*` marker

## 10. MCP changes (`integrations/`)

Tool surface stays. Internally:
- `add_to_inbox` appends to `gtd/00_inbox.md` (not `captureNote`).
- `add_to_project` appends an indented child into `gtd/project/<name>.md`.
- `listTasks` derives bucket from file path, context from `## @context`
  heading, priority from Eisenhower tags, done from checkbox — no `data.json`
  join.
- `add_context` / `add_column` still write config-only to `data.json`; context
  add/reorder/delete also maintains `10_next-actions.md` (delete → items to
  inbox).
- `taskId`/`occ` replication and the atomic item-record write are deleted.

## 11. Migration

**None.** No ingest from TaskLoops Inbox or old `data.json` items. The v2
plugin adopts whatever is already in the bucket files and `## @context`
headings; config starts clean (or user-edited defaults).

## 12. Settled decisions

All open items settled 2026-08-18 — see `openItems.md` for full text.

| # | Decision |
|---|----------|
| 1 | Task = checkbox line (`- [ ]` / `- [x]`); tags optional |
| 2 | Due = `#due(yyyy-mm-dd)` |
| 3 | Waiting file `20_waiting-for.md`; tag `#waiting-on: Name` |
| 4 | Both Eisenhower axes always explicit on the line |
| 5 | Trash → `gtd/trash.md`, keep last 200 |
| 6 | `## @context` sections only on Next; project lines may carry context tag for promote |
| 7 | `30_projects.md` index + `gtd/project/<name>.md` actions |
| 8 | Checkbox = task in project files; next-actions **duplicated** to Next; demote via context menu |
| 9 | Eisenhower tags = priority truth; optional P1…Pn colour labels in config |
| 10 | Block Next without context; config↔file sync; delete context → inbox; project `#context` on promote |
| 11 | No migration |
| 12 | Config-only `data.json` (no `items`; no promotion tag key) |

## 13. Repo scaffolding & phases

Carried over from TaskLoops: TypeScript + esbuild + Obsidian config,
`.editorconfig` (tabs), `styles.css`/`manifest.json` at root, test harness
(`test/run.mjs` bundling against `obsidian-stub.mjs`), the release workflow,
and the lint config (sentence-case off).

**Phase 1 — Notes-as-truth core (`src/store.ts`).** Bucket-file map (incl.
trash + 200 cap), two-file move, insert-under-heading, reorder, checkbox flip,
tag add/remove (Eisenhower, due, waiting-on colon form), context
add/rename/reorder/delete (delete → inbox), project promote-duplicate /
demote. All re-locate by exact prior text. Extend the test suite to cover
move/edit/reorder/rewrite/trash paths.

**Phase 2 — Wire UI to the store.** Point `file()`, `toggleDone`, `reorder`,
`setContext`, `setDue`, `setWaitingFor`, `setPriority`, `linkToProject`,
`renameTask`, trash, promote/demote at the store; delete the JSON item logic.
Rendering largely unchanged until Phase 3.

**Phase 3 — Two-axis priority UI.** Swap the priority chip, card edge, calendar
tint to Urgent/Important (+ not- variants); optional P-label colours from
config.

**Phase 4 — MCP.** Repoint `core.mjs` at the store; delete the JSON-item
machinery.

**Phase 5 — Config defaults.** Wiki paths/headings as defaults; trim
`data.json` schema to config-only; no migration step.

(End of file)
