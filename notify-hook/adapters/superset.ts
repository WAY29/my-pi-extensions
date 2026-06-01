import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type NotifyHookLifecycleEvent = "UserPromptSubmit" | "Start" | "Stop" | "request_user_input";

export type NotifyHookContext = Pick<ExtensionContext, "sessionManager">;

export interface NotifyHookAdapter {
	name: string;
	fire(eventName: NotifyHookLifecycleEvent, ctx?: NotifyHookContext): Promise<void>;
}

function isSupersetTerminal(): boolean {
	return Boolean(
		process.env.SUPERSET_TERMINAL_ID ||
			process.env.SUPERSET_PANE_ID ||
			process.env.SUPERSET_TAB_ID,
	);
}

function getNotifyScriptPath(): string {
	const supersetHome = process.env.SUPERSET_HOME_DIR || join(homedir(), ".superset");
	return join(supersetHome, "hooks", "notify.sh");
}

function getSessionId(ctx: NotifyHookContext): string | undefined {
	return ctx.sessionManager.getSessionFile() ?? undefined;
}

export function createSupersetNotifyHookAdapter(): NotifyHookAdapter | null {
	if (!isSupersetTerminal()) return null;

	const notifyScript = getNotifyScriptPath();
	if (!existsSync(notifyScript)) return null;

	return {
		name: "superset",
		fire(eventName: NotifyHookLifecycleEvent, ctx?: NotifyHookContext): Promise<void> {
			const payload: Record<string, string> = {
				hook_event_name: eventName,
			};

			const sessionId = ctx ? getSessionId(ctx) : undefined;
			if (sessionId) {
				payload.session_id = sessionId;
			}

			return new Promise((resolve) => {
				try {
					const child = spawn(notifyScript, [JSON.stringify(payload)], {
						stdio: "ignore",
						env: { ...process.env, SUPERSET_AGENT_ID: "pi" },
					});
					child.once("error", () => {
						resolve();
					});
					child.once("close", () => {
						resolve();
					});
				} catch {
					resolve();
				}
			});
		},
	};
}
