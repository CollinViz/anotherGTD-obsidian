import { createSuite } from "./harness.mjs";
import { makeApp } from "./obsidian-stub.mjs";

const DEFAULT_SETTINGS = {
	file: {
		inbox: "gtd/00_inbox.md",
		next: "gtd/10_next-actions.md",
		waiting: "gtd/20_waiting-for.md",
		someday: "gtd/40_someday-maybe.md",
		projects: "gtd/30_projects.md",
		projectFolder: "gtd/projects",
		reference: "gtd/reference",
		trash: "gtd/trash.md",
	},
	trash: { keep: 3 },
	priority: {
		tags: {
			urgent: "#urgent",
			notUrgent: "#not-urgent",
			important: "#important",
			notImportant: "#not-important",
		},
		labels: [],
	},
	dueSyntax: "#due(yyyy-mm-dd)",
	waitingSyntax: "#waiting-on: {name}",
	contexts: ["@home", "@work"],
	boardColumns: ["inbox", "next", "waiting", "someday", "done"],
	showFolder: false,
	captureNote: "gtd/00_inbox.md",
	lastBucket: "inbox",
	lastMode: "list",
};

export default async function run(mod) {
	const { TaskStore } = mod;

	function setup(files = {}) {
		const app = makeApp(files);
		const settings = { ...DEFAULT_SETTINGS };
		return { app, store: new TaskStore(app, settings), settings };
	}

	const { eq, results } = createSuite("store");

	// --- scan checkbox lines ------------------------------------------------
	{
		const { store } = setup({
			"gtd/00_inbox.md": "- [ ] Buy milk #not-urgent #not-important\n- [x] Done thing\n",
		});
		const tasks = await store.scan();
		eq(tasks.length, 2, "scan finds checkbox lines");
		eq(tasks[0].text, "Buy milk", "clean text strips tags");
		eq(tasks[1].done, true, "checked checkbox is done");
		eq(tasks[0].bucket, "inbox", "inbox bucket");
	}

	// --- move to next with context ------------------------------------------
	{
		const { app, store } = setup({
			"gtd/00_inbox.md": "- [ ] Buy milk #not-urgent #not-important\n",
			"gtd/10_next-actions.md": "## @home\n",
		});
		const tasks = await store.scan();
		await store.moveToBucket(tasks[0], "next", { context: "@home" });
		const next = await app.vault.adapter.read("gtd/10_next-actions.md");
		eq(next.includes("## @home"), true, "heading preserved");
		eq(next.includes("- [ ] Buy milk"), true, "task moved to next");
		const inbox = await app.vault.adapter.read("gtd/00_inbox.md");
		eq(inbox.includes("Buy milk"), false, "task removed from inbox");
	}

	// --- move to waiting requires person ------------------------------------
	{
		const { store } = setup({
			"gtd/00_inbox.md": "- [ ] Buy milk #not-urgent #not-important\n",
		});
		const tasks = await store.scan();
		let threw = false;
		try {
			await store.moveToBucket(tasks[0], "waiting");
		} catch {
			threw = true;
		}
		eq(threw, true, "waiting without person throws");
	}

	// --- set due -------------------------------------------------------------
	{
		const { app, store } = setup({
			"gtd/00_inbox.md": "- [ ] Buy milk #not-urgent #not-important\n",
		});
		const tasks = await store.scan();
		await store.setDue(tasks[0], "2026-08-25");
		const inbox = await app.vault.adapter.read("gtd/00_inbox.md");
		eq(inbox.includes("#due(2026-08-25)"), true, "due tag added");
		const tasks2 = await store.scan();
		eq(tasks2[0].due, "2026-08-25", "due parsed back");
	}

	// --- set priority --------------------------------------------------------
	{
		const { app, store } = setup({
			"gtd/00_inbox.md": "- [ ] Buy milk #not-urgent #not-important\n",
		});
		const tasks = await store.scan();
		await store.setPriority(tasks[0], true, true);
		const inbox = await app.vault.adapter.read("gtd/00_inbox.md");
		eq(inbox.includes("#urgent"), true, "urgent tag added");
		eq(inbox.includes("#important"), true, "important tag added");
		eq(inbox.includes("#not-urgent"), false, "not-urgent replaced");
		const tasks2 = await store.scan();
		eq(tasks2[0].urgent, true, "urgent parsed");
		eq(tasks2[0].important, true, "important parsed");
	}

	// --- toggle done ---------------------------------------------------------
	{
		const { app, store } = setup({
			"gtd/00_inbox.md": "- [ ] Buy milk #not-urgent #not-important\n",
		});
		let tasks = await store.scan();
		await store.toggleDone(tasks[0]);
		let inbox = await app.vault.adapter.read("gtd/00_inbox.md");
		eq(inbox.includes("- [x] Buy milk"), true, "checkbox toggled to done");
		tasks = await store.scan();
		await store.toggleDone(tasks[0]);
		inbox = await app.vault.adapter.read("gtd/00_inbox.md");
		eq(inbox.includes("- [ ] Buy milk"), true, "checkbox toggled back");
	}

	// --- trash caps size ----------------------------------------------------
	{
		const { app, store } = setup({
			"gtd/00_inbox.md": "- [ ] one #not-urgent #not-important\n- [ ] two #not-urgent #not-important\n- [ ] three #not-urgent #not-important\n- [ ] four #not-urgent #not-important\n",
		});
		let tasks = await store.scan();
		for (const t of tasks) await store.moveToBucket(t, "trash");
		const trash = await app.vault.adapter.read("gtd/trash.md");
		const kept = trash.split("\n").filter((l) => l.startsWith("- [")).length;
		eq(kept, 3, "trash keeps only last 3 tasks");
	}

	// --- delete context moves tasks to inbox --------------------------------
	{
		const { app, store } = setup({
			"gtd/10_next-actions.md": "## @home\n- [ ] Clean desk #not-urgent #not-important\n## @work\n- [ ] Email boss #not-urgent #not-important\n",
			"gtd/00_inbox.md": "",
		});
		await store.deleteContext("@home");
		const next = await app.vault.adapter.read("gtd/10_next-actions.md");
		eq(next.includes("Clean desk"), false, "deleted context task removed");
		eq(next.includes("## @home"), false, "deleted context heading removed");
		const inbox = await app.vault.adapter.read("gtd/00_inbox.md");
		eq(inbox.includes("Clean desk"), true, "deleted context task moved to inbox");
		eq(inbox.includes("Email boss"), false, "other context untouched");
	}

	// --- capture appends to inbox -------------------------------------------
	{
		const { app, store } = setup({
			"gtd/00_inbox.md": "- [ ] existing #not-urgent #not-important\n",
		});
		await store.capture("new task", "inbox");
		const inbox = await app.vault.adapter.read("gtd/00_inbox.md");
		eq(inbox.includes("- [ ] new task"), true, "capture appends");
		eq(inbox.includes("#not-urgent"), true, "capture adds default tags");
	}

	// --- create project ------------------------------------------------------
	{
		const { app, store } = setup({
			"gtd/30_projects.md": "",
		});
		await store.createProject("Renovate kitchen");
		const projects = await app.vault.adapter.read("gtd/30_projects.md");
		eq(projects.includes("- [ ] Renovate kitchen"), true, "project index updated");
		const file = await app.vault.adapter.read("gtd/projects/Renovate kitchen.md");
		eq(file.includes("- [ ] Renovate kitchen"), true, "project file created");
	}

	return results;
}
