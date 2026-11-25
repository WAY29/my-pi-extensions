import { unwatchFile, watchFile } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
	CONFIG_DIR_NAME, DefaultPackageManager, getAgentDir, parseArgs, SettingsManager,
	type ExtensionAPI, type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { indexedColor, Input, Key, matchesKey, rgbColor, truncateToWidth } from "@earendil-works/pi-tui";

const sourceBadges = {
	user: { label: "U", color: indexedColor(6) },
	project: { label: "P", color: rgbColor(99, 156, 236) },
	package: { label: "K", color: rgbColor(186, 142, 232) },
	temporary: { label: "T", color: rgbColor(201, 142, 53) },
};
const agentDir = getAgentDir();
const launch = parseArgs(process.argv.slice(2));
const clean = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, "?");

function fingerprint(settings: ReturnType<SettingsManager["getGlobalSettings"]>) {
	return JSON.stringify([settings.extensions, settings.packages]);
}

function setOverride(entries: string[], path: string, baseDir: string, enabled: boolean) {
	const absolute = (value: string) => value.startsWith("builtin:") ? value :
		resolve(baseDir, value.replace(/^~(?=\/)/, homedir()));
	return [...entries.filter(entry => !/^[+-]/.test(entry) || absolute(entry.slice(1)) !== absolute(path)),
		`${enabled ? "+" : "-"}${path}`];
}

function stage(settings: SettingsManager, projectDir: string, rows: ResolvedResource[]) {
	for (const { path, metadata, enabled } of rows) {
		const project = metadata.scope === "project";
		const scope = project ? settings.getProjectSettings() : settings.getGlobalSettings();
		if (metadata.origin === "top-level") {
			const baseDir = project ? projectDir : agentDir;
			const pattern = path.startsWith("builtin:") ? path : relative(baseDir, path);
			const entries = setOverride(scope.extensions ?? [], pattern, baseDir, !enabled);
			if (project) settings.setProjectExtensionPaths(entries);
			else settings.setExtensionPaths(entries);
			continue;
		}

		const packages = (scope.packages ?? []).map(pkg => typeof pkg === "string" ? { source: pkg } : pkg);
		const index = packages.findIndex(pkg => pkg.source === metadata.source);
		const pkg = packages[index];
		if (!pkg || !metadata.packageRoot) throw new Error(`Cannot edit package ${metadata.source}`);
		const entries = pkg.extensions?.length === 0 && pkg.autoload !== false ? ["!**"] : pkg.extensions ?? [];
		const pattern = relative(metadata.packageRoot, path).split("\\").join("/");
		const updated = { ...pkg, extensions: setOverride(entries, pattern, metadata.packageRoot, !enabled) };
		const next = (scope.packages ?? []).map((entry, i) => i === index ? updated : entry);
		if (project) settings.setProjectPackages(next);
		else settings.setPackages(next);
	}
}

export default function (pi: ExtensionAPI) {
	let stopWatching = () => {};
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		stopWatching();
		const projectTrusted = ctx.isProjectTrusted();
		const files = [join(agentDir, "settings.json")];
		if (projectTrusted) files.push(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"));
		const snapshot = () => {
			const settings = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted });
			if (settings.drainErrors().length) return undefined;
			return fingerprint(settings.getGlobalSettings()) + fingerprint(settings.getProjectSettings());
		};
		let previous = snapshot();
		const changed = () => {
			const next = snapshot();
			if (next === undefined || next === previous) return;
			previous = next;
			ctx.ui.notify("Extension or package settings changed. Run /reload when ready.", "info");
		};
		for (const file of files) watchFile(file, { interval: 1000, persistent: false }, changed);
		stopWatching = () => { for (const file of files) unwatchFile(file, changed); };
	});
	pi.on("session_shutdown", () => stopWatching());

	pi.registerCommand("extensions", {
		description: "Search and toggle Pi extensions",
		async handler(_args, ctx) {
			if (ctx.mode !== "tui" || !ctx.isIdle()) {
				ctx.ui.notify("/extensions requires an idle interactive session.", "warning");
				return;
			}
			const projectTrusted = ctx.isProjectTrusted();
			const openSettings = () => {
				const settings = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted });
				const errors = settings.drainErrors();
				if (errors.length) throw new Error(errors.map(({ error }) => error.message).join("; "));
				return settings;
			};
			const settings = openSettings();
			const manager = new DefaultPackageManager({ cwd: ctx.cwd, agentDir, settingsManager: settings, commandOutput: "capture" });
			const { extensions, installFailures } = await manager.resolve(async () => "skip");
			const temporary = launch.extensions?.length ?
				(await manager.resolveExtensionSources(launch.extensions, { temporary: true })).extensions : [];
			const resources = new Map(extensions.map(row => [row.path, row]));
			for (const row of temporary) resources.set(row.path, row);
			const rows = [...resources.values()].filter(row => !row.path.startsWith("builtin:")).map(resource => {
				const { path, metadata } = resource;
				const file = basename(path);
				const name = /^index\.[jt]s$/.test(file) ? basename(dirname(path)) : file.replace(/\.ts$/, "");
				const source = `${metadata.scope}${metadata.origin === "package" ? ` · ${metadata.source}` : ""}`;
				const type = metadata.scope !== "temporary" && metadata.origin === "package" ? "package" : metadata.scope;
				return { resource, name: clean(name), badge: sourceBadges[type], search: `${name} ${source} ${path}`.toLowerCase() };
			}).sort((a, b) => a.name.localeCompare(b.name));
			const pending = new Set<ResolvedResource>();
			const apply = await ctx.ui.custom<boolean>((tui, theme, keys, done) => {
				const input = new Input();
				let searching = false;
				let focused = false;
				let selected = 0;
				const filtered = () => rows.filter(row => row.search.includes(input.getValue().trim().toLowerCase()));
				return {
					get focused() { return focused; },
					set focused(value) { focused = value; input.focused = value && searching; },
					invalidate() { input.invalidate(); },
					render(width) {
						const matches = filtered();
						const limit = Math.max(1, Math.min(12, tui.terminal.rows - 8));
						const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), matches.length - limit));
						return [
							theme.fg("accent", `Extensions · ${matches.length}/${rows.length} · ${pending.size} pending`),
							...input.render(width),
							...matches.slice(start, start + limit).map(({ resource, name, badge }, i) => {
								const locked = resource.metadata.scope === "temporary";
								const changed = pending.has(resource);
								const enabled = locked || (!launch.noExtensions && resource.enabled !== changed);
								const active = i + start === selected;
								const line = `${active ? "›" : " "} [${enabled ? "·" : " "}]${changed ? "*" : " "} ${name}`;
								return `${theme.style(badge.label, { fg: badge.color })} ${active ? theme.fg("accent", line) : line}`;
							}),
							...(matches.length ? [] : ["No matching extensions"]),
							...(matches[selected] ? [theme.fg("dim", clean(matches[selected].resource.path))] : []),
							...(installFailures?.length ? [`${installFailures.length} configured package(s) unavailable`] : []),
							theme.fg("dim", searching ? "Type to search · Tab Back to list" : "Tab Search · ↑↓ Move · Enter/Space Toggle · s Apply · Esc Discard"),
						].map(line => truncateToWidth(line, width));
					},
					handleInput(data) {
						const matches = filtered();
						if (keys.matches(data, "tui.select.cancel")) return done(false);
						if (matchesKey(data, Key.tab)) {
							searching = !searching;
							input.focused = focused && searching;
							tui.requestRender();
							return;
						}
						if (!searching && matchesKey(data, "s") && pending.size > 0) return done(true);
						if (keys.matches(data, "tui.select.up")) selected = Math.max(0, selected - 1);
						else if (keys.matches(data, "tui.select.down")) selected = Math.min(Math.max(0, matches.length - 1), selected + 1);
						else if ((!searching && matchesKey(data, Key.space)) ||
							(keys.matches(data, "tui.select.confirm") && !(searching && matchesKey(data, Key.space)))) {
							const row = matches[selected]?.resource;
							if (row?.metadata.scope === "temporary") ctx.ui.notify("Remove the -e argument and restart Pi to stop loading this extension.", "info");
							else if (launch.noExtensions) ctx.ui.notify("Restart without --no-extensions to manage these entries.", "info");
							else if (row && !pending.delete(row)) pending.add(row);
						} else if (searching) {
							const before = input.getValue();
							input.handleInput(data);
							if (input.getValue() !== before) selected = 0;
						}
						tui.requestRender();
					},
				};
			}, { blocked: { kind: "question", message: "Manage extensions" } });
			if (!apply) return;
			const self = pi.getCommands().find(command => command.name === "extensions" && command.source === "extension")?.sourceInfo?.path;
			if ([...pending].some(row => row.path === self && row.enabled) &&
				!await ctx.ui.confirm("Disable /extensions?", "Run pi config to re-enable the manager, then /reload.")) return;

			const fresh = openSettings();
			if (fingerprint(fresh.getGlobalSettings()) !== fingerprint(settings.getGlobalSettings()) ||
				fingerprint(fresh.getProjectSettings()) !== fingerprint(settings.getProjectSettings())) {
				ctx.ui.notify("Extension settings changed while the list was open. Reopen /extensions and try again.", "warning");
				return;
			}
			stage(fresh, join(ctx.cwd, CONFIG_DIR_NAME), [...pending]);
			await fresh.flush();
			const errors = fresh.drainErrors();
			if (errors.length) throw new Error(`Could not save all changes: ${errors.map(({ error }) => error.message).join("; ")}`);
			await ctx.reload();
		},
	});
}
