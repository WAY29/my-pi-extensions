import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ensureGrepToolRegistered, registerGrepToolPlugin, releaseGrepToolOwner, type GrepToolDefinition } from "../grep-tool-coordinator";

interface GrepInput {
	pattern: string;
	path?: string;
	glob?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	context?: number;
	limit?: number;
}

type TextContentLike = { type: string; text?: string; [key: string]: unknown };
type ToolResultLike = { content?: TextContentLike[]; details?: unknown; [key: string]: unknown };

const grepSchema = Type.Object({
	pattern: Type.String({
		description:
			"Search pattern. Regular expression by default. For exact strings containing regex metacharacters like (, ), [, ], {, }, ., *, +, ?, |, ^, $, or \\, set literal=true.",
	}),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(
		Type.Boolean({
			description:
				"Treat pattern as an exact literal string instead of regex. Use true for code/text searches like AuthSpecialUser( unless you intentionally wrote a valid regex.",
		}),
	),
	context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

const DESCRIPTION = [
	"Search file contents for a pattern. Wraps the built-in grep/ripgrep tool with safer guidance for literal strings.",
	"Pattern is regex by default; pass literal=true for exact code/text searches, especially when the pattern contains regex metacharacters such as (, ), [, ], {, }, ., *, +, ?, |, ^, $, or \\.",
	"If ripgrep rejects a pattern as invalid regex, better-grep automatically retries once with literal=true and reports the fallback.",
].join(" ");

const PROMPT_GUIDELINES = [
	"Use grep with literal=true for exact code or text searches, especially when the pattern contains regex metacharacters such as (, ), [, ], {, }, ., *, +, ?, |, ^, $, or \\.",
	"Use grep without literal=true only when intentionally writing a valid ripgrep/Rust regex; escape metacharacters like \\( when they should match literally.",
	"If grep reports that better-grep retried with literal=true, treat the result as an exact-string search and use literal=true in future similar calls.",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function isRipgrepRegexParseError(error: unknown): boolean {
	return errorMessage(error).toLowerCase().includes("regex parse error:");
}

export function shouldRetryAsLiteral(params: GrepInput, error: unknown): boolean {
	return params.literal !== true && isRipgrepRegexParseError(error);
}

export function appendLiteralRetryNotice(result: ToolResultLike, pattern: string, error: unknown): ToolResultLike {
	const notice = [
		"[better-grep: ripgrep rejected the pattern as invalid regex, so the search was retried with literal=true.",
		"For intended regex searches, pass a valid regex such as AuthSpecialUser\\( instead.]",
	].join(" ");
	const content = Array.isArray(result.content) ? [...result.content] : [];
	const firstTextIndex = content.findIndex((item) => item?.type === "text" && typeof item.text === "string");

	if (firstTextIndex === -1) {
		content.push({ type: "text", text: notice });
	} else {
		const current = content[firstTextIndex]!;
		content[firstTextIndex] = {
			...current,
			text: `${current.text}\n\n${notice}`,
		};
	}

	return {
		...result,
		content,
		details: {
			...(isPlainObject(result.details) ? result.details : {}),
			betterGrep: {
				literalRetry: true,
				originalPattern: pattern,
				originalError: errorMessage(error),
			},
		},
	};
}

export function createBetterGrepToolDefinition(baseDefinition: GrepToolDefinition): GrepToolDefinition {
	return {
		...baseDefinition,
		label: "grep",
		description: DESCRIPTION,
		promptSnippet: "Search file contents; use literal=true for exact strings with regex punctuation",
		promptGuidelines: [...(baseDefinition.promptGuidelines ?? []), ...PROMPT_GUIDELINES],
		parameters: grepSchema,

		async execute(toolCallId, params: GrepInput, signal, onUpdate, ctx) {
			try {
				return await baseDefinition.execute(toolCallId, params, signal, onUpdate, ctx);
			} catch (error) {
				if (!shouldRetryAsLiteral(params, error)) throw error;
				const retryResult = await baseDefinition.execute(toolCallId, { ...params, literal: true }, signal, onUpdate, ctx);
				return appendLiteralRetryNotice(retryResult as ToolResultLike, params.pattern, error);
			}
		},
	};
}

export default function betterGrep(pi: ExtensionAPI) {
	registerGrepToolPlugin(pi, {
		id: "better-grep",
		priority: -10,
		wrapDefinition: createBetterGrepToolDefinition,
	});

	pi.on("session_start", (_event, ctx) => {
		ensureGrepToolRegistered(pi, ctx.cwd);
	});

	pi.on("session_shutdown", () => {
		releaseGrepToolOwner(pi);
	});
}
