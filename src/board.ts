import { setIcon } from "obsidian";
import type { PanelHost } from "./host";
import { BUCKETS, Bucket, JoinedTask } from "./types";

export function renderBoard(
	root: HTMLElement,
	host: PanelHost,
	all: JoinedTask[],
	matches: (task: JoinedTask) => boolean
): void {
	const board = root.createDiv("tl-board");
	const columns = host.plugin.settings.boardColumns;

	for (const id of columns) {
		const def = BUCKETS.find((b) => b.id === id);
		if (!def) continue;
		const tasks = all
			.filter((t) =>
				id === "done" ? t.done : t.bucket === id && !t.done
			)
			.filter(matches)
			.sort(host.compare);
		renderColumn(board, host, def.id, def.label, def.icon, def.empty, tasks);
	}
}

function renderColumn(
	board: HTMLElement,
	host: PanelHost,
	id: Bucket | "done",
	label: string,
	icon: string,
	empty: string,
	tasks: JoinedTask[]
): void {
	const column = board.createDiv("tl-column");
	const head = column.createDiv("tl-column-head");
	const iconEl = head.createSpan("tl-column-icon");
	setIcon(iconEl, icon);
	head.createSpan({ cls: "tl-column-title", text: label });
	head.createSpan({ cls: "tl-column-count", text: String(tasks.length) });
	const body = column.createDiv("tl-column-body");
	host.dropTarget(column, (task) => {
		const alreadyHere = id === "done" ? task.done : task.bucket === id;
		if (alreadyHere) return;
		host.fileInto(task, id);
	});
	if (tasks.length === 0) {
		body.createDiv({ cls: "tl-column-empty", text: empty });
		return;
	}
	for (const task of tasks) {
		host.card(body, task, { nested: true, terse: true });
	}
}
