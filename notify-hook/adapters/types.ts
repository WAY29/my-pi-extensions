import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type NotifyHookLifecycleEvent =
	| "UserPromptSubmit"
	| "Start"
	| "Stop"
	| "request_user_input"
	| "tool_execution_start"
	| "tool_call"
	| "tool_execution_end"
	| "message_end";

export type NotifyHookLifecycleSource =
	| "before_agent_start"
	| "agent_start"
	| "agent_end"
	| "agent_settled"
	| "session_shutdown"
	| "attention_start"
	| "attention_end"
	| "tool_execution_start"
	| "tool_call"
	| "tool_execution_end"
	| "message_end";

export interface NotifyHookLifecycleSignal {
	eventName: NotifyHookLifecycleEvent;
	source: NotifyHookLifecycleSource;
	/** Optional event payload (e.g. prompt text, tool fields, assistant text). */
	details?: Record<string, unknown>;
}

export type NotifyHookContext = Pick<ExtensionContext, "sessionManager">;

export interface NotifyHookAdapter {
	name: string;
	fire(signal: NotifyHookLifecycleSignal, ctx?: NotifyHookContext): Promise<void>;
}
