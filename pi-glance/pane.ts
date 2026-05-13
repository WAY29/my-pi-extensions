import { decodeKittyPrintable, Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { formatWorkspaceModelRule, listWorkspaceModelRules, normalizeWorkspaceDirectory, parseWorkspaceModelRuleEntry } from "./auto-model.js";
import { cloneConfig, defaultConfig, moveSegment, toggleSegment } from "./config.js";
import { displayDirectory, formatWorkspaceLabel } from "./format.js";
import { renderInputSurface, renderInputSurfacePreview } from "./renderer.js";
import { SEGMENT_BY_ID } from "./segments.js";
import type {
	ContextDisplayMode,
	ContextUnknownMode,
	GitShaMode,
	GlanceConfig,
	GlanceState,
	GlanceThemeName,
	IconMode,
	ModelThinkingMode,
	SegmentId,
	TokensCacheMode,
	TokensDisplayMode,
	WorkspaceLabelMode,
} from "./types.js";

type PaneFocus = "categories" | "settings" | "values";
type CategoryId = "general" | "autoModel" | "permissionGate" | SegmentId;
type Category = { id: CategoryId; label: string };
type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };
type Done = (result: PaneResult) => void;
type SettingKind = "toggle" | "cycle" | "input" | "info";
type SettingRow = { label: string; value: string; rawValue?: string; emptyValue?: string; hint?: string; kind: SettingKind; mutate?: () => void; edit?: (value: string) => boolean | void };
type Tone = (text: string) => string;

interface EditingField {
	label: string;
	value: string;
	emptyValue: string;
	apply: (value: string) => boolean | void;
}

interface PaneColors {
	accent: Tone;
	muted: Tone;
	dim: Tone;
	warn: Tone;
	success: Tone;
}

interface PaneLayout {
	width: number;
	contentWidth: number;
	outerPadding: string;
	categoryWidth: number;
	settingLabelWidth: number;
	valueWidth: number;
	settingsWidth: number;
	asideWidth: number;
	columnGap: string;
	asideGap: string;
	asideSeparator: string;
	showAside: boolean;
}

type HelpShortcut = { key: string; label: string };

type CategoryViewModel = Category & {
	selected: boolean;
	hasFocus: boolean;
	enabled?: boolean;
};

type SettingViewModel = Omit<SettingRow, "mutate"> & {
	selected: boolean;
	labelHasFocus: boolean;
	valueHasFocus: boolean;
};

interface GlancePaneViewModel {
	dirty: boolean;
	status: string;
	categories: CategoryViewModel[];
	selectedCategory?: Category;
	settingsTitle: string;
	settings: SettingViewModel[];
	selectedHint?: string;
	help: HelpShortcut[];
}

const PANE_FOCUS_ORDER: PaneFocus[] = ["categories", "settings", "values"];

const PANE_SPACING = {
	outerPadding: 2,
	contentInset: 4,
	categoryWidth: 16,
	settingLabelWidth: 20,
	valueWidth: 24,
	minValueWidth: 8,
	asideWidth: 36,
	minAsideWidth: 22,
	columnGap: 4,
	asideGap: 4,
	minContentWidth: 10,
	asideSeparator: "│",
} as const;

const POLL_INTERVALS = [2000, 5000, 10000, 30000] as const;
const CONTEXT_DISPLAY_LABELS: Record<ContextDisplayMode, string> = {
	"percent+tokens": "percent / tokens",
	percent: "percent",
	tokens: "tokens",
};
const TOKENS_DISPLAY_LABELS: Record<TokensDisplayMode, string> = {
	"input-output": "input / output",
	total: "total",
};
const WORKSPACE_LABEL_MODES: WorkspaceLabelMode[] = ["name", "smart", "path"];

function nextIn<T extends string>(current: T, values: readonly T[]): T {
	const index = values.indexOf(current);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function nextNumber<T extends number>(current: number, values: readonly T[]): T {
	const index = values.indexOf(current as T);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function plainLine(parts: string[], width: number): string {
	return truncateToWidth(parts.join(""), width, "…");
}

function makePaneLayout(width: number): PaneLayout {
	const contentWidth = Math.max(PANE_SPACING.minContentWidth, width - PANE_SPACING.contentInset);
	const categoryWidth = PANE_SPACING.categoryWidth;
	const columnGapWidth = PANE_SPACING.columnGap;
	const asideFrameWidth = PANE_SPACING.asideGap + visibleWidth(PANE_SPACING.asideSeparator) + 1;
	const settingLabelWidth = PANE_SPACING.settingLabelWidth;
	const valueRoom = contentWidth - categoryWidth - columnGapWidth - settingLabelWidth - columnGapWidth;
	const valueWidth = Math.max(PANE_SPACING.minValueWidth, Math.min(PANE_SPACING.valueWidth, valueRoom));
	const settingsWidth = settingLabelWidth + columnGapWidth + valueWidth;
	const coreWidth = categoryWidth + columnGapWidth + settingsWidth;
	const asideRoom = contentWidth - coreWidth - asideFrameWidth;
	const showAside = asideRoom >= PANE_SPACING.minAsideWidth;
	const asideWidth = showAside ? Math.min(PANE_SPACING.asideWidth, asideRoom) : 0;
	return {
		width,
		contentWidth,
		outerPadding: " ".repeat(PANE_SPACING.outerPadding),
		categoryWidth,
		settingLabelWidth,
		valueWidth,
		settingsWidth,
		asideWidth,
		columnGap: " ".repeat(PANE_SPACING.columnGap),
		asideGap: " ".repeat(PANE_SPACING.asideGap),
		asideSeparator: PANE_SPACING.asideSeparator,
		showAside,
	};
}

function paneLine(layout: PaneLayout, parts: string[]): string {
	return plainLine([layout.outerPadding, ...parts], layout.width);
}

function padRightAnsi(text: string, width: number): string {
	const extra = Math.max(0, width - visibleWidth(text));
	return `${text}${" ".repeat(extra)}`;
}

function spreadAnsi(left: string, right: string, width: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + rightWidth + 1 > width) {
		const leftBudget = Math.max(0, width - rightWidth - 1);
		if (leftBudget <= 0) return truncateToWidth(right, width, "…");
		return `${truncateToWidth(left, leftBudget, "…")} ${right}`;
	}
	return `${left}${" ".repeat(Math.max(0, width - leftWidth - rightWidth))}${right}`;
}

function sameConfig(a: GlanceConfig, b: GlanceConfig): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function makePaneColors(theme: Theme): PaneColors {
	return {
		accent: (s: string) => theme.fg("accent", s),
		muted: (s: string) => theme.fg("muted", s),
		dim: (s: string) => theme.fg("dim", s),
		warn: (s: string) => theme.fg("warning", s),
		success: (s: string) => theme.fg("success", s),
	};
}

function shortcut(colors: PaneColors, key: string, label: string): string {
	return `${colors.accent(`[${key}]`)} ${colors.dim(label)}`;
}

function helpText(help: HelpShortcut[], colors: PaneColors): string {
	return help.map((item) => shortcut(colors, item.key, item.label)).join(colors.dim("  ·  "));
}

function focusGap(gap: string, colors: PaneColors): string {
	const gapWidth = visibleWidth(gap);
	if (gapWidth <= 1) return colors.accent("›");
	return `${" ".repeat(Math.max(0, gapWidth - 2))}${colors.accent("› ")}`;
}

function onOff(value: boolean): string {
	return value ? "on" : "off";
}

function segmentLabel(id: SegmentId): string {
	return SEGMENT_BY_ID.get(id)?.label ?? id;
}

function formatPolling(ms: number): string {
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

function contextDisplayLabel(mode: ContextDisplayMode): string {
	return CONTEXT_DISPLAY_LABELS[mode];
}

function tokensDisplayLabel(mode: TokensDisplayMode): string {
	return TOKENS_DISPLAY_LABELS[mode];
}

function toggleRow(label: string, value: boolean, hint: string, mutate: () => void): SettingRow {
	return { label, value: onOff(value), hint, kind: "toggle", mutate };
}

function cycleRow(label: string, value: string, hint: string, mutate: () => void): SettingRow {
	return { label, value, hint, kind: "cycle", mutate };
}

function infoRow(label: string, value: string, hint: string): SettingRow {
	return { label, value, hint, kind: "info" };
}

function inputRow(label: string, value: string, hint: string, edit: (value: string) => boolean | void, emptyValue = "fallback", rawValue = value): SettingRow {
	return { label, value: value || emptyValue, rawValue, emptyValue, hint, kind: "input", edit };
}

function shortcutKey(data: string): string {
	return decodeKittyPrintable(data) ?? data;
}

function autoModelPathSummary(directory: string, width: number): string {
	return formatWorkspaceLabel(directory, displayDirectory(directory), "path", width, 200);
}

function autoModelRuleSummary(directory: string, model: string): string {
	return `${autoModelPathSummary(directory, 11)} → ${model}`;
}

function isStaticCategory(id: CategoryId): boolean {
	return id === "general" || id === "autoModel" || id === "permissionGate";
}

class GlanceConfigPane implements Component {
	private readonly initial: GlanceConfig;
	private readonly currentWorkspacePath: string;
	private draft: GlanceConfig;
	private focus: PaneFocus = "categories";
	private catIndex = 0;
	private setIndex = 0;
	private status = "";
	private editing?: EditingField;

	constructor(
		initial: GlanceConfig,
		private readonly theme: Theme,
		private readonly done: Done,
		private readonly requestRender: () => void,
		private readonly previewState?: GlanceState,
	) {
		this.initial = cloneConfig(initial);
		this.draft = cloneConfig(initial);
		this.currentWorkspacePath = previewState?.workspace.path ? normalizeWorkspaceDirectory(previewState.workspace.path) : "";
	}

	invalidate(): void {}

	private isDirty(): boolean {
		return !sameConfig(this.draft, this.initial);
	}

	private getViewModel(): GlancePaneViewModel {
		const categories = this.getCategories();
		const selectedCategory = categories[this.catIndex];
		const settings = selectedCategory ? this.getSettings(selectedCategory.id) : [];
		return {
			dirty: this.isDirty(),
			status: this.status,
			categories: categories.map((cat, index) => {
				const segment = isStaticCategory(cat.id) ? undefined : this.draft.segments.find((s) => s.id === cat.id);
				const enabled = cat.id === "permissionGate" ? this.draft.permissionGate.enabled : segment?.enabled;
				return {
					...cat,
					selected: index === this.catIndex,
					hasFocus: this.focus === "categories",
					enabled,
				};
			}),
			selectedCategory,
			settingsTitle: selectedCategory ? (selectedCategory.id === "general" ? "General" : selectedCategory.label) : "",
			settings: settings.map((row, index) => ({
				label: row.label,
				value: row.value,
				rawValue: row.rawValue,
				emptyValue: row.emptyValue,
				hint: row.hint,
				kind: row.kind,
				selected: index === this.setIndex,
				labelHasFocus: this.focus === "settings",
				valueHasFocus: this.focus === "values",
			})),
			selectedHint: settings[this.setIndex]?.hint,
			help: this.helpShortcuts(),
		};
	}

	private helpShortcuts(): HelpShortcut[] {
		if (this.editing) {
			return [
				{ key: "Enter", label: "save" },
				{ key: "Esc", label: "cancel" },
				{ key: "Ctrl+U", label: "clear" },
			];
		}

		const stable: HelpShortcut[] = [
			{ key: "←→↑↓", label: "move" },
			{ key: "S", label: "save" },
			{ key: "R", label: "reset" },
		];

		switch (this.focus) {
			case "categories":
				return [...stable, { key: "J/K", label: "switch" }, { key: "Esc", label: "cancel" }];
			case "settings":
				return [...stable, { key: "Esc", label: "back" }];
			case "values":
				return [...stable, { key: "Enter", label: "change" }, { key: "Esc", label: "back" }];
		}
	}

	private getCategories(): Category[] {
		return [
			{ id: "general", label: "General" },
			...this.draft.segments.map((segment) => ({
				id: segment.id,
				label: segmentLabel(segment.id),
			})),
			{ id: "autoModel", label: "Auto model" },
			{ id: "permissionGate", label: "Permission Gate" },
		];
	}

	private getSettings(id: CategoryId): SettingRow[] {
		switch (id) {
			case "general":
				return this.generalRows();
			case "autoModel":
				return this.autoModelRows();
			case "permissionGate":
				return this.permissionGateRows();
			case "sandbox":
				return this.sandboxRows();
			case "git":
				return this.gitRows();
			case "plan":
				return this.planRows();
			case "context":
				return this.contextRows();
			case "cost":
				return this.costRows();
			case "tokens":
				return this.tokensRows();
			case "model":
				return this.modelRows();
			default:
				return [];
		}
	}

	private generalRows(): SettingRow[] {
		return [
			toggleRow("Enabled", this.draft.enabled, "Temporarily disable pi-glance.", () => {
				this.draft.enabled = !this.draft.enabled;
			}),
			cycleRow("Theme", this.draft.theme, "Switch the palette.", () => {
				this.draft.theme = nextIn(this.draft.theme, ["light", "dark", "catppuccin-latte", "catppuccin-mocha"] as GlanceThemeName[]);
			}),
			cycleRow("Icons", this.draft.icons, "Plain works without Nerd Font.", () => {
				this.draft.icons = nextIn(this.draft.icons, ["plain", "nerd"] as IconMode[]);
			}),
			cycleRow("Min input rows", `${this.draft.editor.minContentRows}`, "Set the resting editor height.", () => {
				this.draft.editor.minContentRows = nextNumber(this.draft.editor.minContentRows, [2, 3, 4] as const);
			}),
			toggleRow("Adaptive width", this.draft.display.adaptive, "Drop later segments first.", () => {
				this.draft.display.adaptive = !this.draft.display.adaptive;
			}),
			cycleRow("Workspace label", this.draft.display.workspaceLabel, "Use ~/ path when space allows.", () => {
				this.draft.display.workspaceLabel = nextIn(this.draft.display.workspaceLabel, WORKSPACE_LABEL_MODES);
			}),
			toggleRow("Title enabled", this.draft.title.enabled, "Show a session title below the input box.", () => {
				this.draft.title.enabled = !this.draft.title.enabled;
			}),
			inputRow("Title model", this.draft.title.model, "Use model or provider/model. Empty uses local fallback.", (value) => {
				this.draft.title.model = value.trim();
			}),
		];
	}

	private autoModelRows(): SettingRow[] {
		const rules = listWorkspaceModelRules(this.draft.autoModel.workspaceModels);
		const currentMatch = this.currentWorkspacePath ? this.draft.autoModel.workspaceModels[this.currentWorkspacePath] ?? "" : "";
		return [
			inputRow(
				"Add rule",
				this.currentWorkspacePath ? "current cwd" : "",
				"Press Enter to edit the path first, then the model. Bare model names use the current provider.",
				(value) => this.beginAutoModelRuleEdit("Add rule", undefined, value),
				"new",
				this.currentWorkspacePath,
			),
			...rules.map((rule, index) => {
				const fullRule = formatWorkspaceModelRule(rule);
				return inputRow(
					`Rule ${index + 1}`,
					autoModelRuleSummary(rule.directory, rule.model),
					`Edit ${fullRule}. First update the path, then the model. Clear the path to delete this rule. Bare model names use the current provider.`,
					(value) => this.beginAutoModelRuleEdit(`Rule ${index + 1}`, rule.directory, value),
					"delete",
					rule.directory,
				);
			}),
			infoRow(
				"Current cwd",
				this.currentWorkspacePath ? autoModelPathSummary(this.currentWorkspacePath, 24) : "unavailable",
				this.currentWorkspacePath ? `Current workspace: ${this.currentWorkspacePath}` : "Open /glance inside a workspace to preview auto model rules.",
			),
			infoRow(
				"Current match",
				currentMatch || "default",
				currentMatch ? `session_start will switch to ${currentMatch} for this exact cwd.` : "No exact rule for the current workspace. pi keeps the default model.",
			),
			infoRow("Rules", `${rules.length}`, "Rules match the session cwd exactly. Add a rule first, then edit path and model separately."),
		];
	}

	private permissionGateRows(): SettingRow[] {
		return [
			toggleRow("Enabled", this.draft.permissionGate.enabled, "Prompt before dangerous bash commands like rm, sudo, chmod/chown 777.", () => {
				this.draft.permissionGate.enabled = !this.draft.permissionGate.enabled;
			}),
		];
	}

	private sandboxRows(): SettingRow[] {
		return this.segmentRows("sandbox", [
			toggleRow("Runtime enabled", this.draft.sandbox.enabled, "Enable or disable the actual sandbox state after saving. --no-sandbox still takes priority.", () => {
				this.draft.sandbox.enabled = !this.draft.sandbox.enabled;
			}),
		]);
	}

	private planRows(): SettingRow[] {
		return this.segmentRows("plan", [
			infoRow("Source", "plan-mode", "Listens for plan-mode state events."),
			infoRow("Hidden when idle", "yes", "The segment only appears while plan mode is active or executing."),
		]);
	}

	private contextRows(): SettingRow[] {
		return this.segmentRows("context", [
			cycleRow("Display", contextDisplayLabel(this.draft.context.display), "Choose percent, tokens, or both.", () => {
				this.draft.context.display = nextIn(this.draft.context.display, ["percent+tokens", "percent", "tokens"] as ContextDisplayMode[]);
			}),
			cycleRow("Unknown", this.draft.context.unknown, "Hide when usage is unknown.", () => {
				this.draft.context.unknown = nextIn(this.draft.context.unknown, ["show", "hide"] as ContextUnknownMode[]);
			}),
		]);
	}

	private costRows(): SettingRow[] {
		return this.segmentRows("cost", [
			toggleRow("Hide zero", this.draft.cost.hideZero, "Hide until cost is non-zero.", () => {
				this.draft.cost.hideZero = !this.draft.cost.hideZero;
			}),
			infoRow("Display", "compact USD", "Compact session cost."),
		]);
	}

	private tokensRows(): SettingRow[] {
		return this.segmentRows("tokens", [
			cycleRow("Display", tokensDisplayLabel(this.draft.tokens.display), "Choose input/output or total.", () => {
				this.draft.tokens.display = nextIn(this.draft.tokens.display, ["input-output", "total"] as TokensDisplayMode[]);
			}),
			cycleRow("Cache", this.draft.tokens.cache, "Show or hide cache details.", () => {
				this.draft.tokens.cache = nextIn(this.draft.tokens.cache, ["auto", "show", "hide"] as TokensCacheMode[]);
			}),
		]);
	}

	private modelRows(): SettingRow[] {
		return this.segmentRows("model", [
			cycleRow("Provider label", this.draft.display.showProvider, "Show provider name.", () => {
				this.draft.display.showProvider = nextIn(this.draft.display.showProvider, ["auto", "always", "never"] as const);
			}),
			cycleRow("Thinking label", this.draft.model.showThinking, "Show thinking level.", () => {
				this.draft.model.showThinking = nextIn(this.draft.model.showThinking, ["auto", "always", "never"] as ModelThinkingMode[]);
			}),
		]);
	}

	private gitRows(): SettingRow[] {
		return this.segmentRows("git", [
			toggleRow("Dirty marker", this.draft.git.showDirty, "Conflicts always stay visible.", () => {
				this.draft.git.showDirty = !this.draft.git.showDirty;
			}),
			toggleRow("Ahead / behind", this.draft.git.showAheadBehind, "Show upstream counts.", () => {
				this.draft.git.showAheadBehind = !this.draft.git.showAheadBehind;
			}),
			cycleRow("SHA", this.draft.git.shaMode, "Keep branches quiet unless enabled.", () => {
				this.draft.git.shaMode = nextIn(this.draft.git.shaMode, ["off", "detached", "always"] as GitShaMode[]);
			}),
			cycleRow("Polling", formatPolling(this.draft.git.pollIntervalMs), "Check external Git changes.", () => {
				this.draft.git.pollIntervalMs = nextNumber(this.draft.git.pollIntervalMs, POLL_INTERVALS);
			}),
		]);
	}

	private segmentRows(id: SegmentId, rows: SettingRow[]): SettingRow[] {
		const segment = this.draft.segments.find((s) => s.id === id);
		return [
			toggleRow("Enabled", Boolean(segment?.enabled), "Show or hide this segment.", () => {
				this.draft = toggleSegment(this.draft, id);
			}),
			...rows,
		];
	}

	private beginAutoModelRuleEdit(label: string, previousDirectory: string | undefined, value: string): boolean | void {
		const trimmed = value.trim();
		if (!trimmed) {
			if (previousDirectory) {
				delete this.draft.autoModel.workspaceModels[previousDirectory];
				return;
			}
			this.status = "Path required.";
			return false;
		}

		const directory = normalizeWorkspaceDirectory(trimmed, this.currentWorkspacePath || undefined);
		if (!directory) {
			this.status = "Path required.";
			return false;
		}

		const currentModel = previousDirectory ? this.draft.autoModel.workspaceModels[previousDirectory] ?? "" : "";
		const provider = this.previewState?.model.provider || "the current provider";
		this.editing = {
			label: `${label} model`,
			value: currentModel,
			emptyValue: "model",
			apply: (modelValue) => this.finishAutoModelRuleEdit(previousDirectory, directory, modelValue),
		};
		this.status = `Editing ${label} model. Use model or provider/model. Bare models use ${provider}.`;
		return false;
	}

	private finishAutoModelRuleEdit(previousDirectory: string | undefined, directory: string, value: string): boolean | void {
		const model = value.trim();
		if (!model) {
			this.status = "Model required. Use model or provider/model.";
			return false;
		}
		if (previousDirectory && previousDirectory !== directory) {
			delete this.draft.autoModel.workspaceModels[previousDirectory];
		}
		this.draft.autoModel.workspaceModels[directory] = model;
	}

	private activateCurrent(): void {
		const cat = this.getCategories()[this.catIndex];
		if (!cat) return;
		const settings = this.getSettings(cat.id);
		const row = settings[this.setIndex];
		if (!row) return;

		if (row.kind === "input" && row.edit) {
			this.editing = {
				label: row.label,
				value: row.rawValue ?? "",
				emptyValue: row.emptyValue ?? "fallback",
				apply: row.edit,
			};
			this.status = `Editing ${row.label}. Press Enter to save or Esc to cancel.`;
			return;
		}

		if (!row.mutate) {
			this.status = row.hint ?? `${row.label} is informational.`;
			return;
		}

		row.mutate();
		const next = this.getSettings(cat.id)[this.setIndex];
		this.status = `${row.label} → ${next?.value ?? "updated"}. Press S to save.`;
	}

	private moveCurrentSegment(direction: -1 | 1): void {
		const categories = this.getCategories();
		const cat = categories[this.catIndex];
		if (!cat || isStaticCategory(cat.id)) {
			this.status = "Only status segments can be moved.";
			return;
		}
		const segment = this.draft.segments.find((s) => s.id === cat.id);
		if (!segment) return;

		const firstSegmentIndex = categories.findIndex((item) => !isStaticCategory(item.id));
		const lastSegmentIndex = firstSegmentIndex + this.draft.segments.length - 1;
		const targetCatIndex = this.catIndex + direction;
		if (targetCatIndex < firstSegmentIndex || targetCatIndex > lastSegmentIndex) {
			this.status = direction < 0 ? "Already at the top." : "Already at the bottom.";
			return;
		}

		this.draft = moveSegment(this.draft, segment.id, direction);
		this.catIndex = targetCatIndex;
		this.status = "Segment order updated. Press S to save.";
	}

	private handleEditingInput(data: string): void {
		if (!this.editing) return;

		if (matchesKey(data, Key.enter)) {
			const label = this.editing.label;
			const applied = this.editing.apply(this.editing.value.trim());
			if (applied === false) {
				this.requestRender();
				return;
			}
			this.editing = undefined;
			this.status = `${label} updated. Press S to save.`;
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.editing = undefined;
			this.status = "Edit cancelled.";
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.backspace)) {
			this.editing.value = [...this.editing.value].slice(0, -1).join("");
			this.requestRender();
			return;
		}

		if (data === "\x15" || matchesKey(data, Key.ctrl("u"))) {
			this.editing.value = "";
			this.requestRender();
			return;
		}

		const rawPrintable = !data.includes("\x1b") && !data.includes("\r") && !data.includes("\n") && !data.includes("\t")
			? [...data].filter((char) => char >= " ").join("")
			: "";
		const printable = decodeKittyPrintable(data) ?? rawPrintable;
		if (printable) {
			this.editing.value += printable;
			this.requestRender();
		}
	}

	handleInput(data: string): void {
		if (this.editing) {
			this.handleEditingInput(data);
			return;
		}

		const key = shortcutKey(data);

		if (matchesKey(data, Key.ctrl("c"))) {
			this.done({ action: "cancel" });
			return;
		}
		if (matchesKey(data, Key.escape) || key === "q" || key === "Q") {
			if (this.focus === "categories") {
				this.done({ action: "cancel" });
			} else {
				this.focus = "categories";
				this.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.left)) {
			const index = PANE_FOCUS_ORDER.indexOf(this.focus);
			if (this.focus === "settings") {
				const selectedCategory = this.getCategories()[this.catIndex];
				if (selectedCategory?.id !== "autoModel") {
					const count = this.getCategories().length;
					this.catIndex = count === 0 ? 0 : Math.min(this.setIndex, count - 1);
				}
			}
			this.focus = PANE_FOCUS_ORDER[Math.max(0, index - 1)] ?? "categories";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.right)) {
			const index = PANE_FOCUS_ORDER.indexOf(this.focus);
			if (this.focus === "categories") {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : cat?.id === "autoModel" ? 0 : Math.min(this.catIndex, count - 1);
			}
			this.focus = PANE_FOCUS_ORDER[Math.min(PANE_FOCUS_ORDER.length - 1, index + 1)] ?? "values";
			this.requestRender();
			return;
		}
		if (key === "s" || key === "S") {
			this.done({ action: "save", config: cloneConfig(this.draft) });
			return;
		}
		if (key === "r" || key === "R") {
			this.draft = defaultConfig();
			this.focus = "categories";
			this.catIndex = 0;
			this.setIndex = 0;
			this.status = "Defaults restored locally. Press S to save or Esc to discard.";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.focus === "categories") {
				const count = this.getCategories().length;
				this.catIndex = count === 0 ? 0 : (this.catIndex - 1 + count) % count;
				const cat = this.getCategories()[this.catIndex];
				const settingsCount = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = settingsCount === 0 ? 0 : Math.min(this.catIndex, settingsCount - 1);
			} else {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : (this.setIndex - 1 + count) % count;
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			if (this.focus === "categories") {
				const count = this.getCategories().length;
				this.catIndex = count === 0 ? 0 : (this.catIndex + 1) % count;
				const cat = this.getCategories()[this.catIndex];
				const settingsCount = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = settingsCount === 0 ? 0 : Math.min(this.catIndex, settingsCount - 1);
			} else {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : (this.setIndex + 1) % count;
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (this.focus === "values") {
				this.activateCurrent();
				this.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.space)) return;
		if (this.focus === "categories" && (key === "k" || key === "K")) {
			this.moveCurrentSegment(-1);
			this.requestRender();
			return;
		}
		if (this.focus === "categories" && (key === "j" || key === "J")) {
			this.moveCurrentSegment(1);
			this.requestRender();
		}
	}

	private renderPreview(lines: string[], layout: PaneLayout): void {
		const preview = this.previewState
			? renderInputSurface(this.previewState, this.draft, layout.width, {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				})
			: renderInputSurfacePreview(this.draft, layout.width, {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				});
		for (const previewLine of preview) {
			lines.push(previewLine);
		}
	}

	private renderEditing(lines: string[], layout: PaneLayout, colors: PaneColors): void {
		if (!this.editing) return;
		const help = colors.dim("Enter save · Esc cancel · Ctrl+U clear");
		lines.push(paneLine(layout, [spreadAnsi(colors.accent(`Edit ${this.editing.label}`), help, layout.contentWidth)]));
		const value = this.editing.value || colors.dim(this.editing.emptyValue);
		lines.push(paneLine(layout, [colors.accent("> "), truncateToWidth(value, Math.max(0, layout.contentWidth - 2), "…")]));
		lines.push("");
	}

	private renderCategoryRow(cat: CategoryViewModel, colors: PaneColors): string {
		let labelTone = colors.muted;

		if (cat.selected) {
			labelTone = cat.hasFocus ? colors.accent : colors.muted;
		} else if (cat.enabled === false) {
			labelTone = colors.dim;
		}

		const cursor = cat.selected && cat.hasFocus ? colors.accent("› ") : "  ";
		return `${cursor}${labelTone(cat.label)}`;
	}

	private renderLeftPane(model: GlancePaneViewModel, colors: PaneColors): string[] {
		return model.categories.map((cat) => this.renderCategoryRow(cat, colors));
	}

	private renderSettingValue(row: SettingViewModel, colors: PaneColors): string {
		if (row.kind === "info") return colors.dim(row.value);
		if (row.kind === "input") {
			if (row.selected && row.valueHasFocus) return colors.accent(row.value);
			return !row.rawValue && row.emptyValue ? colors.dim(row.value) : colors.muted(row.value);
		}
		const valueTone = row.selected && row.valueHasFocus ? colors.accent : row.value === "on" ? colors.success : row.value === "off" ? colors.dim : colors.muted;
		return valueTone(row.value);
	}

	private renderSettingRow(row: SettingViewModel, layout: PaneLayout, colors: PaneColors): string {
		let labelTone = colors.muted;

		if (row.selected && row.labelHasFocus) {
			labelTone = colors.accent;
		} else if (row.kind === "info") {
			labelTone = colors.dim;
		}

		const label = truncateToWidth(row.label, layout.settingLabelWidth, "…");
		const paddedLabel = padRightAnsi(labelTone(label), layout.settingLabelWidth);
		const gap = row.selected && row.valueHasFocus ? focusGap(layout.columnGap, colors) : layout.columnGap;
		const valueStr = this.renderSettingValue(row, colors);
		const value = truncateToWidth(valueStr, layout.valueWidth, "…");
		return `${paddedLabel}${gap}${value}`;
	}

	private renderSettingsPane(model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): string[] {
		if (!model.selectedCategory) return [];

		if (model.settings.length === 0) {
			return [colors.dim("No settings available.")];
		}

		return model.settings.map((row) => this.renderSettingRow(row, layout, colors));
	}

	private renderAsidePane(model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): string[] {
		const hint = model.selectedHint ? truncateToWidth(model.selectedHint, layout.asideWidth, "…") : "";
		return [colors.muted(model.settingsTitle), hint ? colors.dim(`“${hint}”`) : ""];
	}

	private renderSettingsColumns(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		const categories = this.renderLeftPane(model, colors);
		const settings = this.renderSettingsPane(model, layout, colors);
		const aside = layout.showAside ? this.renderAsidePane(model, layout, colors) : [];

		const maxLines = Math.max(categories.length, settings.length, aside.length);
		for (let i = 0; i < maxLines; i++) {
			const category = padRightAnsi(categories[i] ?? "", layout.categoryWidth);
			const selectedSetting = model.settings[i];
			const categoryGap = selectedSetting?.selected && selectedSetting.labelHasFocus ? focusGap(layout.columnGap, colors) : layout.columnGap;
			const setting = padRightAnsi(settings[i] ?? "", layout.settingsWidth);
			const asideLine = aside[i] ?? "";
			const asidePart = layout.showAside ? [layout.asideGap, colors.dim(`${layout.asideSeparator} `), asideLine] : [];
			lines.push(paneLine(layout, [category, categoryGap, setting, ...asidePart]));
		}
	}

	private renderSettings(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		this.renderSettingsColumns(lines, model, layout, colors);
	}

	private renderFooter(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		const footerLeft = helpText(model.help, colors);
		const footerRight = model.dirty ? colors.warn("● Unsaved changes") : colors.success("✓ Saved");
		lines.push(paneLine(layout, [spreadAnsi(footerLeft, footerRight, layout.contentWidth)]));
	}

	render(width: number): string[] {
		const colors = makePaneColors(this.theme);
		const layout = makePaneLayout(width);
		const model = this.getViewModel();
		const lines: string[] = [];

		if (model.status) lines.push(paneLine(layout, [colors.dim(model.status)]));
		this.renderEditing(lines, layout, colors);

		this.renderPreview(lines, layout);
		lines.push("");

		this.renderSettings(lines, model, layout, colors);
		lines.push("");

		this.renderFooter(lines, model, layout, colors);
		return lines;
	}
}

interface GlancePaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component,
	): Promise<T>;
}

export async function showGlancePane(initial: GlanceConfig, ctx: { ui: GlancePaneUI }, previewState?: GlanceState): Promise<PaneResult> {
	return ctx.ui.custom<PaneResult>((tui, theme, _kb, done) => {
		return new GlanceConfigPane(initial, theme, done, () => tui.requestRender(), previewState);
	});
}
