import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STARTUP_INFO_ADD_EVENT } from "./_shared/startup-info-shared.js";

type StartupInfoEvent = {
	message?: unknown;
};

export default function startupInfo(pi: ExtensionAPI): void {
	const messages: string[] = [];
	const seen = new Set<string>();

	function reset(): void {
		messages.length = 0;
		seen.clear();
	}

	pi.events.on(STARTUP_INFO_ADD_EVENT, (data: unknown) => {
		const event = data && typeof data === "object" ? (data as StartupInfoEvent) : undefined;
		const message = typeof event?.message === "string" ? event.message.trim() : "";
		if (!message || seen.has(message)) return;
		seen.add(message);
		messages.push(message);
	});

	pi.on("resources_discover", async (event, ctx) => {
		if (event.reason !== "startup" && event.reason !== "reload") return;
		if (!ctx.hasUI || messages.length === 0) {
			reset();
			return;
		}
		ctx.ui.notify(messages.join("\n"), "info");
		reset();
	});

	pi.on("session_shutdown", async () => {
		reset();
	});
}
