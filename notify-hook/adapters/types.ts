import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type NotifyHookLifecycleEvent = "UserPromptSubmit" | "Start" | "Stop" | "request_user_input";

export type NotifyHookLifecycleSource =
	| "before_agent_start"
	| "session_before_compact"
	| "session_compact"
	| "agent_end"
	| "session_shutdown"
	| "attention_start"
	| "attention_end";

export interface NotifyHookLifecycleSignal {
	eventName: NotifyHookLifecycleEvent;
	source: NotifyHookLifecycleSource;
}

export type NotifyHookContext = Pick<ExtensionContext, "sessionManager">;

export interface NotifyHookAdapter {
	name: string;
	fire(signal: NotifyHookLifecycleSignal, ctx?: NotifyHookContext): Promise<void>;
}
