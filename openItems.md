# Open decisions

Working file for the notes-as-truth rewrite. Each item has a recommendation and
the alternatives; mark a decision and its date when you settle it. These block
parts of `PLAN.md` Phase 1, so settling the storage-encoding ones first is what
unblocks the file engine.

**Status: all 12 settled 2026-08-18.** Phase 1 unblocked.

---

## Storage encoding (block Phase 1)

### 1. What marks a line as a task?

- **Recommendation:** a `- [ ]` unchecked line is a task. Priority, due and
  waiting tags are optional decorations.
- Why: your wiki uses `- [ ]` lines with `#not-urgent`-style tags, not `#task`.
  It removes the `#task` tag entirely and matches how you already write notes.
- Alternatives: keep `#task` as the trigger (children like `#task/work`); or
  "any line carrying a priority/due/waiting tag"; or a configurable tag.
- **Decision (2026-08-18):** a `- [ ]` / `- [x]` checkbox line is a task.
  Priority, due and waiting tags are optional decorations. No `#task` tag.

### 2. Due-date syntax on the line

- **Recommendation:** `#due(yyyy-mm-dd)` — parse-able, unambiguous, greppable.
- Alternatives: `📅 2026-08-25` (pretty, harder to parse); a bare ISO date with
  a marker; a `due:` inline field. Whatever we pick becomes a configurable
  literal (`dueSyntax`) with a lenient parser.
- **Decision (2026-08-18):** `#due(yyyy-mm-dd)`. Configurable via `dueSyntax`.

### 3. Waiting-on syntax on the line

- **Recommendation:** `#waiting-on/Name` — the person's name becomes part of
  the tag path, like contexts.
- Alternatives: inline text after a delimiter ("— waiting on Bob"); a separate
  `#waiting-on/Name` vs `#waiting-on: Name`.
- **Decision (2026-08-18):** bucket file is `20_waiting-for.md`; tag on the line
  is `#waiting-on: Name` (colon form, not slash).

### 4. Urgent / important default state

- **Recommendation:** absent = "not urgent, not important" (least noise in your
  inbox). Only add `#urgent` / `#important` tags when true.
- Alternatives: every task must carry both tags explicitly (quadrants always
  visible, but noisier); use `#not-urgent`/`#not-important` presence to mean
  the negative.
- **Decision (2026-08-18):** every task carries both axes explicitly. Allowed
  tags: `#urgent` | `#not-urgent` and `#important` | `#not-important`. This is
  the GTD cornerstone (see also #9). No implicit default from absence.

### 5. Trash handling

- **Recommendation:** move the line to `gtd/trash.md` so trashing is undoable.
- Alternatives: delete the line outright; a `gtd/recycle/` folder of files.
- **Decision (2026-08-18):** move the line to `gtd/trash.md` (undo buffer).
  Keep only the last **200** items; auto-delete older lines.

### 6. Contexts on non-next buckets

- **Recommendation:** a context on Waiting / Scheduled / Project is just a tag
  on the line (`#@home`), not a `## @context` section. Only Next groups by
  section headings. Context remains mandatory for Next (your rule).
- Alternatives: contexts only ever exist on Next; no context tags elsewhere.
- **Decision (2026-08-18):** contexts as `## @context` sections exist **only on
  Next** (`10_next-actions.md`). No context section tags on other buckets.
  Exception for promote-flow metadata: project action lines may carry a context
  tag (e.g. `#office`) so filing/duplicating into Next knows the section
  (see #8, #10) — that is line decoration for the next-action handoff, not a
  non-Next context section.

---

## Project model

### 7. Project representation

- **Recommendation:** `30_projects.md` keeps one line per project (the outcome)
  and each project's actions live in `gtd/project/<name>.md`, indented under
  the project's line. Indentation inference links them (existing `assignParents`).
- Alternatives: all projects and actions inline in `30_projects.md` (no
  separate files); project as a `[[wikilink]]` to an arbitrary note rather than
  a dedicated file.
- **Decision (2026-08-18):** as recommendation — `30_projects.md` = one line per
  project (outcome); actions in `gtd/project/<name>.md`, indented under the
  project line; `assignParents` indentation inference.

### 8. What counts as a "project" line vs an ordinary task line

- **Recommendation:** a line in a project file (or tagged `#project`) is a
  project; everything else is a task. Projects need a way to be recognised that
  isn't just being a heading.
- **Decision (2026-08-18):**
  - In `gtd/project/<name>.md`, a `- [ ]` unchecked line is an **actionable
    task**. Non-checkbox prose (scope of work, notes) is allowed and is not a
    task.
  - Actionable next-steps are **duplicated** into `10_next-actions.md` when
    they become next actions (source of truth for "do now" stays Next).
  - Project action lines may carry a context tag (e.g. `#office`) so the
    promote-to-Next path knows which `## @context` section to use.
  - Right-click / context menu: move a next-action back to its project file
    when it is no longer current (see #10).

---

## UI

### 9. Priority UI change scope

- **Recommendation:** replace the single P1/P2/P3 chip + left-edge colour with
  two independent chips (Urgent, Important) and four-quadrant card-edge
  colouring; calendar dots tint off the higher of the two axes. Everything else
  in the UI stays byte-identical.
- Alternatives: keep a single merged priority derived from both axes (loses the
  independence you asked for).
- **Decision (2026-08-18):**
  - **GTD priority (source of truth on the line):** only
    `#urgent` / `#not-urgent` / `#important` / `#not-important`. Two-axis chips
    - four-quadrant card edge. This is the cornerstone.
  - **Optional colour labels (config only, cosmetic):** `P1`…`Pn` entries in
    `data.json` as `{ name, color }` pairs (e.g. P1/red, P2/orange, P3/yellow,
    P4/blue). Names and colours are user-configurable. They do **not** replace
    the Eisenhower tags.

### 10. Context picker when filing to Next

- **Recommendation:** the clarify flow and ⋯ menu **block** "file to Next"
  until a context is chosen (no "No context" skip). Contexts list comes from
  config + the `## @context` headings already present in `10_next-actions.md`.
- Alternatives: allow a default/empty context but require one on drag.
- **Decision (2026-08-18):**
  - Block "file to Next" until a context is chosen (no skip). List = config +
    existing `## @context` headings in `10_next-actions.md`.
  - If `contexts` in `data.json` change (rename/reorder), update
    `10_next-actions.md` headings/order to match.
  - If the user **deletes** a context, move all items under that heading to
    **inbox** so they can re-sort.
  - Project actions may carry `#context` / e.g. `#office`; when promoted
    (duplicated) to Next, use that context section.
  - Context menu (right-click): send a next-action back to its project file
    when it cannot be done now.

---

## Migration & config

### 11. One-time migration scope

- **Recommendation:** on first load, ingest current `anotherGtd Inbox.md` lines
  and `data.json` items into the bucket files (`00_inbox.md`, etc.), adopt your
  existing `## @context` headings, then never touch `anotherGtd Inbox.md` again.
- Alternatives: start clean and require manual re-entry; only adopt the
  contexts, not the old items.
- **Decision (2026-08-18):** **no migration.** Fresh notes-as-truth; no ingest
  from anotherGtd Inbox / old `items`.

### 12. `data.json` config schema

- **Recommendation:** one settings object with `tag`, `contexts`,
  `boardColumns`, a `file` block (the six bucket paths + `projectFolder`),
  `priority.tags`, `dueSyntax`, and UI prefs (`lastBucket`, `lastMode`,
  `showFolder`, `captureNote`). No `items` key at all.
- **Decision (2026-08-18):** config-only object as recommended, plus:
  - `file.trash` → `gtd/trash.md`
  - `trash.keep` → `200` (undo-buffer cap)
  - `priority.tags` → the four Eisenhower literals
  - `priority.labels` → optional cosmetic P1…Pn `{ name, color }[]`
  - `dueSyntax` → `#due(yyyy-mm-dd)` default
  - waiting tag literal for `#waiting-on: Name`
  - No `items` key. No promotion `tag` key needed (task marker is checkbox).

---

## Notes

- All storage-encoding decisions settled 2026-08-18 — Phase 1 unblocked.
- Waiting syntax is **colon** (`#waiting-on: Name`), not slash.
- Eisenhower four-tags are mandatory on tasks; P-labels are colour only.
- Next-action ↔ project is a **duplicate/promote** relationship, not only a move.
