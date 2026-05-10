import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

const PATCHED = Symbol.for("pi.hide-code-fence-markers.patched");
const FENCE_LINE = "\uE000pi-hide-code-fence-marker\uE000";

type MarkdownInternals = Markdown & {
	theme: {
		codeBlockBorder: (text: string) => string;
	};
};

type RenderToken = (this: MarkdownInternals, token: unknown, width: number, nextTokenType?: string, styleContext?: unknown) => string[];
type RenderListItem = (this: MarkdownInternals, tokens: unknown[], parentDepth: number, styleContext?: unknown) => string[];

function withoutFenceLines(instance: MarkdownInternals, render: () => string[]): string[] {
	const originalCodeBlockBorder = instance.theme.codeBlockBorder;

	instance.theme.codeBlockBorder = (text: string) => `${FENCE_LINE}${originalCodeBlockBorder(text)}${FENCE_LINE}`;

	try {
		return render().filter((line) => !line.includes(FENCE_LINE));
	} finally {
		instance.theme.codeBlockBorder = originalCodeBlockBorder;
	}
}

export function patchMarkdownCodeFenceMarkers(): boolean {
	const proto = Markdown.prototype as unknown as {
		renderToken?: RenderToken;
		renderListItem?: RenderListItem;
	} & Record<PropertyKey, unknown>;

	if (proto[PATCHED] === true) return true;

	const originalRenderToken = proto.renderToken;
	const originalRenderListItem = proto.renderListItem;

	if (typeof originalRenderToken !== "function" || typeof originalRenderListItem !== "function") {
		return false;
	}

	proto.renderToken = function (token: unknown, width: number, nextTokenType?: string, styleContext?: unknown): string[] {
		if ((token as { type?: unknown } | undefined)?.type !== "code") {
			return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
		}

		return withoutFenceLines(this, () => originalRenderToken.call(this, token, width, nextTokenType, styleContext));
	};

	proto.renderListItem = function (tokens: unknown[], parentDepth: number, styleContext?: unknown): string[] {
		return withoutFenceLines(this, () => originalRenderListItem.call(this, tokens, parentDepth, styleContext));
	};

	proto[PATCHED] = true;
	return true;
}

export default function hideCodeFenceMarkers(pi: ExtensionAPI) {
	const patched = patchMarkdownCodeFenceMarkers();

	if (!patched) {
		pi.on("session_start", (_event, ctx) => {
			ctx.ui.notify("hide-code-fence-markers: unsupported pi-tui Markdown internals", "warning");
		});
	}
}
