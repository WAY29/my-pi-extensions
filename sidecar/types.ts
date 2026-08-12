export type SidecarMode = "herdr" | "inner";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SidecarAgentConfig {
	/** herdr agent kind; v1 focuses on pi */
	kind?: string;
	/** live agent name; must match [a-z][a-z0-9_-]{0,31} */
	name?: string;
	/** provider/model-id; empty = inherit main session */
	model?: string;
	/** thinking level; empty = inherit main session */
	effort?: ThinkingLevel;
	/**
	 * Allowlisted packages/paths loaded into the child pi.
	 * Default child is --no-extensions; each entry becomes -e <resolved>.
	 * Package names (e.g. "ponytail") resolve via pi installed packages.
	 */
	extensions?: string[];
	/**
	 * Allowlisted skills (name or path). Default child is --no-skills.
	 */
	skills?: string[];
}

export interface SidecarTabConfig {
	label?: string;
	focus?: boolean;
}

export interface SidecarDefinition {
	name: string;
	description?: string;
	/** display/runtime mode: herdr tab or in-process inner session */
	mode?: SidecarMode;
	blocking: boolean;
	prompt: string;
	continue_prompt?: string;
	stop_keyword: string;
	/** full stop-instruction sentence; overrides default template */
	stop_instruction?: string;
	/** default true */
	close_on_stop?: boolean;
	agent?: SidecarAgentConfig;
	tab?: SidecarTabConfig;
	/** discovery metadata */
	source?: "user" | "project";
	path?: string;
}

export interface SidecarGlobalConfig {
	mode: SidecarMode;
	read_lines: number;
	prompt_timeout_ms: number;
}

export type SidecarInstanceStatus =
	| "starting"
	| "running"
	| "waiting"
	| "stopped"
	| "error";

export interface SidecarInnerHandle {
	session: import("@earendil-works/pi-coding-agent").AgentSession;
	unsubscribe: () => void;
}

export interface SidecarInstance {
	name: string;
	def: SidecarDefinition;
	/** resolved runtime mode for this instance */
	mode: SidecarMode;
	agentName: string;
	tabId: string;
	paneId: string;
	/** child pi session jsonl path (--session) */
	sessionFile: string;
	status: SidecarInstanceStatus;
	closeOnStop: boolean;
	lastOutput?: string;
	lastError?: string;
	stoppedByKeyword?: boolean;
	abort: AbortController;
	createdAt: number;
	/** chrome lines (start/error) shown dim above transcript */
	statusLines: string[];
	/** session messages rendered like stock main agent */
	messages: any[];
	/** in-process nested session (mode=inner) */
	inner?: SidecarInnerHandle;
}
