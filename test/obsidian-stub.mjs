export class App {}
export class TFile {}
export class TFolder {}
export class TAbstractFile {}
export class Plugin {}
export class ItemView {}
export class Modal {}
export class FuzzySuggestModal {}
export class PluginSettingTab {}
export class Setting {}
export class Menu {}
export class Notice {}
export class WorkspaceLeaf {}
export function setIcon() {}
export function normalizePath(p) {
	return p;
}
export function debounce(fn) {
	return fn;
}

export function makeApp(initial = {}) {
	const files = new Map(Object.entries(initial));

	const read = async (path) => {
		if (files.has(path)) return files.get(path);
		const err = new Error(`ENOENT: ${path}`);
		err.code = "ENOENT";
		throw err;
	};

	const write = async (path, content) => {
		files.set(path, content);
	};

	const mkdir = async (dir) => {
		// no-op in-memory
	};

	const cachedRead = async (file) => {
		return read(file.path);
	};

	const getMarkdownFiles = () => {
		return Array.from(files.keys())
			.filter((p) => p.endsWith(".md"))
			.map((path) => ({ path, extension: "md" }));
	};

	const process = async (file, transform) => {
		const content = await read(file.path);
		const next = transform(content);
		await write(file.path, next);
	};

	return {
		vault: {
			adapter: { read, write, mkdir },
			cachedRead,
			getMarkdownFiles,
			process,
		},
		metadataCache: { getFileCache: () => null },
		workspace: { getLeavesOfType: () => [] },
	};
}
