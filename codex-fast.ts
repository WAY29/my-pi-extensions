import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function fastPayload(payload: unknown, enabled: boolean | "fast" | "ultrafast"): unknown {
	if (!enabled || !payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	return { ...payload, service_tier: enabled === true ? "fast" : enabled };
}

export default function codexFast(pi: ExtensionAPI): void {
	const enabledModels = new Map<string, "fast" | "ultrafast">();
	const key = (model: { provider: string; id: string; api: string } | undefined) =>
		model?.provider === "internal" && model.api === "openai-responses" ? `${model.provider}/${model.id}` : undefined;
	const publish = (modelKey: string) => pi.events.emit("internal-fast:state", {
		modelKey, enabled: enabledModels.has(modelKey), tier: enabledModels.get(modelKey),
	});

	pi.events.on("internal-fast:request-state", (data: unknown) => {
		const modelKey = (data as { modelKey?: string } | null)?.modelKey;
		if (modelKey) publish(modelKey);
	});

	pi.on("session_start", () => {
		const previouslyEnabled = [...enabledModels.keys()];
		enabledModels.clear();
		for (const modelKey of previouslyEnabled) publish(modelKey);
	});
	pi.on("before_provider_request", (event, ctx) => {
		const modelKey = key(ctx.model);
		return fastPayload(event.payload, (modelKey && enabledModels.get(modelKey)) || false);
	});

	for (const tier of ["fast", "ultrafast"] as const) pi.registerCommand(tier, {
		description: `Toggle ${tier} requests for the current internal GPT model: /${tier} [on|off|status]`,
		handler: (args, ctx) => {
		const modelKey = key(ctx.model);
		if (!modelKey || !ctx.model?.id.startsWith("gpt-")) {
			ctx.ui.notify(`${tier} is only available for internal GPT models using openai-responses.`, "warning");
			return;
		}
		const mode = args.trim();
		if (mode && !["on", "off", "status"].includes(mode)) {
			ctx.ui.notify(`Usage: /${tier} [on|off|status]`, "warning");
			return;
		}
		if (mode !== "status") {
			const enabled = mode === "on" || (!mode && enabledModels.get(modelKey) !== tier);
			if (enabled) enabledModels.set(modelKey, tier);
			else if (enabledModels.get(modelKey) === tier) enabledModels.delete(modelKey);
			publish(modelKey);
		}
		ctx.ui.notify(`${modelKey}: ${tier} ${enabledModels.get(modelKey) === tier ? "on" : "off"}`, "info");
	},
	});
}
