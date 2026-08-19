/**
 * The GTD buckets a task line can be filed into. A bucket is determined by which
 * file the line lives in.
 */
export type Bucket =
	| "inbox"
	| "next"
	| "project"
	| "waiting"
	| "someday"
	| "trash"
	| "reference";

export type ActiveView = Bucket | "done";

export type ViewMode = "list" | "board" | "calendar";

export interface PriorityLabel {
	name: string;
	color: string;
}

export interface EisenhowerTags {
	urgent: string;
	notUrgent: string;
	important: string;
	notImportant: string;
}

export interface GtdSettings {
	file: {
		inbox: string;
		next: string;
		waiting: string;
		someday: string;
		projects: string;
		projectFolder: string;
		reference: string;
		trash: string;
	};
	trash: { keep: number };
	priority: {
		tags: EisenhowerTags;
		labels: PriorityLabel[];
	};
	dueSyntax: string;
	waitingSyntax: string;
	contexts: string[];
	boardColumns: Array<Bucket | "done">;
	showFolder: boolean;
	captureNote: string;
	lastBucket: ActiveView;
	lastMode: ViewMode;
}

export interface Task {
	id: string;
	path: string;
	line: number;
	raw: string;
	text: string;
	indent: number;
	done: boolean;
	bucket: Bucket;
	context?: string;
	urgent?: boolean;
	important?: boolean;
	due?: string;
	waitingFor?: string;
	parentId?: string;
	projectUid?: string;
}

export interface JoinedTask extends Task {
	item: Task;
	inherited?: boolean;
}

export interface BucketDef {
	id: Bucket | "done";
	label: string;
	icon: string;
	empty: string;
}

export const BUCKETS: BucketDef[] = [
	{ id: "inbox", label: "Inbox", icon: "inbox", empty: "Inbox zero." },
	{ id: "next", label: "Next", icon: "zap", empty: "No next actions filed yet." },
	{
		id: "project",
		label: "Projects",
		icon: "layers",
		empty: "No projects. A project is any outcome needing more than one action.",
	},
	{ id: "waiting", label: "Waiting", icon: "hourglass", empty: "Nothing delegated." },
	{ id: "someday", label: "Someday", icon: "cloud", empty: "Nothing parked for later." },
	{ id: "reference", label: "Reference", icon: "bookmark", empty: "No reference material." },
	{ id: "done", label: "Done", icon: "check-circle", empty: "Nothing done yet." },
	{ id: "trash", label: "Trash", icon: "trash-2", empty: "Trash is empty." },
];

export const DEFAULT_SETTINGS: GtdSettings = {
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
	trash: { keep: 200 },
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
	contexts: [
		"@computer",
		"@phone",
		"@workshop",
		"@work",
		"@home",
		"@errands",
		"@farm",
		"@agenda",
		"@town",
		"@anywhere",
		"@tuesday-meetings",
	],
	boardColumns: ["inbox", "next", "waiting", "someday", "done"],
	showFolder: false,
	captureNote: "gtd/00_inbox.md",
	lastBucket: "inbox",
	lastMode: "list",
};
