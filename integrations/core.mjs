import { readFileSync } from "fs";
import { readFile, writeFile, rename, mkdir, readdir } from "fs/promises";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
	const out = {};
	try {
		const raw = readFileSync(join(here, ".env"), "utf8");
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const eq = t.indexOf("=");
			if (eq === -1) continue;
			const key = t.slice(0, eq).trim();
			const value = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
			out[key] = value;
		}
	} catch {
		// fall through to process.env
	}
	return out;
}

export function vaultPath() {
	const env = loadEnv();
	const vault = process.env.OBSIDIAN_VAULT || env.OBSIDIAN_VAULT;
	if (!vault) {
		throw new Error(
			"No vault configured. Set OBSIDIAN_VAULT in integrations/.env (e.g. OBSIDIAN_VAULT=/home/collin/wiki)."
		);
	}
	return vault.replace(/\/+$/, "");
}

export function configDir() {
	const env = loadEnv();
	return (process.env.OBSIDIAN_CONFIG_DIR || env.OBSIDIAN_CONFIG_DIR || ".obsidian").replace(
		/^\/+|\/+$/g,
		""
	);
}

function dataPath() {
	return join(vaultPath(), configDir(), "plugins", "another-gtd", "data.json");
}

function relPath(abs) {
	return relative(vaultPath(), abs).replace(/\\/g, "/");
}

export async function readData() {
	let lastErr;
	for (let i = 0; i < 5; i++) {
		try {
			const raw = await readFile(dataPath(), "utf8");
			const parsed = JSON.parse(raw);
			return { settings: parsed.settings ?? {} };
		} catch (e) {
			if (e.code === "ENOENT") return { settings: {} };
			lastErr = e;
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error("Could not read data.json after retries: " + lastErr?.message);
}

async function writeData(data) {
	const path = dataPath();
	await mkdir(dirname(path), { recursive: true });
	const tmp = path + ".tmp-" + Date.now();
	await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
	await rename(tmp, path);
}

export async function readSettings() {
	const data = await readData();
	const s = data.settings ?? {};
	return {
		file: {
			inbox: s.file?.inbox ?? "gtd/00_inbox.md",
			next: s.file?.next ?? "gtd/10_next-actions.md",
			waiting: s.file?.waiting ?? "gtd/20_waiting-for.md",
			someday: s.file?.someday ?? "gtd/40_someday-maybe.md",
			projects: s.file?.projects ?? "gtd/30_projects.md",
			projectFolder: s.file?.projectFolder ?? "gtd/projects",
			reference: s.file?.reference ?? "gtd/reference",
			trash: s.file?.trash ?? "gtd/trash.md",
		},
		trash: { keep: s.trash?.keep ?? 200 },
		priority: {
			tags: {
				urgent: s.priority?.tags?.urgent ?? "#urgent",
				notUrgent: s.priority?.tags?.notUrgent ?? "#not-urgent",
				important: s.priority?.tags?.important ?? "#important",
				notImportant: s.priority?.tags?.notImportant ?? "#not-important",
			},
		},
		dueSyntax: s.dueSyntax ?? "#due(yyyy-mm-dd)",
		waitingSyntax: s.waitingSyntax ?? "#waiting-on: {name}",
		contexts: s.contexts ?? [],
		boardColumns: s.boardColumns ?? ["inbox", "next", "waiting", "someday", "done"],
		captureNote: s.captureNote ?? "gtd/00_inbox.md",
		showFolder: s.showFolder ?? false,
		lastBucket: s.lastBucket ?? "inbox",
		lastMode: s.lastMode ?? "list",
	};
}

async function readVault(abs) {
	try {
		return await readFile(abs, "utf8");
	} catch (e) {
		if (e.code === "ENOENT") return "";
		throw e;
	}
}

async function writeVault(abs, content) {
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, content);
}

function isTaskLine(line) {
	return /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX/-]\]\s+/.test(line);
}

function cleanText(raw, settings) {
	let t = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX/-]\]\s*/, "");
	t = t.replace(/\s+\^[\w-]+\s*$/, "");
	t = t.replace(/#due\([^)]*\)/gi, "");
	t = t.replace(/#waiting-on:[^#\s]*/gi, "");
	t = t.replace(/#(urgent|not-urgent|important|not-important)\b/gi, "");
	for (const ctx of settings.contexts) {
		const bare = ctx.replace(/^@/, "");
		t = t.replace(new RegExp("#@?" + escapeRegex(bare) + "\\b", "gi"), "");
	}
	t = t.replace(/\s+/g, " ").trim();
	return t.replace(/\s+([.,;:!?])/g, "$1").trim();
}

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bucketOf(path, file) {
	if (path === file.inbox) return "inbox";
	if (path === file.next) return "next";
	if (path === file.waiting) return "waiting";
	if (path === file.someday) return "someday";
	if (path === file.projects) return "project";
	if (path === file.trash) return "trash";
	if (path.startsWith(file.projectFolder + "/")) return "project";
	if (path.startsWith(file.reference + "/")) return "reference";
	return "inbox";
}

function extractDue(line) {
	const m = line.match(/#due\(([^)]*)\)/i);
	if (!m) return null;
	const v = m[1].trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function extractWaiting(line) {
	const m = line.match(/#waiting-on:\s*([^#\s].*?)(?=\s+#|\s*$)/i);
	return m?.[1].trim() ?? null;
}

function extractUrgent(line) {
	const m = line.match(/#(urgent|not-urgent)\b/i);
	if (!m) return null;
	return m[1].toLowerCase() === "urgent";
}

function extractImportant(line) {
	const m = line.match(/#(important|not-important)\b/i);
	if (!m) return null;
	return m[1].toLowerCase() === "important";
}

function extractContext(line, settings) {
	for (const ctx of settings.contexts) {
		const bare = ctx.replace(/^@/, "");
		const re = new RegExp("#@?" + escapeRegex(bare) + "\\b", "i");
		if (re.test(line)) return ctx;
	}
	return null;
}

function projectNameFromPath(path, settings) {
	const folder = settings.file.projectFolder + "/";
	if (!path.startsWith(folder)) return null;
	return path.slice(folder.length).replace(/\.md$/i, "");
}

async function scanFile(abs, settings) {
	const path = relPath(abs);
	const content = await readVault(abs);
	const lines = content.split("\n");
	const out = [];
	let currentContext = null;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const cm = raw.match(/^##\s+@(.+)$/);
		if (cm) currentContext = cm[1].trim();
		if (!isTaskLine(raw)) continue;
		const text = cleanText(raw, settings);
		if (!text) continue;
		const bucket = bucketOf(path, settings.file);
		const project = bucket === "project" ? projectNameFromPath(path, settings) : null;
		out.push({
			text,
			path,
			line: i + 1,
			bucket,
			context: bucket === "next" ? currentContext : extractContext(raw, settings),
			urgent: extractUrgent(raw),
			important: extractImportant(raw),
			due: extractDue(raw),
			waitingFor: extractWaiting(raw),
			project,
			done: /\[x\]/i.test(raw),
		});
	}
	return out;
}

async function walk(dir, settings) {
	const tasks = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) tasks.push(...(await walk(full, settings)));
		else if (entry.isFile() && full.toLowerCase().endsWith(".md")) {
			tasks.push(...(await scanFile(full, settings)));
		}
	}
	return tasks;
}

export async function listTasks(requestedBucket) {
	const settings = await readSettings();
	const tasks = await walk(vaultPath(), settings);
	if (requestedBucket) return tasks.filter((t) => t.bucket === requestedBucket);
	return tasks;
}

function normalizeDue(due) {
	if (due == null || due === "") return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error(`Invalid due "${due}". Use yyyy-mm-dd.`);
	return due;
}

function priorityTags(priority, settings) {
	const p = settings.priority.tags;
	if (priority === "1") return `${p.urgent} ${p.important}`;
	if (priority === "2") return `${p.urgent} ${p.notImportant}`;
	if (priority === "3") return `${p.notUrgent} ${p.important}`;
	return `${p.notUrgent} ${p.notImportant}`;
}

function dueTag(due, settings) {
	if (!due) return "";
	return " " + settings.dueSyntax.replace("yyyy-mm-dd", due);
}

function contextTag(context) {
	if (!context) return "";
	const ctx = context.startsWith("@") ? context : "@" + context;
	return " #" + ctx;
}

export async function addToInbox(text, { context, priority, due } = {}) {
	const settings = await readSettings();
	const path = settings.file.inbox;
	const abs = join(vaultPath(), path);
	const dueNorm = normalizeDue(due);
	const line =
		"- [ ] " +
		text.trim() +
		" " +
		priorityTags(priority, settings) +
		contextTag(context) +
		dueTag(dueNorm, settings);
	let content = await readVault(abs);
	if (content && !content.endsWith("\n")) content += "\n";
	content += line + "\n";
	await writeVault(abs, content);
	return { note: path, line };
}

export async function addToProject(project, text, { context, priority, due } = {}) {
	const settings = await readSettings();
	const projectPath = join(
		vaultPath(),
		settings.file.projectFolder,
		project + ".md"
	);
	const dueNorm = normalizeDue(due);
	const child =
		"\t- [ ] " +
		text.trim() +
		" " +
		priorityTags(priority, settings) +
		contextTag(context) +
		dueTag(dueNorm, settings);
	let content = await readVault(projectPath);
	if (!content) {
		content = "- [ ] " + project + "\n\n";
	}
	if (!content.endsWith("\n")) content += "\n";
	content += child + "\n";
	await writeVault(projectPath, content);
	return { note: relPath(projectPath), line: child };
}

export async function listContexts() {
	return (await readSettings()).contexts;
}

export async function addContext(context) {
	const data = await readData();
	const settings = data.settings ?? {};
	const list = settings.contexts ?? [];
	const value = context.trim().replace(/^@/, "");
	if (!value) throw new Error("Context cannot be empty.");
	const ctx = "@" + value;
	if (list.some((c) => c.replace(/^@/, "").toLowerCase() === value.toLowerCase())) {
		return { added: false, contexts: list, message: "Context already exists." };
	}
	list.push(ctx);
	settings.contexts = list;
	data.settings = settings;
	await writeData(data);

	const fullSettings = await readSettings();
	const nextPath = join(vaultPath(), fullSettings.file.next);
	let content = await readVault(nextPath);
	const heading = "## " + ctx;
	if (!content.includes(heading)) {
		if (content && !content.endsWith("\n")) content += "\n";
		content += heading + "\n";
		await writeVault(nextPath, content);
	}
	return { added: true, contexts: list };
}

export async function listColumns() {
	return (await readSettings()).boardColumns;
}

export async function addColumn(column) {
	const data = await readData();
	const settings = data.settings ?? {};
	const list = settings.boardColumns ?? [];
	const value = column.trim().toLowerCase();
	const allowed = ["inbox", "next", "project", "waiting", "someday", "reference", "trash", "done"];
	if (!allowed.includes(value)) {
		throw new Error(`Invalid column "${column}". Allowed: ${allowed.join(", ")}`);
	}
	if (list.includes(value)) {
		return { added: false, columns: list, message: "Column already present." };
	}
	list.push(value);
	settings.boardColumns = list;
	data.settings = settings;
	await writeData(data);
	return { added: true, columns: list };
}
