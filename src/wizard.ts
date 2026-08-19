import { Notice } from "obsidian";
import type TaskLoopsPlugin from "./main";
import { Bucket, JoinedTask } from "./types";
import { truncate } from "./text";
import { DateModal } from "./modals";

export type Step =
	| "actionable"
	| "nonactionable"
	| "twomin"
	| "kind"
	| "context"
	| "delegate"
	| "schedule"
	| "project";

export type FilePatch = Parameters<TaskLoopsPlugin["file"]>[1];

export interface Wizard {
	step: Step;
	history: Step[];
	draft: { waitingFor?: string; due?: string; pending?: FilePatch };
}

export interface WizardHost {
	plugin: TaskLoopsPlugin;
	rerender(): void;
	cancelWizard(id: string): void;
}

export function renderWizard(
	host: WizardHost,
	card: HTMLElement,
	task: JoinedTask,
	w: Wizard
): void {
	const box = card.createDiv("tl-wizard");

	const go = (step: Step) => {
		w.history.push(w.step);
		w.step = step;
		host.rerender();
	};

	const file = (patch: FilePatch) => {
		host.cancelWizard(task.id);
		void host.plugin.file(task, patch);
	};

	const finish = (patch: FilePatch) => {
		const projects = host.plugin.projects(host.plugin.joined());
		const askable =
			projects.length > 0 && !task.projectUid && patch.bucket !== "project";
		if (!askable) {
			file(patch);
			return;
		}
		w.draft.pending = patch;
		go("project");
	};

	const nav = box.createDiv("tl-wizard-nav");
	if (w.history.length > 0) {
		const back = nav.createEl("button", { cls: "tl-link", text: "← Back" });
		back.onclick = () => {
			w.step = w.history.pop()!;
			host.rerender();
		};
	} else {
		nav.createSpan();
	}
	const cancel = nav.createEl("button", { cls: "tl-link", text: "Cancel" });
	cancel.onclick = () => {
		host.cancelWizard(task.id);
		host.rerender();
	};

	const ask = (text: string) => box.createDiv({ cls: "tl-question", text });
	const choices = () => box.createDiv("tl-choices");
	const choice = (
		parent: HTMLElement,
		label: string,
		hint: string,
		onClick: () => void,
		cls = ""
	) => {
		const b = parent.createEl("button", { cls: "tl-choice " + cls });
		b.createSpan({ cls: "tl-choice-label", text: label });
		if (hint) b.createSpan({ cls: "tl-choice-hint", text: hint });
		b.onclick = onClick;
		return b;
	};

	switch (w.step) {
		case "actionable": {
			ask("Is it actionable?");
			const c = choices();
			choice(c, "Yes", "There is a physical next step", () => go("twomin"));
			choice(c, "No", "Nothing to do about it", () => go("nonactionable"));
			break;
		}

		case "nonactionable": {
			ask("Then what is it?");
			const c = choices();
			choice(c, "Someday / Maybe", "Might matter later", () =>
				file({ bucket: "someday" })
			);
			choice(c, "Reference", "Worth keeping, no action", () =>
				file({ bucket: "reference" })
			);
			choice(
				c,
				"Trash",
				"No longer needed",
				() => file({ bucket: "trash" }),
				"is-danger"
			);
			break;
		}

		case "twomin": {
			ask("Will it take under two minutes?");
			const c = choices();
			choice(
				c,
				"Yes — do it now",
				"Finish it instead of filing it",
				() => file({ bucket: "next", done: true }),
				"is-primary"
			);
			choice(c, "No", "It needs to be filed", () => go("kind"));
			break;
		}

		case "kind": {
			ask("How should it be handled?");
			const c = choices();
			choice(c, "Next action", "You do it, as soon as you can", () =>
				go("context")
			);
			choice(c, "Project", "Takes more than one step", () =>
				file({ bucket: "project" })
			);
			choice(c, "Delegate", "Someone else does it", () => go("delegate"));
			choice(c, "Schedule", "It happens on a specific day", () =>
				go("schedule")
			);
			break;
		}

		case "context": {
			ask("Where does it get done?");
			const c = box.createDiv("tl-chips is-grid");
			for (const ctx of host.plugin.settings.contexts) {
				const b = c.createEl("button", { cls: "tl-chip-btn", text: ctx });
				b.onclick = () => finish({ bucket: "next", context: ctx });
			}
			break;
		}

		case "delegate": {
			ask("Waiting on whom?");
			const input = box.createEl("input", {
				cls: "tl-input",
				attr: { placeholder: "Name", spellcheck: "false" },
			});
			input.value = w.draft.waitingFor ?? "";
			const commit = () => {
				const who = input.value.trim();
				if (!who) {
					new Notice("Enter a name first.");
					return;
				}
				finish({ bucket: "waiting", waitingFor: who });
			};
			input.onkeydown = (e) => {
				if (e.key === "Enter") commit();
			};
			input.oninput = () => (w.draft.waitingFor = input.value);
			const c = choices();
			choice(c, "File it", "", commit, "is-primary");
			window.setTimeout(() => input.focus(), 0);
			break;
		}

		case "schedule": {
			new DateModal(host.plugin.app, {
				title: "When does it happen?",
				initial: w.draft.due,
				allowClear: false,
				onPick: (iso) => {
					if (iso) finish({ bucket: "inbox", due: iso });
				},
			}).open();
			break;
		}

		case "project": {
			ask("Part of a project?");
			const pending = w.draft.pending ?? { bucket: "next" as Bucket };
			const c = box.createDiv("tl-chips is-grid");
			for (const p of host.plugin.projects(host.plugin.joined())) {
				const b = c.createEl("button", {
					cls: "tl-chip-btn",
					text: truncate(p.text, 28),
					attr: { "aria-label": p.text },
				});
				b.onclick = () => file({ ...pending, projectUid: p.id });
			}
			const standalone = box.createEl("button", {
				cls: "tl-link tl-skip",
				text: "Standalone",
			});
			standalone.onclick = () => file({ ...pending, projectUid: null });
			break;
		}
	}
}
