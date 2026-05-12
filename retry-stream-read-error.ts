import { AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ORIGINAL_SYMBOL = Symbol.for("pi.stream-read-error-retry.original");

type RetryableFn = (this: unknown, message: unknown) => boolean;

type PatchedAgentSessionPrototype = {
	_isRetryableError?: RetryableFn;
	[key: symbol]: unknown;
};

function isStreamReadError(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;

	const candidate = message as { stopReason?: unknown; errorMessage?: unknown };
	return (
		candidate.stopReason === "error" &&
		typeof candidate.errorMessage === "string" &&
		candidate.errorMessage.includes("stream_read_error")
	);
}

function installPatch(): boolean {
	const prototype = AgentSession.prototype as PatchedAgentSessionPrototype;
	const current = prototype._isRetryableError;

	if (typeof current !== "function") return false;
	if (typeof prototype[ORIGINAL_SYMBOL] === "function") return true;

	const original = current;
	Object.defineProperty(prototype, ORIGINAL_SYMBOL, {
		value: original,
		configurable: false,
		enumerable: false,
		writable: false,
	});

	prototype._isRetryableError = function streamReadErrorRetryPatch(this: unknown, message: unknown) {
		if (original.call(this, message)) return true;
		return isStreamReadError(message);
	};

	return true;
}

export default function retryStreamReadErrorExtension(pi: ExtensionAPI) {
	const supported = installPatch();

	if (!supported) {
		pi.on("session_start", async (_event, ctx) => {
			ctx.ui.notify(
				"retry-stream-read-error：不支持该 pi 版本，未找到 AgentSession.prototype._isRetryableError。",
				"warning",
			);
		});
	}
}
