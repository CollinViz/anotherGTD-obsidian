---
name: another-gtd
description: >-
  another-gtd is a GTD (Getting Things Done) task system backed by an Obsidian
  vault. Use these tools to capture and read tasks: add to the inbox, add to a
  project, and list tasks by bucket, plus manage contexts and board columns.
  Everything new lands in the Inbox first and is clarified later — never file a
  new task straight into a work bucket.
---

# another-gtd skill

another-gtd runs as an MCP server exposing an Obsidian vault's task system to an
AI agent. Tasks live in the vault notes as `#task` lines; filing state (bucket,
context, priority, due, project) lives in the plugin's `data.json`. The MCP
server reads both and writes only what the plugin can safely absorb.

## Setup (one time)

1. `npm install` inside `integrations/` (installs the MCP SDK).
2. Set `OBSIDIAN_VAULT` to your vault path in `integrations/.env` (gitignored).
   Optionally `OBSIDIAN_CONFIG_DIR` if the config folder isn't `.obsidian`.
3. Start: `node integrations/mcp-server.mjs` (stdio). Register it in the MCP
   client as:
   ```json
   {
     "mcpServers": {
       "another-gtd": {
         "command": "node",
         "args": ["/abs/path/integrations/mcp-server.mjs"]
       }
     }
   }
   ```

## Tools

| Tool             | Purpose                                                                                      | Key params                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `add_to_inbox`   | Capture a new task. It lands in **Inbox** to be clarified.                                   | `text` (required), `context?`, `priority?` (`"1"`-`"3"`), `due?` (`yyyy-mm-dd`)                                |
| `add_to_project` | Add a task under an existing project. Still lands in **Inbox** but carries the project link. | `project`, `text`, `context?`, `priority?`, `due?`                                                             |
| `list_tasks`     | List tasks in one bucket.                                                                    | `bucket` (one of: `inbox`, `next`, `project`, `waiting`, `scheduled`, `someday`, `reference`, `trash`, `done`) |
| `list_contexts`  | Show configured contexts.                                                                    | —                                                                                                              |
| `add_context`    | Add a context (e.g. `@calls`).                                                               | `context`                                                                                                      |
| `list_columns`   | Show board columns.                                                                          | —                                                                                                              |
| `add_column`     | Add a board column (a bucket id).                                                            | `column`                                                                                                       |

## GTD workflow (follow this)

- **Capture first, clarify later.** New tasks always go to the **Inbox**. Use
  `add_to_inbox` for anything captured. Never file a new task directly into
  Next / Waiting / Scheduled — the clarify step is a human decision.
- `add_to_project` attaches the task to an existing project _and_ leaves it in
  Inbox, so it shows up as an unclarified action belonging to that project.
  The project must already be filed under Projects.
- When someone asks for "inbox", "projects", "reference", "next", etc., call
  `list_tasks` with that bucket.
- Add a context before assigning it to tasks if it isn't in `list_contexts`.

## Notes and caveats

- Priority is `"1"` (high), `"2"` (medium), `"3"` (low). Omit for none.
- `due` must be `yyyy-mm-dd`.
- Reads of `data.json` are retried on a torn/partial file; writes are atomic.
- If Obsidian is open, its plugin polls and merges MCP changes within ~5s, so
  newly added context/priority/due appear on the cards automatically.
