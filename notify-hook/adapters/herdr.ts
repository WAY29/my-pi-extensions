import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

/**
 * Bridge notify-hook attention waits → herdr:blocked.
 * working/idle stay owned by herdr-agent-state.ts.
 */
export function createHerdrNotifyHookAdapter(pi: ExtensionAPI): NotifyHookAdapter | null {
	if (!herdrEnabled()) return null;

	return {
		name: "herdr",
		async fire(signal: NotifyHookLifecycleSignal): Promise<void> {
			if (signal.eventName === "request_user_input") {
				pi.events.emit("herdr:blocked", {
					active: true,
					label: labelFor(signal),
				});
				return;
			}

			if (signal.eventName === "Start" && signal.source === "attention_end") {
				pi.events.emit("herdr:blocked", { active: false });
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
