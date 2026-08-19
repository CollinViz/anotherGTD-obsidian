import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type TaskLoopsPlugin from "./main";
import { BUCKETS, Bucket, JoinedTask, Task } from "./types";
import type { CardOptions, PanelHost } from "./host";
import { renderBoard } from "./board";
import { CalendarState, initialCalendarState, renderCalendar } from "./calendar";
import { DateModal, FolderPicker, ProjectPicker, TaskPicker, TextPromptModal } from "./modals";
import { daysUntil, formatDue } from "./dates";
import { truncate } from "./text";
import { Wizard, WizardHost, renderWizard } from "./wizard";

export const VIEW_TYPE_TASKLOOPS = "taskloops-view";

function priorityRank(t: Task): number {
	if (t.urgent && t.important) return 0;
	if (t.urgent) return 1;
	if (t.important) return 2;
	return 3;
}

function compareTasks(a: JoinedTask, b: JoinedTask): number {
	if (a.done !== b.done) return a.done ? 1 : -1;
	return priorityRank(a) - priorityRank(b) || a.text.localeCompare(b.text);
}

export class TaskLoopsView extends ItemView implements WizardHost, PanelHost {
	plugin: TaskLoopsPlugin;
	private active: Bucket | "done";
	private wizards = new Map<string, Wizard>();
	private expanded = new Set<string>();
	private query = "";
	private capturing: { for: string | null; fresh: boolean } | null = null;
	private dragging: string | null = null;
	private renderPending = false;
	private editing: string | null = null;
	private currentList: JoinedTask[] = [];
	private mode: "list" | "board" | "calendar";
	private calendar: CalendarState = initialCalendarState();
	private projectNames = new Map<string, string>();

	constructor(leaf: WorkspaceLeaf, plugin: TaskLoopsPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.active = plugin.settings.lastBucket ?? "inbox";
		this.mode = plugin.settings.lastMode ?? "list";
	}

	getViewType(): string {
		return VIEW_TYPE_TASKLOOPS;
	}

	getDisplayText(): string {
		return "Another GTD";
	}

	getIcon(): string {
		return "inbox";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("tl-view");
		this.render();
	}

	async onClose(): Promise<void> {
		this.wizards.clear();
	}

	rerender(): void {
		this.render();
	}

	card(parent: HTMLElement, task: JoinedTask, opts: CardOptions = {}): void {
		this.renderCard(parent, task, opts);
	}

	draggable(el: HTMLElement, task: JoinedTask): void {
		this.makeDraggable(el, task);
	}

	dropTarget(el: HTMLElement, onDrop: (task: JoinedTask) => void): void {
		this.makeDropTarget(el, onDrop);
	}

	fileInto(task: JoinedTask, bucket: Bucket | "done"): void {
		this.dropOnBucket(task, bucket);
	}

	draggingId(): string | null {
		return this.dragging;
	}

	readonly compare = compareTasks;

	cancelWizard(id: string): void {
		this.wizards.delete(id);
	}

	show(bucket: Bucket | "done"): void {
		this.active = bucket;
		this.plugin.settings.lastBucket = bucket;
		void this.plugin.saveData_();
		this.render();
	}

	render(): void {
		if (this.dragging) {
			this.renderPending = true;
			return;
		}
		this.renderPending = false;
		this.contentEl.removeClass("is-dragging-task");
		const scroll = this.contentEl.querySelector(".tl-list")?.scrollTop ?? 0;
		const focused =
			this.contentEl.querySelector(".tl-capture-input") === document.activeElement;
		this.contentEl.empty();
		const tasks = this.plugin.joined();
		this.projectNames.clear();
		for (const p of this.plugin.projects(tasks)) {
			this.projectNames.set(p.id, p.text);
		}
		this.renderHeader(this.contentEl, tasks);
		this.renderModeBar(this.contentEl, tasks);
		this.renderSearch(this.contentEl);
		if (this.capturing && this.capturing.for === null) {
			this.renderCapture(this.contentEl, null, focused);
		}
		const body = this.contentEl.createDiv("tl-list is-mode-" + this.mode);
		const q = this.query.trim().toLowerCase();
		const matches = (task: JoinedTask) => this.matches(task, q);
		if (this.mode === "board") {
			this.currentList = [];
			renderBoard(body, this, tasks, matches);
		} else if (this.mode === "calendar") {
			this.currentList = [];
			renderCalendar(body, this, this.calendar, tasks, matches);
		} else {
			this.renderList(body, tasks);
		}
		this.renderDropRail(this.contentEl, tasks);
		body.scrollTop = scroll;
	}

	private setMode(mode: "list" | "board" | "calendar"): void {
		this.mode = mode;
		this.plugin.settings.lastMode = mode;
		void this.plugin.saveData_();
		this.render();
	}

	private renderModeBar(root: HTMLElement, tasks: JoinedTask[]): void {
		const bar = root.createDiv("tl-modes");
		const activeDef = BUCKETS.find((b) => b.id === this.active);
		const count =
			this.active === "done"
				? tasks.filter((t) => t.done).length
				: tasks.filter((t) => t.bucket === this.active && !t.done).length;
		const gtd = bar.createEl("button", {
			cls: "tl-mode is-gtd" + (this.mode === "list" ? " is-active" : ""),
			attr: { "aria-label": "GTD lists" },
		});
		const gtdIcon = gtd.createSpan("tl-mode-icon");
		setIcon(gtdIcon, activeDef?.icon ?? "inbox");
		gtd.createSpan({ cls: "tl-mode-label", text: "GTD" });
		if (this.mode === "list") {
			gtd.createSpan({
				cls: "tl-mode-sub",
				text: activeDef?.label ?? "Inbox",
			});
			if (count > 0) gtd.createSpan({ cls: "tl-mode-count", text: String(count) });
		}
		const caret = gtd.createSpan("tl-mode-caret");
		setIcon(caret, "chevron-down");
		const stalled = this.plugin
			.projects(tasks)
			.filter((p) => this.plugin.isStalled(this.plugin.actionsOf(tasks, p.id))).length;
		if (stalled > 0) gtd.addClass("has-alert");
		gtd.onclick = (e) => {
			if (this.mode !== "list") {
				this.setMode("list");
				return;
			}
			this.showBucketMenu(e, tasks);
		};

		const board = bar.createEl("button", {
			cls: "tl-mode" + (this.mode === "board" ? " is-active" : ""),
			attr: { "aria-label": "Board" },
		});
		setIcon(board.createSpan("tl-mode-icon"), "columns-3");
		board.createSpan({ cls: "tl-mode-label", text: "Board" });
		board.onclick = () => this.setMode("board");

		const cal = bar.createEl("button", {
			cls: "tl-mode" + (this.mode === "calendar" ? " is-active" : ""),
			attr: { "aria-label": "Calendar" },
		});
		setIcon(cal.createSpan("tl-mode-icon"), "calendar-days");
		cal.createSpan({ cls: "tl-mode-label", text: "Calendar" });
		cal.onclick = () => this.setMode("calendar");
	}

	private showBucketMenu(evt: MouseEvent, tasks: JoinedTask[]): void {
		const menu = new Menu();
		for (const def of BUCKETS) {
			const count =
				def.id === "done"
					? tasks.filter((t) => t.done).length
					: tasks.filter((t) => t.bucket === def.id && !t.done).length;
			menu.addItem((i) =>
				i
					.setTitle(count > 0 ? `${def.label}  ·  ${String(count)}` : def.label)
					.setIcon(def.icon)
					.setChecked(this.active === def.id)
					.onClick(() => this.show(def.id))
			);
		}
		menu.showAtMouseEvent(evt);
	}

	private renderDropRail(root: HTMLElement, tasks: JoinedTask[]): void {
		const rail = root.createDiv("tl-droprail");
		rail.createSpan({ cls: "tl-droprail-hint", text: "Drop to file:" });
		for (const def of BUCKETS) {
			const chip = rail.createDiv({ cls: "tl-droprail-chip" });
			setIcon(chip.createSpan("tl-droprail-icon"), def.icon);
			chip.createSpan({ text: def.label });
			this.dropTarget(chip, (task) => this.fileInto(task, def.id));
		}
		void tasks;
	}

	private renderHeader(root: HTMLElement, tasks: JoinedTask[]): void {
		const head = root.createDiv("tl-header");
		const title = head.createDiv("tl-header-title");
		title.createSpan({ text: "Another GTD" });
		const inbox = tasks.filter((t) => t.bucket === "inbox").length;
		if (inbox > 0) title.createSpan({ cls: "tl-header-badge", text: String(inbox) });
		const actions = head.createDiv("tl-header-actions");
		const add = actions.createEl("button", {
			cls: "tl-icon-btn is-primary",
			attr: { "aria-label": "Capture a task" },
		});
		setIcon(add, "plus");
		add.onclick = () => {
			this.capturing =
				this.capturing?.for === null ? null : { for: null, fresh: true };
			if (this.capturing) this.show("inbox");
			else this.render();
		};
		const refresh = actions.createEl("button", {
			cls: "tl-icon-btn",
			attr: { "aria-label": "Rescan vault" },
		});
		setIcon(refresh, "refresh-cw");
		refresh.onclick = async () => {
			refresh.addClass("is-spinning");
			await this.plugin.rescan();
			refresh.removeClass("is-spinning");
		};
		const settings = actions.createEl("button", {
			cls: "tl-icon-btn",
			attr: { "aria-label": "Settings" },
		});
		setIcon(settings, "settings");
		settings.onclick = () => this.plugin.openSettings();
	}

	private renderCapture(
		root: HTMLElement,
		projectUid: string | null,
		autofocus: boolean
	): void {
		const wrap = root.createDiv("tl-capture");
		const top = wrap.createDiv("tl-capture-row");
		const input = top.createEl("input", {
			cls: "tl-capture-input",
			attr: {
				placeholder: projectUid
					? "New action for this project…"
					: "What's on your mind?",
				spellcheck: "false",
			},
		});
		const commit = async () => {
			const text = input.value.trim();
			if (!text) return;
			input.value = "";
			if (!this.plugin.settings.captureNote) {
				new FolderPicker(this.app, (folder) => {
					void (async () => {
						const dir = !folder || folder === "/" ? "" : folder.replace(/\/+$/, "");
						this.plugin.settings.captureNote = dir
							? dir + "/" + "Inbox.md"
							: "Inbox.md";
						await this.plugin.saveData_();
						await this.plugin.captureTask(text, projectUid, projectUid ? "next" : "inbox");
					})();
				}).open();
				return;
			}
			await this.plugin.captureTask(text, projectUid, projectUid ? "next" : "inbox");
		};
		input.onkeydown = (e) => {
			if (e.key === "Enter") void commit();
			if (e.key === "Escape") {
				this.capturing = null;
				this.render();
			}
		};
		const done = top.createEl("button", {
			cls: "tl-icon-btn",
			attr: { "aria-label": "Close capture" },
		});
		setIcon(done, "x");
		done.onclick = () => {
			this.capturing = null;
			this.render();
		};
		const dest = wrap.createEl("button", {
			cls: "tl-capture-dest",
			attr: { "aria-label": "Change capture folder" },
		});
		const pin = dest.createSpan("tl-capture-dest-icon");
		setIcon(pin, "folder");
		dest.createSpan({
			cls: "tl-capture-dest-path",
			text: this.plugin.settings.captureNote,
		});
		dest.onclick = () => {
			new FolderPicker(this.app, (folder) => {
				void (async () => {
					const dir = !folder || folder === "/" ? "" : folder.replace(/\/+$/, "");
					this.plugin.settings.captureNote = dir
						? dir + "/" + "Inbox.md"
						: "Inbox.md";
					await this.plugin.saveData_();
					this.render();
				})();
			}).open();
		};
		if (autofocus || this.capturing?.fresh) {
			if (this.capturing) this.capturing.fresh = false;
			window.setTimeout(() => input.focus(), 0);
		}
	}

	private renderTabs(root: HTMLElement, tasks: JoinedTask[]): void {
		const bar = root.createDiv("tl-tabs");
		for (const def of BUCKETS) {
			const count =
				def.id === "done"
					? tasks.filter((t) => t.done).length
					: tasks.filter((t) => t.bucket === def.id && !t.done).length;
			const optional =
				def.id === "reference" || def.id === "trash" || def.id === "done";
			const quiet = optional && count === 0 && this.active !== def.id;
			const tab = bar.createEl("button", {
				cls:
					"tl-tab" +
					(this.active === def.id ? " is-active" : "") +
					(quiet ? " is-quiet" : ""),
				attr: { "aria-label": def.label },
			});
			const icon = tab.createSpan("tl-tab-icon");
			setIcon(icon, def.icon);
			tab.createSpan({ cls: "tl-tab-label", text: def.label });
			if (count > 0) tab.createSpan({ cls: "tl-tab-count", text: String(count) });
			if (def.id === "project") {
				const stalled = this.plugin
					.projects(tasks)
					.filter((p) =>
						this.plugin.isStalled(this.plugin.actionsOf(tasks, p.id))
					).length;
				if (stalled > 0) tab.addClass("has-alert");
			}
			tab.onclick = () => this.show(def.id);
			this.dropTarget(tab, (task) => this.dropOnBucket(task, def.id));
		}
	}

	private renderSearch(root: HTMLElement): void {
		const wrap = root.createDiv("tl-search");
		const input = wrap.createEl("input", {
			type: "search",
			attr: { placeholder: "Filter…", spellcheck: "false" },
		});
		input.value = this.query;
		input.oninput = () => {
			this.query = input.value;
			const list = this.contentEl.querySelector(".tl-list") as HTMLElement;
			if (list) {
				list.empty();
				this.renderList(list, this.plugin.joined());
			}
		};
	}

	private makeDraggable(el: HTMLElement, task: JoinedTask): void {
		el.setAttr("draggable", "true");
		el.addEventListener("dragstart", (e) => {
			this.dragging = task.id;
			e.dataTransfer?.setData("text/plain", task.id);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			el.addClass("is-dragging");
			this.contentEl.addClass("is-dragging-task");
		});
		el.addEventListener("dragend", () => {
			this.dragging = null;
			el.removeClass("is-dragging");
			this.contentEl.removeClass("is-dragging-task");
			this.render();
		});
	}

	private makeReorderTarget(card: HTMLElement, target: JoinedTask): void {
		const clear = () => card.removeClasses(["is-drop-above", "is-drop-below"]);
		const below = (e: DragEvent) => {
			const box = card.getBoundingClientRect();
			return e.clientY > box.top + box.height / 2;
		};
		card.addEventListener("dragover", (e) => {
			if (!this.dragging || this.dragging === target.id) return;
			if (!this.currentList.some((t) => t.id === this.dragging)) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			clear();
			card.addClass(below(e) ? "is-drop-below" : "is-drop-above");
		});
		card.addEventListener("dragleave", clear);
		card.addEventListener("drop", (e) => {
			const id = e.dataTransfer?.getData("text/plain") ?? this.dragging;
			clear();
			if (!id || id === target.id) return;
			const source = this.currentList.find((t) => t.id === id);
			if (!source) return;
			e.preventDefault();
			e.stopPropagation();
			this.dragging = null;
			const rest = this.currentList.filter((t) => t.id !== source.id);
			const at = rest.indexOf(target) + (below(e) ? 1 : 0);
			rest.splice(at, 0, source);
			void this.plugin.reorder(rest);
		});
	}

	private makeDropTarget(
		el: HTMLElement,
		onDrop: (task: JoinedTask) => void
	): void {
		el.addEventListener("dragover", (e) => {
			if (!this.dragging) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			el.addClass("is-drop-target");
		});
		el.addEventListener("dragleave", () => el.removeClass("is-drop-target"));
		el.addEventListener("drop", (e) => {
			e.preventDefault();
			e.stopPropagation();
			el.removeClass("is-drop-target");
			const id = e.dataTransfer?.getData("text/plain") || this.dragging;
			this.dragging = null;
			if (!id) return;
			const task = this.plugin.joined().find((t) => t.id === id);
			if (task) onDrop(task);
		});
	}

	private dropOnBucket(task: JoinedTask, bucket: Bucket | "done"): void {
		if (bucket === "done") {
			if (!task.done) void this.plugin.toggleDone(task);
			return;
		}
		if (bucket === task.bucket && !task.done) return;
		if (bucket === "waiting") {
			new TextPromptModal(this.app, {
				title: "Waiting on whom?",
				placeholder: "Name",
				initial: task.waitingFor,
				cta: "File it",
				onSubmit: (who) => void this.plugin.file(task, { bucket, waitingFor: who }),
			}).open();
			return;
		}
		void this.plugin.file(task, { bucket });
	}

	private matches(task: JoinedTask, q: string): boolean {
		if (!q) return true;
		return (
			task.text.toLowerCase().includes(q) ||
			task.path.toLowerCase().includes(q) ||
			(task.context ?? "").toLowerCase().includes(q) ||
			(task.waitingFor ?? "").toLowerCase().includes(q)
		);
	}

	private renderEmpty(list: HTMLElement, icon: string, text: string): void {
		const empty = list.createDiv("tl-empty");
		const el = empty.createDiv("tl-empty-icon");
		setIcon(el, icon);
		empty.createDiv({ cls: "tl-empty-text", text });
		if (this.active === "inbox" && !this.query) {
			empty.createDiv({
				cls: "tl-empty-hint",
				text: "Write - [ ] in a note, or press + above.",
			});
		}
	}

	private renderList(list: HTMLElement, all: JoinedTask[]): void {
		const def = BUCKETS.find((b) => b.id === this.active)!;
		const q = this.query.trim().toLowerCase();
		if (this.active === "project") {
			this.renderProjects(list, all, q);
			return;
		}
		let tasks =
			this.active === "done"
				? all.filter((t) => t.done)
				: all.filter((t) => t.bucket === this.active && !t.done);
		tasks = tasks.filter((t) => this.matches(t, q)).sort(compareTasks);
		this.currentList = tasks;
		if (tasks.length === 0) {
			this.renderEmpty(list, def.icon, q ? "Nothing matches that filter." : def.empty);
			return;
		}
		for (const [heading, group] of this.groupTasks(tasks)) {
			if (heading) list.createDiv({ cls: "tl-group", text: heading });
			for (const task of group) this.renderCard(list, task);
		}
	}

	private groupTasks(tasks: JoinedTask[]): Array<[string | null, JoinedTask[]]> {
		const by = (key: (t: JoinedTask) => string, order?: string[]) => {
			const map = new Map<string, JoinedTask[]>();
			for (const t of tasks) {
				const k = key(t);
				if (!map.has(k)) map.set(k, []);
				map.get(k)!.push(t);
			}
			const keys = Array.from(map.keys()).sort((a, b) => {
				if (order) {
					const ia = order.indexOf(a);
					const ib = order.indexOf(b);
					if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
				}
				return a.localeCompare(b);
			});
			return keys.map((k) => [k, map.get(k)!] as [string, JoinedTask[]]);
		};
		if (this.active === "next") return by((t) => t.context || "No context");
		if (this.active === "waiting") return by((t) => t.waitingFor || "Unassigned");
		return [[null, tasks]];
	}

	private renderProjects(list: HTMLElement, all: JoinedTask[], q: string): void {
		const projects = this.plugin.projects(all).filter((p) => this.matches(p, q));
		if (projects.length === 0) {
			this.renderEmpty(
				list,
				"layers",
				q ? "Nothing matches that filter." : BUCKETS.find((b) => b.id === "project")!.empty
			);
			return;
		}
		const stalled = projects.filter((p) =>
			this.plugin.isStalled(this.plugin.actionsOf(all, p.id))
		);
		if (stalled.length > 0) {
			list.createDiv({
				cls: "tl-group is-alert",
				text: `${stalled.length} waiting on a next action`,
			});
		}
		const ordered = [...stalled, ...projects.filter((p) => !stalled.includes(p))];
		for (const project of ordered) {
			const actions = this.plugin.actionsOf(all, project.id);
			this.renderProjectCard(list, project, actions, all);
		}
	}

	private renderProjectCard(
		list: HTMLElement,
		project: JoinedTask,
		actions: JoinedTask[],
		all: JoinedTask[]
	): void {
		const open = actions.filter((a) => !a.done);
		const isStalled = this.plugin.isStalled(actions);
		const id = project.id;
		const isOpen = this.expanded.has(id);
		const card = list.createDiv(
			"tl-card tl-project" + (isStalled ? " is-stalled" : "")
		);
		const row = card.createDiv("tl-card-row");
		this.makeDropTarget(card, (task) => {
			if (task.id === id) return;
			void this.plugin.linkToProject(task, id);
			this.expanded.add(id);
		});
		this.makeDraggable(card, project);
		const chevron = row.createEl("button", {
			cls: "tl-chevron",
			attr: { "aria-label": isOpen ? "Collapse" : "Expand" },
		});
		setIcon(chevron, isOpen ? "chevron-down" : "chevron-right");
		chevron.onclick = (e) => {
			e.stopPropagation();
			if (isOpen) this.expanded.delete(id);
			else this.expanded.add(id);
			this.render();
		};
		const body = row.createDiv("tl-card-body");
		body.createDiv({ cls: "tl-card-text", text: project.text });
		const meta = body.createDiv("tl-card-meta");
		const src = meta.createSpan({
			cls: "tl-source",
			text: this.plugin.sourceLabel(project),
		});
		src.onclick = (e) => {
			e.stopPropagation();
			void this.plugin.reveal(project);
		};
		if (isStalled) {
			meta.createSpan({ cls: "tl-chip is-warn", text: "no next action" });
		} else {
			meta.createSpan({
				cls: "tl-chip",
				text: open.length === 1 ? "1 action" : `${open.length} actions`,
			});
		}
		const tools = row.createDiv("tl-card-tools");
		const more = tools.createEl("button", {
			cls: "tl-icon-btn",
			attr: { "aria-label": "More" },
		});
		setIcon(more, "more-horizontal");
		more.onclick = (e) => {
			e.stopPropagation();
			this.showMenu(e, project);
		};
		if (!isOpen) return;
		const children = card.createDiv("tl-project-children");
		for (const action of actions) {
			this.renderCard(children, action, { nested: true });
		}
		if (this.capturing && this.capturing.for === id) {
			this.renderCapture(children, id, true);
		}
		const add = children.createDiv("tl-add-row");
		const create = add.createEl("button", {
			cls: "tl-link",
			text: "+ New action",
		});
		create.onclick = (e) => {
			e.stopPropagation();
			this.capturing =
				this.capturing?.for === id ? null : { for: id, fresh: true };
			this.expanded.add(id);
			this.render();
		};
		const link = add.createEl("button", {
			cls: "tl-link",
			text: "Link existing…",
		});
		link.onclick = (e) => {
			e.stopPropagation();
			const candidates = this.plugin.unattached(all);
			if (candidates.length === 0) {
				new Notice("Every open task is already filed under a project.");
				return;
			}
			new TaskPicker(this.app, candidates, (task) => {
				void this.plugin.linkToProject(task, id);
			}).open();
		};
	}

	private renderCard(
		list: HTMLElement,
		task: JoinedTask,
		opts: CardOptions = {}
	): void {
		const wizard = this.wizards.get(task.id);
		const card = list.createDiv(
			"tl-card" +
				(wizard ? " is-clarifying" : "") +
				(task.done ? " is-done" : "") +
				(opts.nested ? " is-nested" : "")
		);
		card.addClass("is-p" + (priorityRank(task) + 1));
		if (!wizard) {
			this.makeDraggable(card, task);
			if (!opts.nested && !opts.noReorder) this.makeReorderTarget(card, task);
		}
		const row = card.createDiv("tl-card-row");
		const showCheck = opts.nested || this.active !== "inbox";
		if (showCheck) {
			const box = row.createEl("input", {
				type: "checkbox",
				cls: "tl-check",
			});
			box.checked = !!task.done;
			box.onclick = (e) => {
				e.stopPropagation();
				void this.plugin.toggleDone(task);
			};
		}
		const body = row.createDiv("tl-card-body");
		if (this.editing === task.id) {
			this.renderTextEditor(body, task);
		} else {
			const textEl = body.createDiv({ cls: "tl-card-text", text: task.text });
			textEl.title = "Double-click to edit";
			textEl.ondblclick = (e) => {
				e.stopPropagation();
				this.startEdit(task);
			};
		}
		const meta = body.createDiv("tl-card-meta");
		if (!opts.terse) {
			const src = meta.createSpan({
				cls: "tl-source",
				text: this.plugin.sourceLabel(task),
			});
			src.onclick = (e) => {
				e.stopPropagation();
				void this.plugin.reveal(task);
			};
		}
		const urgentChip = meta.createSpan({
			cls: "tl-chip is-editable" + (task.urgent ? "" : " is-empty"),
			text: task.urgent ? "urgent" : "+ urgent",
			attr: { "aria-label": "Toggle urgent" },
		});
		urgentChip.onclick = (e) => {
			e.stopPropagation();
			void this.plugin.setPriority(task, !task.urgent, !!task.important);
		};
		const importantChip = meta.createSpan({
			cls: "tl-chip is-editable" + (task.important ? "" : " is-empty"),
			text: task.important ? "important" : "+ important",
			attr: { "aria-label": "Toggle important" },
		});
		importantChip.onclick = (e) => {
			e.stopPropagation();
			void this.plugin.setPriority(task, !!task.urgent, !task.important);
		};
		if (opts.nested) {
			const label = BUCKETS.find((b) => b.id === task.bucket)?.label;
			if (label) meta.createSpan({ cls: "tl-chip", text: label });
		}
		const contextChip = meta.createSpan({
			cls: task.context ? "tl-chip is-editable" : "tl-chip is-editable is-empty",
			text: task.context ?? "+ context",
			attr: { "aria-label": "Change context" },
		});
		contextChip.onclick = (e) => {
			e.stopPropagation();
			this.pickContext(task, e);
		};
		if (task.waitingFor || task.bucket === "waiting") {
			const whoChip = meta.createSpan({
				cls: "tl-chip is-editable",
				text: task.waitingFor ? "→ " + task.waitingFor : "→ who?",
				attr: { "aria-label": "Change who you are waiting on" },
			});
			whoChip.onclick = (e) => {
				e.stopPropagation();
				this.pickWaitingFor(task);
			};
		}
		const d = task.due ? daysUntil(task.due) : 0;
		const dateChip = meta.createSpan({
			cls: task.due
				? "tl-chip is-date" +
				  (d < 0 ? " is-overdue" : d === 0 ? " is-today" : "")
				: "tl-chip is-date is-empty",
			text: task.due ? formatDue(task.due) : "+ date",
			attr: { "aria-label": "Change date" },
		});
		dateChip.onclick = (e) => {
			e.stopPropagation();
			this.pickDate(task);
		};
		if (!opts.nested && task.projectUid) {
			const name = this.projectNames.get(task.projectUid);
			if (name) {
				meta.createSpan({
					cls: "tl-chip is-project",
					text: truncate(name, 22),
					attr: { "aria-label": name },
				});
			}
		}
		const tools = row.createDiv("tl-card-tools");
		const more = tools.createEl("button", {
			cls: "tl-icon-btn",
			attr: { "aria-label": "More" },
		});
		setIcon(more, "more-horizontal");
		more.onclick = (e) => {
			e.stopPropagation();
			this.showMenu(e, task);
		};
		if (this.active === "inbox" && !opts.nested) {
			if (wizard) {
				renderWizard(this, card, task, wizard);
			} else {
				const start = tools.createEl("button", {
					cls: "tl-icon-btn is-primary",
					attr: { "aria-label": "Clarify" },
				});
				setIcon(start, "wand-2");
				start.onclick = (e) => {
					e.stopPropagation();
					this.wizards.set(task.id, {
						step: "actionable",
						history: [],
						draft: {},
					});
					this.render();
				};
			}
		}
	}

	private startEdit(task: JoinedTask): void {
		this.editing = task.id;
		this.render();
	}

	private renderTextEditor(body: HTMLElement, task: JoinedTask): void {
		const input = body.createEl("textarea", { cls: "tl-card-edit" });
		input.value = task.text;
		input.rows = 1;
		const grow = () => {
			input.setCssProps({ "--tl-edit-height": "auto" });
			input.setCssProps({ "--tl-edit-height": `${input.scrollHeight}px` });
		};
		let settled = false;
		const finish = (save: boolean) => {
			if (settled) return;
			settled = true;
			const next = input.value;
			this.editing = null;
			if (save) void this.plugin.renameTask(task, next);
			else this.render();
		};
		input.oninput = grow;
		input.onkeydown = (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				finish(true);
			}
			if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		};
		input.onblur = () => finish(true);
		window.setTimeout(() => {
			input.focus();
			input.select();
			grow();
		}, 0);
	}

	private pickContext(task: JoinedTask, evt: MouseEvent): void {
		const menu = new Menu();
		for (const ctx of this.plugin.settings.contexts) {
			menu.addItem((i) =>
				i
					.setTitle(ctx)
					.setChecked(task.context === ctx)
					.onClick(() => void this.plugin.setContext(task, ctx))
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("No context")
				.setChecked(!task.context)
				.onClick(() => void this.plugin.setContext(task, null))
		);
		menu.showAtMouseEvent(evt);
	}

	private pickWaitingFor(task: JoinedTask): void {
		new TextPromptModal(this.app, {
			title: "Waiting on whom?",
			placeholder: "Name",
			initial: task.waitingFor,
			cta: "Save",
			onSubmit: (who) => void this.plugin.setWaitingFor(task, who),
		}).open();
	}

	private pickDate(task: JoinedTask): void {
		new DateModal(this.app, {
			title: task.due ? "Change date" : "Set a date",
			initial: task.due,
			allowClear: !!task.due,
			onPick: (iso) => void this.plugin.setDue(task, iso),
		}).open();
	}

	private showMenu(evt: MouseEvent, task: JoinedTask): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Open note")
				.setIcon("file-text")
				.onClick(() => void this.plugin.reveal(task))
		);
		menu.addItem((i) =>
			i
				.setTitle("Edit text…")
				.setIcon("pencil")
				.onClick(() => this.startEdit(task))
		);
		menu.addItem((i) =>
			i
				.setTitle("Urgent")
				.setIcon("flag")
				.setChecked(!!task.urgent)
				.onClick(() => void this.plugin.setPriority(task, !task.urgent, !!task.important))
		);
		menu.addItem((i) =>
			i
				.setTitle("Important")
				.setIcon("bookmark")
				.setChecked(!!task.important)
				.onClick(() => void this.plugin.setPriority(task, !!task.urgent, !task.important))
		);
		menu.addItem((i) =>
			i
				.setTitle(task.context ? "Change context…" : "Set a context…")
				.setIcon("map-pin")
				.onClick((e) => this.pickContext(task, e as MouseEvent))
		);
		menu.addItem((i) =>
			i
				.setTitle(task.due ? "Change date…" : "Set a date…")
				.setIcon("calendar")
				.onClick(() => this.pickDate(task))
		);
		if (task.due) {
			menu.addItem((i) =>
				i
					.setTitle("Clear date")
					.setIcon("calendar-x")
					.onClick(() => void this.plugin.setDue(task, null))
			);
		}
		if (task.bucket !== "project") {
			menu.addItem((i) =>
				i
					.setTitle("Part of project…")
					.setIcon("layers")
					.onClick(() => {
						const projects = this.plugin.projects(this.plugin.joined());
						if (projects.length === 0) {
							new Notice("No projects yet. File a task as a project first.");
							return;
						}
						new ProjectPicker(this.app, projects, (uid) => {
							void this.plugin.linkToProject(task, uid);
						}).open();
					})
			);
		}
		menu.addSeparator();
		for (const def of BUCKETS) {
			if (def.id === "done") continue;
			const target = def.id;
			if (target === task.bucket && !task.done) continue;
			menu.addItem((i) =>
				i
					.setTitle(
						target === "inbox" ? "Return to Inbox" : "Move to " + def.label
					)
					.setIcon(def.icon)
					.onClick(() => this.dropOnBucket(task, target))
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(task.done ? "Mark not done" : "Mark done")
				.setIcon(task.done ? "rotate-ccw" : "check")
				.onClick(() => void this.plugin.toggleDone(task))
		);
		menu.showAtMouseEvent(evt);
	}
}
