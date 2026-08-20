import { Bucket, GtdSettings, Task } from "./types";

export const CHECKBOX_RE =
	/^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX/-])\]\s+(.*)$/;

/** Marks a project line that has also been filed under Next. */
export const HANDLED_RE = /\*{1,2}\s*\(handled\)\s*\*{1,2}/gi;

export function isTaskLine(line: string): boolean {
	return CHECKBOX_RE.test(line);
}

/** A `[[Name]]` line in the projects index (30_projects.md). */
export function projectLinkName(line: string): string | undefined {
	const m = line.match(/^\s*\[\[([^[\]\n]+)\]\]\s*$/);
	return m?.[1].trim() || undefined;
}

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function indentOf(line: string): number {
	let n = 0;
	for (const ch of line) {
		if (ch === " ") n += 1;
		else if (ch === "\t") n += 4;
		else break;
	}
	return n;
}

/** Stable hash for task identity. */
function hash(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h) ^ s.charCodeAt(i);
	}
	let g = 52711;
	for (let i = s.length - 1; i >= 0; i--) {
		g = ((g << 5) + g) ^ s.charCodeAt(i);
	}
	return (
		(h >>> 0).toString(36).padStart(7, "0") +
		(g >>> 0).toString(36).padStart(7, "0")
	);
}

export function taskId(path: string, text: string, occurrence: number): string {
	const key =
		path + "\u0000" + text.toLowerCase() + (occurrence > 0 ? "\u0000" + occurrence : "");
	return hash(key);
}

export function parseTaskLine(raw: string): {
	prefix: string;
	state: string;
	body: string;
	rest: string;
	blockId: string;
} {
	const m = raw.match(CHECKBOX_RE);
	if (!m) {
		return { prefix: "- [ ] ", state: " ", body: cleanTaskText(raw), rest: raw.trim(), blockId: "" };
	}
	const rest = m[3];
	const prefix = raw.slice(0, raw.length - rest.length);
	const blockId = (rest.match(/(\s+\^[\w-]+)\s*$/)?.[1]) ?? "";
	const text = blockId ? rest.slice(0, rest.length - blockId.length) : rest;
	const body = cleanTaskText(raw);
	return { prefix, state: m[2], body, rest: text, blockId };
}

/** Remove functional tags and whitespace from a task line. */
export function cleanTaskText(raw: string, contexts: string[] = []): string {
	let t = raw;
	t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX/-]\]\s*/, "");
	t = t.replace(HANDLED_RE, "");
	t = t.replace(/\s+\^[\w-]+\s*$/, "");
	t = t.replace(/#due\([^)]*\)/gi, "");
	t = t.replace(/#waiting-on:[^#\s]*/gi, "");
	t = t.replace(/#(urgent|not-urgent|important|not-important)\b/gi, "");
	for (const ctx of contexts) {
		const bare = ctx.replace(/^@/, "");
		t = t.replace(new RegExp("#@?" + escapeRegex(bare) + "\\b", "gi"), "");
	}
	t = t.replace(/\s+/g, " ").trim();
	return t.replace(/\s+([.,;:!?])/g, "$1").trim();
}

export function extractDue(line: string): string | undefined {
	const m = line.match(/#due\(([^)]*)\)/i);
	if (!m) return undefined;
	const v = m[1].trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

export function extractWaiting(line: string): string | undefined {
	const m = line.match(/#waiting-on:\s*([^#\s].*?)(?=\s+#|\s*$)/i);
	return m?.[1].trim();
}

export function extractUrgent(line: string): boolean | undefined {
	const m = line.match(/#(urgent|not-urgent)\b/i);
	if (!m) return undefined;
	return m[1].toLowerCase() === "urgent";
}

export function extractImportant(line: string): boolean | undefined {
	const m = line.match(/#(important|not-important)\b/i);
	if (!m) return undefined;
	return m[1].toLowerCase() === "important";
}

export function extractContext(line: string, contexts: string[]): string | undefined {
	for (const ctx of contexts) {
		const bare = ctx.replace(/^@/, "");
		const re = new RegExp("#@?" + escapeRegex(bare) + "\\b", "i");
		if (re.test(line)) return ctx;
	}
	return undefined;
}

export function contextsFromHeadings(content: string): string[] {
	const out: string[] = [];
	for (const line of content.split("\n")) {
		const m = line.match(/^##\s+@(.+)$/);
		if (m) out.push(m[1].trim());
	}
	return out;
}

export function assignParents(tasks: Task[], lines: string[]): void {
	const stack: Array<{ indent: number; id: string }> = [];
	let prev = -1;

	for (const task of tasks) {
		for (let i = prev + 1; i < task.line; i++) {
			const line = lines[i];
			if (line === undefined || line.trim() === "") continue;
			if (indentOf(line) === 0) {
				stack.length = 0;
				break;
			}
		}
		while (stack.length && stack[stack.length - 1].indent >= task.indent) {
			stack.pop();
		}
		task.parentId = stack.length ? stack[stack.length - 1].id : undefined;
		stack.push({ indent: task.indent, id: task.id });
		prev = task.line;
	}
}

export function bucketOf(path: string, settings: GtdSettings): Bucket {
	const f = settings.file;
	if (path === f.inbox) return "inbox";
	if (path === f.next) return "next";
	if (path === f.waiting) return "waiting";
	if (path === f.someday) return "someday";
	if (path === f.projects) return "project";
	if (path === f.trash) return "trash";
	if (path.startsWith(f.projectFolder + "/")) return "project";
	if (path.startsWith(f.reference + "/")) return "reference";
	return "inbox";
}

export function pathFor(bucket: Bucket, settings: GtdSettings): string | undefined {
	const f = settings.file;
	switch (bucket) {
		case "inbox":
			return f.inbox;
		case "next":
			return f.next;
		case "waiting":
			return f.waiting;
		case "someday":
			return f.someday;
		case "project":
			return f.projects;
		case "trash":
			return f.trash;
		case "reference":
			return f.reference;
		default:
			return undefined;
	}
}

export function projectPathForOutcome(text: string, settings: GtdSettings): string {
	const safe = text
		.replace(/[\\/:*?"<>|]/g, "-")
		.trim()
		.replace(/\s+/g, " ");
	return settings.file.projectFolder + "/" + safe + ".md";
}

export function projectNameFromPath(path: string, settings: GtdSettings): string | undefined {
	const folder = settings.file.projectFolder + "/";
	if (!path.startsWith(folder)) return undefined;
	const name = path.slice(folder.length).replace(/\.md$/i, "");
	return name || undefined;
}

export function scanFile(content: string, path: string, settings: GtdSettings): Task[] {
	const lines = content.split("\n");
	const out: Task[] = [];
	const seen = new Map<string, number>();
	let currentContext: string | undefined;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const cm = raw.match(/^##\s+@(.+)$/);
		if (cm) currentContext = cm[1].trim();
		if (path === settings.file.projects) {
			const linkName = projectLinkName(raw);
			if (linkName) {
				const key = linkName.toLowerCase();
				const occurrence = seen.get(key) ?? 0;
				seen.set(key, occurrence + 1);
				out.push({
					id: taskId(path, linkName, occurrence),
					path,
					line: i,
					raw,
					text: linkName,
					indent: indentOf(raw),
					done: false,
					bucket: "project",
				});
				continue;
			}
		}
		if (!isTaskLine(raw)) continue;

		const body = cleanTaskText(raw, settings.contexts);
		if (!body) continue;

		const key = body.toLowerCase();
		const occurrence = seen.get(key) ?? 0;
		seen.set(key, occurrence + 1);
		const state = raw.match(CHECKBOX_RE)![2];
		const bucket = bucketOf(path, settings);
		const task: Task = {
			id: taskId(path, body, occurrence),
			path,
			line: i,
			raw,
			text: body,
			indent: indentOf(raw),
			done: state.toLowerCase() === "x",
			bucket,
			handled: HANDLED_RE.test(raw),
			context: bucket === "next" ? currentContext : extractContext(raw, settings.contexts),
			urgent: extractUrgent(raw),
			important: extractImportant(raw),
			due: extractDue(raw),
			waitingFor: extractWaiting(raw),
		};
		out.push(task);
	}
	assignParents(out, lines);
	return out;
}

