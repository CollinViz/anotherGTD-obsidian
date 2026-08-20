/**
 * MCP server exposing anotherGtd to external agents (e.g. Hermes).
 *
 * Run:  node integrations/mcp-server.mjs
 * Vault is read from integrations/.env (OBSIDIAN_VAULT) or the environment.
 * Uses the stdio transport, so register it in your MCP client as:
 *   mcpServers: { anotherGtd: { command: "node", args: ["integrations/mcp-server.mjs"] } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as core from "./core.mjs";

const server = new McpServer({
	name: "anotherGtd",
	version: "0.1.0",
});

const BUCKET_ENUM = z.enum([
	"inbox", "next", "project", "waiting", "someday", "reference", "trash", "done",
]);

const fmt = (tasks) =>
	tasks.length === 0
		? "No tasks."
		: tasks
			.map(
				(t) =>
					`- ${t.text}${t.project ? "  [project: " + t.project + "]" : ""}` +
					`${t.context ? "  {" + t.context + "}" : ""}` +
					`${t.urgent ? " U" : ""}${t.important ? " I" : ""}` +
					`${t.due ? "  (due " + t.due + ")" : ""}` +
					`${t.bucket ? "  -> " + t.bucket : ""}  @ ${t.path}:${t.line}`
			)
			.join("\n");

const prioritySchema = z
	.enum(["1", "2", "3"])
	.describe("Priority: 1 high, 2 medium, 3 low")
	.optional();
const dueSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd")
	.describe("Due date, yyyy-mm-dd")
	.optional();

server.tool(
	"add_to_inbox",
	"Add a new task to the anotherGtd inbox. It will be filed under Inbox until clarified. Optionally set its context, priority and due date.",
	{
		text: z.string().min(1).describe("The task text"),
		context: z.string().describe("A context, e.g. @computer").optional(),
		priority: prioritySchema,
		due: dueSchema,
	},
	async ({ text, context, priority, due }) => {
		const { note, line } = await core.addToInbox(text, { context, priority, due });
		const opts = [context, priority, due].filter(Boolean).join(", ");
		return {
			content: [
				{
					type: "text",
					text: `Added to ${note}:\n${line}${opts ? "\n  with " + opts : ""}`,
				},
			],
		};
	}
);

server.tool(
	"add_to_project",
	"Add a task under an existing project. The project must already be filed under Projects. Optionally set its context, priority and due date.",
	{
		project: z.string().describe("Name of the project (must exist under Projects)"),
		text: z.string().min(1).describe("The task text"),
		context: z.string().describe("A context, e.g. @computer").optional(),
		priority: prioritySchema,
		due: dueSchema,
	},
	async ({ project, text, context, priority, due }) => {
		const { note, line } = await core.addToProject(project, text, { context, priority, due });
		const opts = [context, priority, due].filter(Boolean).join(", ");
		return {
			content: [
				{
					type: "text",
					text: `Added to project "${project}" in ${note}:\n${line}${opts ? "\n  with " + opts : ""}`,
				},
			],
		};
	}
);

server.tool(
	"list_tasks",
	"List tasks in a anotherGtd bucket (inbox, project, next, waiting, someday, reference, trash, done).",
	{ bucket: BUCKET_ENUM.describe("Which bucket to list") },
	async ({ bucket }) => {
		const tasks = await core.listTasks(bucket);
		return { content: [{ type: "text", text: fmt(tasks) }] };
	}
);

server.tool(
	"list_contexts",
	"List the available contexts configured in anotherGtd.",
	{},
	async () => {
		const contexts = await core.listContexts();
		return { content: [{ type: "text", text: contexts.join(", ") || "No contexts configured." }] };
	}
);

server.tool(
	"add_context",
	"Add a new context to anotherGtd. Stored in data.json; the plugin merges it in even if Obsidian is running.",
	{ context: z.string().min(1).describe("The context name, e.g. @errands") },
	async ({ context }) => {
		const result = await core.addContext(context);
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
	}
);

server.tool(
	"list_columns",
	"List the board columns configured in anotherGtd.",
	{},
	async () => {
		const columns = await core.listColumns();
		return { content: [{ type: "text", text: columns.join(", ") || "No board columns configured." }] };
	}
);

server.tool(
	"add_column",
	"Add a board column to anotherGtd. Stored in data.json; the plugin merges it in even if Obsidian is running.",
	{ column: z.string().min(1).describe("A bucket id: inbox, next, project, waiting, someday, reference, trash, done") },
	async ({ column }) => {
		const result = await core.addColumn(column);
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
