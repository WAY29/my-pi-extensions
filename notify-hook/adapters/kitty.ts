import { basename, extname } from "node:path";

import type { NotifyHookAdapter, NotifyHookContext, NotifyHookLifecycleSignal } from "./types";

function isKittyTerminal(): boolean {
	return Boolean(process.env.KITTY_WINDOW_ID);
}

function wrapForTmux(sequence: string): string {
	if (!process.env.TMUX) return sequence;
	const escaped = sequence.split("\x1b").join("\x1b\x1b");
	return `\x1bPtmux;${escaped}\x1b\\`;
}

function writeSequence(sequence: string): void {
	process.stdout.write(wrapForTmux(sequence));
}

function encodePayload(text: string): { metadata: string; payload: string } {
	if (/^[\x20-\x7e]*$/.test(text)) {
		return { metadata: "", payload: text };
	}
	return {
		metadata: ":e=1",
		payload: Buffer.from(text, "utf8").toString("base64"),
	};
}

function getSessionStem(ctx?: NotifyHookContext): string | undefined {
	const sessionFile = ctx?.sessionManager.getSessionFile();
	if (!sessionFile) return undefined;
	const base = basename(sessionFile);
	const ext = extname(base);
	return ext ? base.slice(0, -ext.length) : base;
}

function getSessionTitle(ctx?: NotifyHookContext): string {
	const sessionName = ctx?.sessionManager.getSessionName()?.trim();
	if (sessionName) return `Pi · ${sessionName}`;
	const sessionStem = getSessionStem(ctx);
	return sessionStem ? `Pi · ${sessionStem}` : "Pi";
}

function getNotificationId(ctx?: NotifyHookContext): string | undefined {
	const sessionFile = ctx?.sessionManager.getSessionFile();
	if (!sessionFile) return undefined;
	return Buffer.from(sessionFile).toString("base64url");
}

function notifyTitleAndBody(id: string, title: string, body: string): void {
	const encodedTitle = encodePayload(title);
	const encodedBody = encodePayload(body);
	const titleMetadata = `i=${id}:d=0:o=unfocused${encodedTitle.metadata}`;
	const bodyMetadata = `i=${id}:p=body${encodedBody.metadata}`;
	writeSequence(`\x1b]99;${titleMetadata};${encodedTitle.payload}\x1b\\`);
	writeSequence(`\x1b]99;${bodyMetadata};${encodedBody.payload}\x1b\\`);
}

function closeNotification(id: string): void {
	writeSequence(`\x1b]99;i=${id}:p=close;\x1b\\`);
}

function bodyFor(signal: NotifyHookLifecycleSignal): string | undefined {
	if (signal.eventName === "request_user_input") return "Ready for Input";
	if (signal.eventName !== "Stop") return undefined;
	if (signal.source !== "agent_end") return undefined;
	return "Finish";
}

export function createKittyNotifyHookAdapter(): NotifyHookAdapter | null {
	if (!isKittyTerminal()) return null;

	return {
		name: "kitty",
		async fire(signal: NotifyHookLifecycleSignal, ctx?: NotifyHookContext): Promise<void> {
			const id = getNotificationId(ctx);
			if (!id) return;

			if (signal.eventName === "UserPromptSubmit" || signal.eventName === "Start" || signal.source === "session_shutdown") {
				closeNotification(id);
				return;
			}

			const body = bodyFor(signal);
			if (!body) return;

			notifyTitleAndBody(id, getSessionTitle(ctx), body);
		},
	};
}
