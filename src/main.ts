import {
	App,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import { Bucket, GtdSettings, DEFAULT_SETTINGS, JoinedTask, Task } from "./types";
import { TaskStore, toJoined } from "./store";
import { TextPromptModal } from "./modals";
import { anotherGtdSettingTab } from "./settings";
import { anotherGtdView, VIEW_TYPE_anotherGtd } from "./view";

interface SettingsOpener {
	open(): void;
	openTabById(id: string): void;
}

export default class anotherGtdPlugin extends Plugin {
	settings: GtdSettings;
	store: TaskStore;
	private tasks: Task[] = [];
	private writing = new Set<string>();

	async onload(): Promise<void> {
		await this.loadState();
		this.store = new TaskStore(this.app, this.settings);

		this.registerView(VIEW_TYPE_anotherGtd, (leaf) => new anotherGtdView(leaf, this));
		this.addRibbonIcon("inbox", "Another GTD", () => void this.activateView());

		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: "rescan-vault",
			name: "Rescan vault for tasks",
			callback: () => void this.rescan(),
		});
		this.addCommand({
			id: "open-in-main-area",
			name: "Open in a main tab (for the board)",
			callback: () => void this.activateView(true),
		});
		this.addCommand({
			id: "capture-task",
			name: "Capture a task to the inbox",
			callback: () => {
				new TextPromptModal(this.app, {
					title: "Capture to inbox",
					placeholder: "What's on your mind?",
					cta: "Capture",
					onSubmit: (text) => void this.captureTask(text),
				}).open();
			},
		});

		this.addSettingTab(new anotherGtdSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			void this.rescan();
		});

		const onMetaChange = debounce(
			(file: TFile) => void this.refreshFile(file),
			300,
			true
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile) => {
				if (this.writing.has(file.path)) return;
				onMetaChange(file);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (this.tasks.some((t) => t.path === file.path)) {
					void this.rescan();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile) => {
				if (file instanceof TFile) void this.refreshFile(file);
			})
		);
	}

	onunload(): void {
		// Leaves stay in place.
	}

	private async loadState(): Promise<void> {
		const data = (await this.loadData()) as Partial<{ settings: GtdSettings }> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
	}

	async saveData_(): Promise<void> {
		await this.saveData({ settings: this.settings });
	}

	async rescan(): Promise<void> {
		this.tasks = await this.store.scan();
		this.refreshViews();
	}

	private async refreshFile(file: TFile): Promise<void> {
		if (file.extension !== "md") return;
		this.tasks = this.tasks.filter((t) => t.path !== file.path);
		const { scanFile } = await import("./scanner");
		const content = await this.app.vault.cachedRead(file);
		this.tasks.push(...scanFile(content, file.path, this.settings));
		this.refreshViews();
	}

	joined(): JoinedTask[] {
		return this.tasks.map(toJoined);
	}

	projects(all: JoinedTask[]): JoinedTask[] {
		return all.filter(
			(t) => t.bucket === "project" && t.path === this.settings.file.projects && !t.done
		);
	}

	actionsOf(all: JoinedTask[], projectId: string): JoinedTask[] {
		const project = all.find((t) => t.id === projectId);
		if (!project) return [];
		const path = this.settings.file.projectFolder + "/" + project.text + ".md";
		return all.filter((t) => t.path === path && !t.done);
	}

	isStalled(actions: JoinedTask[]): boolean {
		return !actions.some((a) => !a.done);
	}

	unattached(all: JoinedTask[]): JoinedTask[] {
		return all.filter(
			(t) => !t.projectUid && t.bucket !== "project" && t.bucket !== "trash" && !t.done
		);
	}

	async linkToProject(
		task: JoinedTask,
		projectId: string | null | undefined
	): Promise<void> {
		if (projectId) {
			const project = this.joined().find((t) => t.id === projectId);
			if (!project) return;
			await this.wrapWrite(() =>
				this.store.moveToBucket(task, "project", { project: project.text })
			);
		} else {
			await this.wrapWrite(() => this.store.moveToBucket(task, "inbox"));
		}
		await this.rescan();
		this.refreshViews();
	}

	async file(
		task: JoinedTask,
		patch: {
			bucket: Bucket;
			context?: string;
			waitingFor?: string;
			due?: string;
			done?: boolean;
			projectUid?: string | null;
		}
	): Promise<void> {
		await this.wrapWrite(async () => {
			if (patch.bucket === "project" && task.bucket !== "project") {
				await this.store.convertToProject(task);
				return;
			}
			if (patch.done !== undefined && patch.bucket === "inbox" && patch.done) {
				await this.store.toggleDone(task);
				return;
			}
			await this.store.moveToBucket(task, patch.bucket, {
				context: patch.context,
				waitingFor: patch.waitingFor,
				project: patch.projectUid
					? this.joined().find((t) => t.id === patch.projectUid)?.text
					: undefined,
			});
			if (patch.due) await this.store.setDue(task, patch.due);
		});
		await this.rescan();
		this.refreshViews();
	}

	async toggleDone(task: JoinedTask): Promise<void> {
		await this.wrapWrite(() => this.store.toggleDone(task));
		await this.rescan();
		this.refreshViews();
	}

	async setPriority(task: JoinedTask, urgent: boolean, important: boolean): Promise<void> {
		await this.wrapWrite(() => this.store.setPriority(task, urgent, important));
		await this.rescan();
		this.refreshViews();
	}

	async setDue(task: JoinedTask, iso: string | null): Promise<void> {
		await this.wrapWrite(() => this.store.setDue(task, iso));
		await this.rescan();
		this.refreshViews();
	}

	async setWaitingFor(task: JoinedTask, who: string | null): Promise<void> {
		await this.wrapWrite(async () => {
			await this.store.setWaitingFor(task, who);
			if (who && task.bucket !== "waiting") {
				await this.store.moveToBucket(task, "waiting", { waitingFor: who });
			}
		});
		await this.rescan();
		this.refreshViews();
	}

	async setContext(task: JoinedTask, context: string | null): Promise<void> {
		await this.wrapWrite(() => this.store.setContext(task, context));
		await this.rescan();
		this.refreshViews();
	}

	async reorder(tasks: JoinedTask[]): Promise<void> {
		const path = tasks[0]?.path;
		if (!path) return;
		await this.wrapWrite(() => this.store.reorder(path, tasks));
		await this.rescan();
		this.refreshViews();
	}

	async renameTask(task: JoinedTask, body: string): Promise<boolean> {
		let ok = false;
		await this.wrapWrite(async () => {
			ok = await this.store.rename(task, body);
		});
		await this.rescan();
		this.refreshViews();
		return ok;
	}

	async captureTask(
		text: string,
		projectUid?: string | null,
		bucket: Bucket = "inbox",
		due?: string
	): Promise<boolean> {
		await this.wrapWrite(async () => {
			const project = projectUid ? this.joined().find((t) => t.id === projectUid)?.text : undefined;
			await this.store.capture(text, bucket, { project, due });
		});
		await this.rescan();
		this.refreshViews();
		return true;
	}

	async setCaptureFolder(folder: string | null): Promise<void> {
		const dir = !folder || folder === "/" ? "" : folder.replace(/\/+$/, "");
		this.settings.captureNote = dir ? dir + "/Inbox.md" : "Inbox.md";
		await this.saveData_();
		this.refreshViews();
	}

	async reveal(task: Task): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice("Another GTD: source note is gone.");
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, {
			eState: { line: task.line },
			active: true,
		});
	}

	sourceLabel(task: Task): string {
		const parts = task.path.replace(/\.md$/, "").split("/");
		const name = parts.pop() ?? task.path;
		if (this.settings.showFolder && parts.length) {
			return parts[parts.length - 1] + "/" + name;
		}
		return name;
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_anotherGtd)) {
			const view = leaf.view;
			if (view instanceof anotherGtdView) view.render();
		}
	}

	async activateView(mainArea = false): Promise<void> {
		const { workspace } = this.app;
		if (mainArea) {
			const leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_anotherGtd, active: true });
			await workspace.revealLeaf(leaf);
			return;
		}
		const existing = workspace.getLeavesOfType(VIEW_TYPE_anotherGtd);
		let leaf: WorkspaceLeaf | null;
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_anotherGtd, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	openSettings(): void {
		const { setting } = this.app as App & { setting?: SettingsOpener };
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	private async wrapWrite(fn: () => Promise<void>): Promise<void> {
		this.writing.add(this.settings.captureNote);
		try {
			await fn();
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			console.error("Another GTD: write failed", detail);
			new Notice("Another GTD: " + detail);
		} finally {
			this.writing.delete(this.settings.captureNote);
		}
	}
}
