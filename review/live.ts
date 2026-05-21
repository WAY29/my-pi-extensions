import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ReviewEventFormatter, ReviewLiveEntry, ReviewLiveState } from "./types.js";
import { findLastAssistantText } from "./format.js";

function shorten(text: string, max = 140): string {
	const single = text.replace(/\s+/g, " ").trim();
	return single.length > max ? `${single.slice(0, max - 3)}...` : single;
}

function stringifyArgs(args: unknown): string {
	try {
		return JSON.stringify(args);
	} catch {
		return "{}";
	}
}

function describeToolCall(toolName: string, args: any): string {
	switch (toolName) {
		case "bash":
			return `$ ${shorten(String(args?.command ?? ""), 180)}`;
		case "read": {
			const path = String(args?.path ?? "");
			const offset = typeof args?.offset === "number" ? args.offset : 1;
			const limit = typeof args?.limit === "number" ? args.limit : undefined;
			return limit ? `read ${path}:${offset}-${offset + limit - 1}` : `read ${path}`;
		}
		case "grep":
			return `grep /${String(args?.pattern ?? "")}/ in ${String(args?.path ?? ".")}`;
		case "find":
			return `find ${String(args?.pattern ?? "*")} in ${String(args?.path ?? ".")}`;
		case "ls":
			return `ls ${String(args?.path ?? ".")}`;
		default:
			return `${toolName} ${shorten(stringifyArgs(args), 120)}`;
	}
}

function summarizePartialResult(partialResult: any): string | null {
	if (!partialResult) return null;
	if (typeof partialResult === "string") return shorten(partialResult);
	if (Array.isArray(partialResult?.content)) {
		const texts = partialResult.content
			.filter((item: any) => item?.type === "text" && typeof item.text === "string")
			.map((item: any) => item.text);
		if (texts.length > 0) return shorten(texts.join("\n"), 220);
	}
	return null;
}

function summarizeEndResult(result: any): string | null {
	if (!result) return null;
	if (Array.isArray(result?.content)) {
		const texts = result.content
			.filter((item: any) => item?.type === "text" && typeof item.text === "string")
			.map((item: any) => item.text);
		if (texts.length > 0) return shorten(texts.join("\n"), 220);
	}
	return null;
}

export function createReviewEventFormatter(): ReviewEventFormatter {
	return {
		format(event: AgentSessionEvent): ReviewLiveEntry | null {
			switch (event.type) {
				case "tool_execution_start":
					return {
						kind: "tool",
						text: describeToolCall(event.toolName, event.args),
						toolCallId: event.toolCallId,
					};
				case "tool_execution_update": {
					const text = summarizePartialResult(event.partialResult);
					return text ? { kind: "toolResult", text, toolCallId: event.toolCallId } : null;
				}
				case "tool_execution_end": {
					const text = summarizeEndResult(event.result);
					return text
						? { kind: "toolResult", text, toolCallId: event.toolCallId, isError: event.isError }
						: { kind: event.isError ? "error" : "status", text: `${event.toolName} ${event.isError ? "failed" : "done"}`, toolCallId: event.toolCallId, isError: event.isError };
				}
				case "message_end": {
					const message = event.message as { role?: string; content?: unknown };
					if (message.role !== "assistant") return null;
					const text = findLastAssistantText([message]);
					return text ? { kind: "assistant", text } : null;
				}
				case "agent_end":
					return { kind: "status", text: event.willRetry ? "Review turn ended; retry queued" : "Review turn ended" };
				case "auto_retry_start":
					return { kind: "status", text: `Retrying… ${shorten(event.errorMessage, 100)}` };
				default:
					return null;
			}
		},
	};
}

export function createReviewLiveState(): ReviewLiveState {
	return {
		entries: [],
		lastToolById: new Map(),
		lastAssistantText: "",
	};
}

export function applyReviewLiveEvent(state: ReviewLiveState, formatter: ReviewEventFormatter, event: AgentSessionEvent): ReviewLiveEntry | null {
	const entry = formatter.format(event);
	if (!entry) return null;
	state.entries.push(entry);
	if (state.entries.length > 400) state.entries.splice(0, state.entries.length - 400);
	if (entry.toolCallId) state.lastToolById.set(entry.toolCallId, entry);
	if (entry.kind === "assistant") state.lastAssistantText = entry.text;
	return entry;
}
