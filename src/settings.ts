import { App, PluginSettingTab, Setting } from "obsidian";
import type anotherGtdPlugin from "./main";

export class anotherGtdSettingTab extends PluginSettingTab {
	plugin: anotherGtdPlugin;

	constructor(app: App, plugin: anotherGtdPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Bucket files")
			.setDesc("Paths relative to the vault root. The plugin moves task lines between these files.")
			.addTextArea((t) => {
				const value = JSON.stringify(this.plugin.settings.file, null, 2);
				t.setValue(value).onChange(async (v) => {
					try {
						this.plugin.settings.file = {
							...this.plugin.settings.file,
							...(JSON.parse(v) as Record<string, string>),
						};
						await this.plugin.saveData_();
					} catch {
						// ignore invalid JSON while typing
					}
				});
				t.inputEl.rows = 8;
			});

		new Setting(containerEl)
			.setName("Contexts")
			.setDesc("Offered when filing a next action. One per line.")
			.addTextArea((t) => {
				t.setValue(this.plugin.settings.contexts.join("\n")).onChange(
					async (v) => {
						this.plugin.settings.contexts = v
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveData_();
						this.plugin.refreshViews();
					}
				);
				t.inputEl.rows = 6;
			});

		new Setting(containerEl)
			.setName("Capture note")
			.setDesc("Quick capture appends new tasks to this note.")
			.addText((t) =>
				t
					.setPlaceholder("gtd/00_inbox.md")
					.setValue(this.plugin.settings.captureNote)
					.onChange(async (v) => {
						const path = v.trim() || "gtd/00_inbox.md";
						this.plugin.settings.captureNote = path.endsWith(".md")
							? path
							: path + ".md";
						await this.plugin.saveData_();
					})
			);

		new Setting(containerEl)
			.setName("Show parent folder")
			.setDesc("Display the containing folder next to the note name.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showFolder).onChange(async (v) => {
					this.plugin.settings.showFolder = v;
					await this.plugin.saveData_();
					this.plugin.refreshViews();
				})
			);

		new Setting(containerEl)
			.setName("Board columns")
			.setDesc("Comma-separated list of bucket ids shown on the board.")
			.addText((t) =>
				t
					.setPlaceholder("inbox, next, waiting, someday, done")
					.setValue(this.plugin.settings.boardColumns.join(", "))
					.onChange(async (v) => {
						this.plugin.settings.boardColumns = v
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean) as unknown as typeof this.plugin.settings.boardColumns;
						await this.plugin.saveData_();
						this.plugin.refreshViews();
					})
			);
	}
}
