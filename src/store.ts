import { App } from "obsidian";
import { Bucket, GtdSettings, Task, JoinedTask } from "./types";
import {
	isTaskLine,
	parseTaskLine,
	escapeRegex,
	contextsFromHeadings,
	pathFor,
	projectNameFromPath,
	projectPathForOutcome,
	scanFile,
} from "./scanner";

function isENOENT(e: unknown): boolean {
	return e instanceof Error && (e as { code?: string }).code === "ENOENT";
}

export class TaskStore {
	app: App;
	settings: GtdSettings;

	constructor(app: App, settings: GtdSettings) {
		this.app = app;
		this.settings = settings;
	}

	private async read(path: string): Promise<string> {
		try {
			return await this.app.vault.adapter.read(path);
		} catch (e) {
			if (isENOENT(e)) return "";
			throw e;
		}
	}

	private async write(path: string, content: string): Promise<void> {
		await this.app.vault.adapter.write(path, content);
	}

	private async ensureDir(path: string): Promise<void> {
		const dir = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
		if (dir) await this.app.vault.adapter.mkdir(dir);
	}

	private async process(path: string, transform: (data: string) => string): Promise<void> {
		const content = await this.read(path);
		const next = transform(content);
		if (next !== content) await this.write(path, next);
	}

	private async ensureFile(path: string): Promise<void> {
		try {
			await this.app.vault.adapter.read(path);
		} catch (e) {
			if (isENOENT(e)) {
				await this.ensureDir(path);
				await this.write(path, "\n");
			} else throw e;
		}
	}

	private async rewriteLine(
		path: string,
		raw: string,
		fn: (line: string) => string
	): Promise<boolean> {
		let changed = false;
		await this.process(path, (data) => {
			const lines = data.split("\n");
			let idx = lines.indexOf(raw);
			if (idx === -1) {
				const matches: number[] = [];
				for (let i = 0; i < lines.length; i++) if (lines[i] === raw) matches.push(i);
				if (matches.length === 1) idx = matches[0];
			}
			if (idx === -1) return data;
			const next = fn(lines[idx]);
			if (next === lines[idx]) return data;
			lines[idx] = next;
			changed = true;
			return lines.join("\n");
		});
		return changed;
	}

	private async removeLine(path: string, raw: string): Promise<boolean> {
		let changed = false;
		await this.process(path, (data) => {
			const lines = data.split("\n");
			const idx = lines.indexOf(raw);
			if (idx === -1) return data;
			lines.splice(idx, 1);
			changed = true;
			return lines.join("\n");
		});
		return changed;
	}

	private async appendLine(path: string, line: string): Promise<void> {
		await this.process(path, (data) => {
			if (!data) return line + "\n";
			const gap = data.endsWith("\n") ? "" : "\n";
			return data + gap + line + "\n";
		});
	}

	private async insertUnderHeading(
		path: string,
		heading: string,
		line: string
	): Promise<void> {
		await this.process(path, (data) => {
			const lines = data.split("\n");
			let idx = lines.findIndex(
				(l) => l.trim().toLowerCase() === heading.trim().toLowerCase()
			);
			if (idx === -1) {
				lines.push("\n" + heading);
				idx = lines.length - 1;
			}
			let end = idx + 1;
			while (end < lines.length && !lines[end].match(/^#{1,6}\s/)) end++;
			lines.splice(end, 0, line);
			return lines.join("\n");
		});
	}

	private async insertUnderFirstLine(path: string, line: string): Promise<void> {
		await this.process(path, (data) => {
			const lines = data.split("\n");
			let idx = lines.findIndex((l) => isTaskLine(l));
			if (idx === -1) {
				lines.push(line);
			} else {
				lines.splice(idx + 1, 0, line);
			}
			return lines.join("\n");
		});
	}

	async scan(): Promise<Task[]> {
		const all: Task[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const content = await this.app.vault.cachedRead(file);
			all.push(...scanFile(content, file.path, this.settings));
		}
		const projectsMap = this.buildProjectMap(all);
		for (const task of all) {
			const name = projectNameFromPath(task.path, this.settings);
			if (name) {
				const uid = projectsMap.get(name);
				if (uid) task.projectUid = uid;
			}
		}
		return all;
	}

	private buildProjectMap(all: Task[]): Map<string, string> {
		const map = new Map<string, string>();
		for (const t of all) {
			if (t.bucket === "project" && t.path === this.settings.file.projects) {
				const expected = projectPathForOutcome(t.text, this.settings);
				const name = projectNameFromPath(expected, this.settings);
				if (name) map.set(name, t.id);
			}
		}
		return map;
	}

	async moveToBucket(
		task: Task,
		bucket: Bucket,
		opts: { context?: string; waitingFor?: string; project?: string } = {}
	): Promise<void> {
		if (task.bucket === bucket && bucket !== "next") {
			if (bucket === "waiting" && opts.waitingFor && opts.waitingFor !== task.waitingFor) {
				await this.setWaitingFor(task, opts.waitingFor);
			}
			return;
		}
		if (bucket === "next" && !opts.context) {
			if (task.context && this.settings.contexts.includes(task.context)) {
				opts.context = task.context;
			}
		}

		if (bucket === "next" && !opts.context) {
			throw new Error("Next requires a context.");
		}
		if (bucket === "waiting" && !opts.waitingFor) {
			throw new Error("Waiting requires a person.");
		}
		if (bucket === "project" && !opts.project) {
			throw new Error("Project requires a project.");
		}

		const targetPath =
			bucket === "project" && opts.project
				? this.settings.file.projectFolder + "/" + opts.project + ".md"
				: pathFor(bucket, this.settings);
		if (!targetPath) throw new Error("No target file for bucket " + bucket);
		await this.ensureFile(targetPath);

		const line = this.buildLine(task, {
			bucket,
			context: opts.context,
			waitingFor: opts.waitingFor,
		});
		await this.removeLine(task.path, task.raw);
		if (bucket === "next" && opts.context) {
			await this.insertUnderHeading(targetPath, "## " + opts.context, line);
		} else if (bucket === "project" && opts.project) {
			await this.insertUnderFirstLine(targetPath, line);
		} else {
			await this.appendLine(targetPath, line);
		}
		if (bucket === "trash") await this.trimTrash();
	}

	async toggleDone(task: Task): Promise<void> {
		await this.rewriteLine(task.path, task.raw, (line) =>
			line.replace(/\[[ xX/-]\]/, task.done ? "[ ]" : "[x]")
		);
	}

	async setDue(task: Task, iso: string | null): Promise<void> {
		await this.rewriteLine(task.path, task.raw, (line) => {
			const next = line.replace(/#due\([^)]*\)/gi, "").replace(/\s+$/g, "");
			if (!iso) return next;
			return next + " " + this.settings.dueSyntax.replace("yyyy-mm-dd", iso);
		});
	}

	async setWaitingFor(task: Task, who: string | null): Promise<void> {
		await this.rewriteLine(task.path, task.raw, (line) => {
			let next = line
				.replace(/#waiting-on:\s*[^#\s].*?(?=\s+#|\s*$)/gi, "")
				.replace(/\s+$/g, "");
			if (!who) return next;
			return next + " " + this.settings.waitingSyntax.replace("{name}", who);
		});
	}

	async setPriority(task: Task, urgent: boolean, important: boolean): Promise<void> {
		await this.rewriteLine(task.path, task.raw, (line) => {
			let next = line.replace(/#(urgent|not-urgent)\b/gi, "");
			next = next.replace(/#(important|not-important)\b/gi, "");
			next = next.replace(/\s+/g, " ").trim();
			const t = this.settings.priority.tags;
			next += " " + (urgent ? t.urgent : t.notUrgent);
			next += " " + (important ? t.important : t.notImportant);
			return next;
		});
	}

	async setContext(task: Task, context: string | null): Promise<void> {
		if (task.bucket === "next" && context) {
			await this.moveToBucket(task, "next", { context });
			return;
		}
		await this.rewriteLine(task.path, task.raw, (line) => {
			let next = line;
			for (const ctx of this.settings.contexts) {
				const bare = ctx.replace(/^@/, "");
				next = next.replace(new RegExp("#@?" + escapeRegex(bare) + "\\b", "gi"), "");
			}
			next = next.replace(/\s+/g, " ").trim();
			if (context) next += " #" + context;
			return next;
		});
	}

	async rename(task: Task, body: string): Promise<boolean> {
		const text = body.replace(/\s+/g, " ").trim();
		if (!text) return false;
		const parts = parseTaskLine(task.raw);
		const next = parts.prefix + text + (parts.blockId ? " " + parts.blockId : "");
		return this.rewriteLine(task.path, task.raw, () => next);
	}

	async reorder(path: string, order: Task[]): Promise<void> {
		if (order.length === 0) return;
		await this.process(path, (data) => {
			const lines = data.split("\n");
			const taskLines = order.map((t) => t.raw);
			const tasksSet = new Set(taskLines);
			const filtered = lines.filter((l: string) => !tasksSet.has(l));
			const idx = lines.findIndex((l: string) => tasksSet.has(l));
			if (idx === -1) return data;
			filtered.splice(idx, 0, ...taskLines);
			return filtered.join("\n");
		});
	}

	async trash(task: Task): Promise<void> {
		await this.moveToBucket(task, "trash");
	}

	async capture(
		text: string,
		bucket: Bucket = "inbox",
		opts: { context?: string; project?: string; due?: string } = {}
	): Promise<Task> {
		const safe = text.replace(/\s+/g, " ").trim();
		const line = this.buildLine(
			{ text: text.replace(/\s+/g, " ").trim(), raw: "", done: false },
			{ bucket, context: opts.context, due: opts.due }
		);
		if (opts.project) {
			const path = this.settings.file.projectFolder + "/" + opts.project + ".md";
			await this.ensureFile(path);
			await this.insertUnderFirstLine(path, line);
		} else {
			await this.ensureFile(this.settings.file.inbox);
			await this.appendLine(this.settings.file.inbox, line);
		}
		return { text: safe, raw: line, bucket, path: "", line: 0, indent: 0, done: false, id: "" };
	}

	async createProject(text: string): Promise<Task> {
		const safe = text.replace(/\s+/g, " ").trim();
		const indexLine = this.buildLine(
			{ text: safe, raw: "", done: false },
			{ bucket: "project" }
		);
		await this.ensureFile(this.settings.file.projects);
		await this.appendLine(this.settings.file.projects, indexLine);
		const projectPath = projectPathForOutcome(safe, this.settings);
		await this.ensureFile(projectPath);
		const parentLine = this.buildLine(
			{ text: safe, raw: "", done: false },
			{ bucket: "project" }
		);
		await this.write(projectPath, parentLine + "\n\n");
		return { text: safe, raw: indexLine, bucket: "project", path: this.settings.file.projects, line: 0, indent: 0, done: false, id: "" };
	}

	async convertToProject(task: Task): Promise<Task> {
		await this.removeLine(task.path, task.raw);
		return this.createProject(task.text);
	}

	async addProjectAction(projectName: string, text: string): Promise<Task> {
		const path = this.settings.file.projectFolder + "/" + projectName + ".md";
		await this.ensureFile(path);
		const safe = text.replace(/\s+/g, " ").trim();
		const line = this.buildLine(
			{ text: text.replace(/\s+/g, " ").trim(), raw: "", done: false },
			{ bucket: "project" }
		);
		await this.insertUnderFirstLine(path, "\t" + line);
		return { text: safe, raw: "\t" + line, bucket: "project", path, line: 0, indent: 0, done: false, id: "" };
	}

	async promoteToNext(task: Task, context: string): Promise<void> {
		if (task.bucket === "next") return;
		await this.ensureContext(context);
		const line = this.buildLine(task, { bucket: "next", context });
		await this.ensureFile(this.settings.file.next);
		await this.insertUnderHeading(this.settings.file.next, "## " + context, line);
	}

	async demoteFromNext(task: Task): Promise<void> {
		if (task.bucket !== "next") return;
		await this.removeLine(task.path, task.raw);
	}

	async ensureContext(context: string): Promise<void> {
		const ctx = context.startsWith("@") ? context : "@" + context;
		if (!this.settings.contexts.includes(ctx)) {
			this.settings.contexts.push(ctx);
		}
		await this.ensureFile(this.settings.file.next);
		await this.process(this.settings.file.next, (data) => {
			const lines = data.split("\n");
			const heading = "## " + ctx;
			if (lines.some((l: string) => l.trim() === heading)) return data;
			lines.push("\n" + heading);
			return lines.join("\n");
		});
	}

	async renameContext(oldName: string, newName: string): Promise<void> {
		const oldH = oldName.startsWith("@") ? oldName : "@" + oldName;
		const newH = newName.startsWith("@") ? newName : "@" + newName;
		this.settings.contexts = this.settings.contexts.map((c: string) =>
			c === oldH || c === "@" + oldName ? newH : c
		);
		await this.process(this.settings.file.next, (data) => {
			const lines = data.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].trim() === "## " + oldH) lines[i] = "## " + newH;
			}
			return lines.join("\n");
		});
	}

	async deleteContext(context: string): Promise<void> {
		const ctx = context.startsWith("@") ? context : "@" + context;
		this.settings.contexts = this.settings.contexts.filter((c: string) => c !== ctx);
		await this.ensureFile(this.settings.file.inbox);
		await this.ensureFile(this.settings.file.next);
		const lines = (await this.read(this.settings.file.next)).split("\n");
		const heading = "## " + ctx;
		let idx = lines.findIndex((l: string) => l.trim() === heading);
		if (idx === -1) return;
		let end = idx + 1;
		const toMove: string[] = [];
		while (end < lines.length && !lines[end].match(/^#{1,6}\s/)) {
			const line = lines[end];
			if (isTaskLine(line)) toMove.push(line.replace(/^\s+/, ""));
			end++;
		}
		lines.splice(idx, end - idx);
		await this.write(this.settings.file.next, lines.join("\n"));
		for (const line of toMove) await this.appendLine(this.settings.file.inbox, line);
	}

	async syncContexts(): Promise<void> {
		await this.ensureFile(this.settings.file.next);
		const headings = contextsFromHeadings(await this.read(this.settings.file.next));
		for (const h of headings) {
			const ctx = h.startsWith("@") ? h : "@" + h;
			if (!this.settings.contexts.includes(ctx)) this.settings.contexts.push(ctx);
		}
		for (const ctx of this.settings.contexts) {
			await this.ensureContext(ctx);
		}
	}

	async trimTrash(): Promise<void> {
		const path = this.settings.file.trash;
		await this.process(path, (data) => {
			const lines = data.split("\n");
			const keep = this.settings.trash.keep;
			if (lines.length <= keep) return data;
			const taskLines = lines.filter((l: string) => isTaskLine(l));
			if (taskLines.length <= keep) return data;
			const drop = taskLines.length - keep;
			let removed = 0;
			return lines
				.filter((l: string) => {
					if (isTaskLine(l) && removed < drop) {
						removed++;
						return false;
					}
					return true;
				})
				.join("\n");
		});
	}

	private buildLine(
		task: { raw?: string; text: string; done?: boolean },
		opts: {
			bucket: Bucket;
			context?: string;
			waitingFor?: string | null;
			due?: string;
		}
	): string {
		const parts = task.raw ? parseTaskLine(task.raw) : undefined;
		const prefix = parts?.prefix ?? "- [ ] ";
		const state = parts?.state ?? (task.done ? "x" : " ");
		const body = task.text;
		let tail = "";
		const p = this.settings.priority.tags;
		if (opts.bucket !== "next") {
			tail += " " + p.notUrgent + " " + p.notImportant;
		}
		if (opts.context && opts.bucket !== "next") tail += " #" + opts.context;
		if (opts.due) tail += " " + this.settings.dueSyntax.replace("yyyy-mm-dd", opts.due);
		if (opts.waitingFor) tail += " " + this.settings.waitingSyntax.replace("{name}", opts.waitingFor);
		if (parts?.blockId) tail += " " + parts.blockId;
		return prefix.replace(/\[[ xX/-]\]/, "[" + state + "]") + body + tail;
	}
}

export function toJoined(task: Task): JoinedTask {
	return { ...task, item: task, projectUid: task.projectUid };
}
