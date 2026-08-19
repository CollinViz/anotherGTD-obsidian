import { setIcon } from "obsidian";
import type { PanelHost } from "./host";
import { JoinedTask } from "./types";
import { TextPromptModal } from "./modals";
import {
	isToday,
	longDayLabel,
	monthGrid,
	monthKey,
	monthLabel,
	shiftISO,
	shiftMonth,
	shortDayLabel,
	todayISO,
	weekLabel,
	weekOf,
	weekdayNames,
} from "./dates";

export type CalendarScale = "day" | "week" | "month";

export interface CalendarState {
	scale: CalendarScale;
	anchor: string;
}

export function initialCalendarState(): CalendarState {
	return { scale: "week", anchor: todayISO() };
}

function priorityRank(t: JoinedTask): number {
	if (t.urgent && t.important) return 0;
	if (t.urgent) return 1;
	if (t.important) return 2;
	return 3;
}

function groupByDay(
	all: JoinedTask[],
	matches: (task: JoinedTask) => boolean
): Map<string, JoinedTask[]> {
	const map = new Map<string, JoinedTask[]>();
	for (const task of all) {
		const due = task.due;
		if (!due || task.bucket === "trash" || !matches(task)) continue;
		if (!map.has(due)) map.set(due, []);
		map.get(due)!.push(task);
	}
	return map;
}

export function renderCalendar(
	root: HTMLElement,
	host: PanelHost,
	state: CalendarState,
	all: JoinedTask[],
	matches: (task: JoinedTask) => boolean
): void {
	const wrap = root.createDiv("tl-calendar");
	const byDay = groupByDay(all, matches);
	renderToolbar(wrap, host, state);
	if (state.scale === "day") renderDay(wrap, host, state, byDay);
	else if (state.scale === "week") renderWeek(wrap, host, state, byDay);
	else renderMonth(wrap, host, state, byDay);
	renderUndated(wrap, host, all, matches);
}

function renderToolbar(
	wrap: HTMLElement,
	host: PanelHost,
	state: CalendarState
): void {
	const bar = wrap.createDiv("tl-cal-bar");
	const step = (dir: -1 | 1) => {
		if (state.scale === "day") state.anchor = shiftISO(state.anchor, dir);
		else if (state.scale === "week") state.anchor = shiftISO(state.anchor, dir * 7);
		else {
			const key = shiftMonth(monthKey(state.anchor), dir);
			state.anchor = key + "-01";
		}
		host.rerender();
	};
	const prev = bar.createEl("button", {
		cls: "tl-icon-btn",
		attr: { "aria-label": "Previous" },
	});
	setIcon(prev, "chevron-left");
	prev.onclick = () => step(-1);
	const title = bar.createEl("button", {
		cls: "tl-cal-title",
		text: headingFor(state),
		attr: { "aria-label": "Jump to today" },
	});
	title.onclick = () => {
		state.anchor = todayISO();
		host.rerender();
	};
	const next = bar.createEl("button", {
		cls: "tl-icon-btn",
		attr: { "aria-label": "Next" },
	});
	setIcon(next, "chevron-right");
	next.onclick = () => step(1);
	const scales = wrap.createDiv("tl-cal-scales");
	for (const scale of ["day", "week", "month"] as CalendarScale[]) {
		const b = scales.createEl("button", {
			cls: "tl-cal-scale" + (state.scale === scale ? " is-active" : ""),
			text: scale[0].toUpperCase() + scale.slice(1),
		});
		b.onclick = () => {
			state.scale = scale;
			host.rerender();
		};
	}
}

function headingFor(state: CalendarState): string {
	if (state.scale === "day") return longDayLabel(state.anchor);
	if (state.scale === "week") return weekLabel(state.anchor);
	return monthLabel(monthKey(state.anchor));
}

function renderDay(
	wrap: HTMLElement,
	host: PanelHost,
	state: CalendarState,
	byDay: Map<string, JoinedTask[]>
): void {
	const day = state.anchor;
	const tasks = (byDay.get(day) ?? []).sort(host.compare);
	const section = wrap.createDiv("tl-cal-single");
	renderDayPanel(section, host, day, tasks, { big: true });
}

function renderWeek(
	wrap: HTMLElement,
	host: PanelHost,
	state: CalendarState,
	byDay: Map<string, JoinedTask[]>
): void {
	const grid = wrap.createDiv("tl-week");
	for (const day of weekOf(state.anchor)) {
		const tasks = (byDay.get(day) ?? []).sort(host.compare);
		renderDayPanel(grid, host, day, tasks, {});
	}
}

function renderDayPanel(
	parent: HTMLElement,
	host: PanelHost,
	day: string,
	tasks: JoinedTask[],
	opts: { big?: boolean }
): void {
	const overdue = day < todayISO() && tasks.length > 0;
	const panel = parent.createDiv(
		"tl-day" +
			(isToday(day) ? " is-today" : "") +
			(overdue ? " is-overdue" : "") +
			(opts.big ? " is-big" : "")
	);
	const head = panel.createDiv("tl-day-head");
	head.createSpan({
		cls: "tl-day-label",
		text: opts.big ? longDayLabel(day) : shortDayLabel(day),
	});
	if (isToday(day)) head.createSpan({ cls: "tl-day-today", text: "today" });
	if (tasks.length > 0) {
		head.createSpan({ cls: "tl-day-count", text: String(tasks.length) });
	}
	const add = head.createEl("button", {
		cls: "tl-icon-btn tl-day-add",
		attr: { "aria-label": "Add a task on this day" },
	});
	setIcon(add, "plus");
	add.onclick = (e) => {
		e.stopPropagation();
		promptNewTask(host, day);
	};
	const body = panel.createDiv("tl-day-body");
	if (tasks.length === 0) {
		body.createDiv({
			cls: "tl-day-empty",
			text: opts.big ? "Nothing on this day. Drag one here, or press +." : "—",
		});
	}
	for (const task of tasks) {
		host.card(body, task, { nested: true, terse: true, noReorder: true });
	}
	host.dropTarget(panel, (task) => {
		if (task.due === day) return;
		void host.plugin.setDue(task, day);
	});
}

function renderMonth(
	wrap: HTMLElement,
	host: PanelHost,
	state: CalendarState,
	byDay: Map<string, JoinedTask[]>
): void {
	const key = monthKey(state.anchor);
	const names = wrap.createDiv("tl-cal-weekdays");
	for (const name of weekdayNames()) {
		names.createSpan({ cls: "tl-cal-weekday", text: name });
	}
	const grid = wrap.createDiv("tl-cal-grid");
	const days = monthGrid(key);
	const today = todayISO();
	for (const day of days) {
		const tasks = byDay.get(day) ?? [];
		const outside = monthKey(day) !== key;
		const overdue = day < today && tasks.length > 0;
		const top = tasks.reduce<number>(
			(best, t) => Math.min(best, priorityRank(t)),
			3
		);
		const cell = grid.createEl("button", {
			cls:
				"tl-cal-day" +
				(outside ? " is-outside" : "") +
				(isToday(day) ? " is-today" : "") +
				(state.anchor === day ? " is-selected" : "") +
				(overdue ? " is-overdue" : ""),
			attr: { "aria-label": `${day}, ${String(tasks.length)} tasks` },
		});
		cell.createSpan({
			cls: "tl-cal-daynum",
			text: String(Number(day.slice(8, 10))),
		});
		if (tasks.length > 0) {
			cell.createSpan({
				cls: "tl-cal-badge" + (top <= 1 ? " is-p1" : top <= 2 ? " is-p2" : ""),
				text: String(tasks.length),
			});
		}
		cell.onclick = () => {
			state.anchor = day;
			host.rerender();
		};
		host.dropTarget(cell, (task) => {
			state.anchor = day;
			void host.plugin.setDue(task, day);
		});
	}
	const inMonth = days
		.filter((d) => monthKey(d) === key && (byDay.get(d) ?? []).length > 0)
		.sort();
	const list = wrap.createDiv("tl-cal-section");
	if (inMonth.length === 0) {
		list.createDiv({
			cls: "tl-cal-hint",
			text: "Nothing dated this month. Drag a task onto a day, or press + on one.",
		});
	}
	for (const day of inMonth) {
		const tasks = (byDay.get(day) ?? []).sort(host.compare);
		renderDayPanel(list, host, day, tasks, {});
	}
}

function renderUndated(
	wrap: HTMLElement,
	host: PanelHost,
	all: JoinedTask[],
	matches: (task: JoinedTask) => boolean
): void {
	const undated = all
		.filter(
			(t) =>
				!t.due &&
				!t.done &&
				t.bucket !== "trash" &&
				t.bucket !== "reference" &&
				t.bucket !== "project" &&
				matches(t)
		)
		.sort(host.compare);
	if (undated.length === 0) return;
	const section = wrap.createDiv("tl-cal-section tl-cal-undated");
	section.createDiv({
		cls: "tl-group",
		text: `No date · ${String(undated.length)} — drag onto a day`,
	});
	for (const task of undated.slice(0, 30)) {
		host.card(section, task, { noReorder: true, terse: true });
	}
	if (undated.length > 30) {
		section.createDiv({
			cls: "tl-cal-hint",
			text: `and ${String(undated.length - 30)} more`,
		});
	}
}

function promptNewTask(host: PanelHost, day: string): void {
	new TextPromptModal(host.app, {
		title: "New task on " + longDayLabel(day),
		placeholder: "What needs doing?",
		cta: "Create",
		onSubmit: (text) => {
			void host.plugin.captureTask(text, undefined, "inbox", day);
		},
	}).open();
}
