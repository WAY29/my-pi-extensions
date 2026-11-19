import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatProgramStatus } from "@earendil-works/pi-tui";

import {
	NOTIFY_HOOK_LIFECYCLE_EVENT,
	type NotifyHookAdapter,
	type NotifyHookLifecycleDispatch,
	type NotifyHookLifecycleSignal,
} from "./types";

function herdrEnabled(): boolean {
	return process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_SOCKET_PATH) && Boolean(process.env.HERDR_PANE_ID);
}

function labelFor(signal: NotifyHookLifecycleSignal): string {
	const source = signal.details?.source;
	if (typeof source === "string" && source.trim()) return source;
	const kind = signal.details?.kind;
	if (typeof kind === "string" && kind.trim()) return kind;
	return "request_user_input";
}

export function createHerdrNotifyHookAdapter(pi: ExtensionAPI): NotifyHookAdapter | null {
	const tui = herdrEnabled();
	const core = process.env.HC_TERMINAL_ID && process.stdout.isTTY && process.env.PI_PROGRAM_STATUS !== "0";
	if (!tui && !core) return null;

	return {
		name: "herdr",
		async fire(signal, ctx): Promise<void> {
			if (signal.eventName === "request_user_input") {
				const label = labelFor(signal);
				if (tui) {
					pi.events.emit("herdr:blocked", { active: true, label });
				} else {
					// Pi reports built-in dialogs automatically. Custom dialogs need an explicit status.
					const kind = signal.details?.kind;
					process.stdout.write(formatProgramStatus({
						app: "pi",
						state: "blocked",
						kind: kind === "auth" || kind === "permission" ? kind : "question",
						message: label,
					}));
				}
				return;
			}

			if (signal.eventName === "Start" && signal.source === "attention_end") {
				if (tui) {
					pi.events.emit("herdr:blocked", { active: false });
				} else {
					const state = ctx?.isIdle?.() === false ? "working" : "idle";
					process.stdout.write(formatProgramStatus({
						app: "pi",
						state,
						message: state === "working" ? ctx?.sessionManager.getSessionName() : undefined,
					}));
				}
			}
		},
	};
}

export default function herdrNotifyHookAdapter(pi: ExtensionAPI): void {
	const adapter = createHerdrNotifyHookAdapter(pi);
	if (!adapter) return;
	pi.events.on(NOTIFY_HOOK_LIFECYCLE_EVENT, (dispatch: NotifyHookLifecycleDispatch) => {
		void adapter.fire(dispatch.signal, dispatch.ctx).catch(() => undefined);
	});
}
