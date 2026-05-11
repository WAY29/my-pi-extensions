import type { ImageContent } from "@earendil-works/pi-ai";
import {
	createReadToolDefinition,
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const STATE_KEY = Symbol.for("pi.pretty-image-paste.state");
const WRAPPED_EDITOR_KEY = Symbol.for("pi.pretty-image-paste.wrapped-editor");
const IMAGE_LABEL_PATTERN = /\[Image #(\d+)\]/g;
const PI_CLIPBOARD_IMAGE_BASENAME = /^pi-clipboard-[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i;

type ImageEntry = {
	number: number;
	label: string;
	filePath: string;
	createdAt: number;
};

type PrettyImagePasteState = {
	nextImageNumber: number;
	entriesByNumber: Map<number, ImageEntry>;
	entriesByPath: Map<string, ImageEntry>;
	attachedPaths: Set<string>;
};

type WrappedEditor = EditorComponent & {
	[WRAPPED_EDITOR_KEY]?: true;
};

type ImageLabelColor = (text: string) => string;

function createState(): PrettyImagePasteState {
	return {
		nextImageNumber: 1,
		entriesByNumber: new Map(),
		entriesByPath: new Map(),
		attachedPaths: new Set(),
	};
}

function getState(): PrettyImagePasteState {
	const globalState = globalThis as Record<symbol, PrettyImagePasteState | undefined>;
	globalState[STATE_KEY] ??= createState();
	return globalState[STATE_KEY]!;
}

function resetState(state: PrettyImagePasteState) {
	state.nextImageNumber = 1;
	state.entriesByNumber.clear();
	state.entriesByPath.clear();
	state.attachedPaths.clear();
}

function getPortableBasename(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	const backslash = filePath.lastIndexOf("\\");
	return filePath.slice(Math.max(slash, backslash) + 1);
}

function normalizeMaybeFilePath(text: string): string | undefined {
	if (text.length === 0 || text.includes("\n")) return undefined;
	if (text.trim() !== text) return undefined;

	const basename = getPortableBasename(text);
	if (!PI_CLIPBOARD_IMAGE_BASENAME.test(basename)) return undefined;

	const resolved = path.resolve(text);
	return existsSync(resolved) ? resolved : undefined;
}

function registerPastedImagePath(state: PrettyImagePasteState, rawText: string): ImageEntry | undefined {
	const filePath = normalizeMaybeFilePath(rawText);
	if (!filePath) return undefined;

	const existing = state.entriesByPath.get(filePath);
	if (existing) return existing;

	const number = state.nextImageNumber++;
	const entry = {
		number,
		label: `[Image #${number}]`,
		filePath,
		createdAt: Date.now(),
	};

	state.entriesByPath.set(filePath, entry);
	state.entriesByNumber.set(number, entry);
	return entry;
}

function replacePastedImagePath(state: PrettyImagePasteState, text: string): string | undefined {
	return registerPastedImagePath(state, text)?.label;
}

function extractReferencedImageNumbers(text: string): number[] {
	const numbers: number[] = [];
	const seen = new Set<number>();

	for (const match of text.matchAll(IMAGE_LABEL_PATTERN)) {
		const rawNumber = match[1];
		if (!rawNumber) continue;

		const number = Number.parseInt(rawNumber, 10);
		if (!Number.isFinite(number) || seen.has(number)) continue;

		seen.add(number);
		numbers.push(number);
	}

	return numbers;
}

function cleanupAttachedImages(state: PrettyImagePasteState) {
	for (const filePath of state.attachedPaths) {
		try {
			if (existsSync(filePath)) unlinkSync(filePath);
		} catch {
			// Best-effort cleanup only.
		}

		const entry = state.entriesByPath.get(filePath);
		if (entry) state.entriesByNumber.delete(entry.number);
		state.entriesByPath.delete(filePath);
	}

	state.attachedPaths.clear();
}

async function readImageAttachment(entry: ImageEntry, ctx: ExtensionContext): Promise<ImageContent | undefined> {
	try {
		const readTool = createReadToolDefinition(ctx.cwd);
		const result = await readTool.execute(
			`pretty-image-paste-${entry.number}`,
			{ path: entry.filePath },
			ctx.signal,
			undefined,
			ctx,
		);

		const image = result.content.find((content): content is ImageContent => content.type === "image");
		if (!image && ctx.hasUI) {
			const note = result.content.find((content) => content.type === "text")?.text.split("\n")[0];
			ctx.ui.notify(`Could not attach ${entry.label}${note ? `: ${note}` : ""}`, "warning");
		}

		return image;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(`Could not attach ${entry.label}: ${message}`, "warning");
		}
		return undefined;
	}
}

function insertOrAppend(editor: EditorComponent, text: string, originalInsert?: (text: string) => void) {
	if (originalInsert) {
		originalInsert(text);
		return;
	}

	// Fallback for custom editors that do not expose cursor insertion.
	editor.setText(`${editor.getText()}${text}`);
}

function colorImageLabels(text: string, colorImageLabel: ImageLabelColor): string {
	return text.replace(IMAGE_LABEL_PATTERN, (label) => colorImageLabel(label));
}

function wrapEditor(
	editor: EditorComponent,
	state: PrettyImagePasteState,
	colorImageLabel: ImageLabelColor,
): EditorComponent {
	const wrapped = editor as WrappedEditor;
	if (wrapped[WRAPPED_EDITOR_KEY]) return editor;

	const originalInsert = editor.insertTextAtCursor?.bind(editor);
	editor.insertTextAtCursor = (text: string) => {
		insertOrAppend(editor, replacePastedImagePath(state, text) ?? text, originalInsert);
	};

	const originalRender = editor.render.bind(editor);
	editor.render = (width: number) => originalRender(width).map((line) => colorImageLabels(line, colorImageLabel));

	wrapped[WRAPPED_EDITOR_KEY] = true;
	return editor;
}

class PrettyImagePasteEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly state: PrettyImagePasteState,
		private readonly colorImageLabel: ImageLabelColor,
	) {
		super(tui, theme, keybindings);
	}

	override insertTextAtCursor(text: string): void {
		super.insertTextAtCursor(replacePastedImagePath(this.state, text) ?? text);
	}

	override render(width: number): string[] {
		return super.render(width).map((line) => colorImageLabels(line, this.colorImageLabel));
	}
}

export default function (pi: ExtensionAPI) {
	const state = getState();

	pi.on("session_shutdown", () => {
		cleanupAttachedImages(state);
	});

	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "reload") {
			resetState(state);
		}

		if (!ctx.hasUI) return;

		const colorImageLabel: ImageLabelColor = (label) => ctx.ui.theme.fg("mdCode", label);
		const previousFactory = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			if (previousFactory) {
				return wrapEditor(previousFactory(tui, theme, keybindings), state, colorImageLabel);
			}

			return new PrettyImagePasteEditor(tui, theme, keybindings, state, colorImageLabel);
		});
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };

		const referencedNumbers = extractReferencedImageNumbers(event.text);
		if (referencedNumbers.length === 0) return { action: "continue" };

		const attachments: ImageContent[] = [];
		const missingLabels: string[] = [];

		for (const number of referencedNumbers) {
			const entry = state.entriesByNumber.get(number);
			if (!entry) {
				missingLabels.push(`[Image #${number}]`);
				continue;
			}

			const attachment = await readImageAttachment(entry, ctx);
			if (attachment) {
				attachments.push(attachment);
				state.attachedPaths.add(entry.filePath);
			}
		}

		if (missingLabels.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`No pasted image mapping for ${missingLabels.join(", ")}`, "warning");
		}

		if (attachments.length === 0) return { action: "continue" };

		return {
			action: "transform",
			text: event.text,
			images: [...(event.images ?? []), ...attachments],
		};
	});
}
