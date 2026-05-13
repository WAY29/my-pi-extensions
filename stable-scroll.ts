// Local hotfix for pi-tui clearing terminal scrollback during automatic full redraws.
// Long term, pi core should avoid CSI 3J for normal redraws and handle offscreen changes without clearing scrollback.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProcessTerminal } from "@earendil-works/pi-tui";

const PATCH_KEY = Symbol.for("pi.stable-scroll.patch");
const CLEAR_SCROLLBACK = "\x1b[3J";
const PATCH_VERSION = 2;
const ALLOW_CLEAR_SCROLLBACK_REASONS = new Set(["new", "resume", "fork"]);
const ALLOW_CLEAR_SCROLLBACK_MS = 15_000;

type ProcessTerminalWrite = typeof ProcessTerminal.prototype.write;

type StableScrollPatchState = {
	originalWrite: ProcessTerminalWrite;
	filteredCount: number;
	allowedCount: number;
	allowedUntil: number;
	patchVersion: number;
};

function getPatchState(): StableScrollPatchState | undefined {
	return (globalThis as Record<symbol, StableScrollPatchState | undefined>)[PATCH_KEY];
}

function setPatchState(state: StableScrollPatchState): void {
	(globalThis as Record<symbol, StableScrollPatchState | undefined>)[PATCH_KEY] = state;
}

function debugLog(message: string): void {
	if (process.env.PI_STABLE_SCROLL_DEBUG !== "1") return;

	try {
		const logPath = process.env.PI_STABLE_SCROLL_LOG || join(homedir(), ".pi", "agent", "pi-stable-scroll.log");
		mkdirSync(dirname(logPath), { recursive: true });
		appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
	} catch {
		// Do not let logging failures break terminal rendering.
	}
}

function installStableScrollPatch(): void {
	const existing = getPatchState();
	if (existing?.patchVersion === PATCH_VERSION) return;

	const originalWrite = existing?.originalWrite ?? ProcessTerminal.prototype.write;
	if (existing) {
		ProcessTerminal.prototype.write = originalWrite;
	}

	const state: StableScrollPatchState = {
		originalWrite,
		filteredCount: existing?.filteredCount ?? 0,
		allowedCount: existing?.allowedCount ?? 0,
		allowedUntil: existing?.allowedUntil ?? 0,
		patchVersion: PATCH_VERSION,
	};

	ProcessTerminal.prototype.write = function stableScrollWrite(this: ProcessTerminal, data: string): void {
		if (typeof data === "string" && data.includes(CLEAR_SCROLLBACK)) {
			let filtered = 0;
			let allowed = 0;
			data = data.replaceAll(CLEAR_SCROLLBACK, () => {
				const now = Date.now();
				if (state.allowedCount > 0 && now <= state.allowedUntil) {
					state.allowedCount--;
					if (state.allowedCount === 0) state.allowedUntil = 0;
					allowed++;
					return CLEAR_SCROLLBACK;
				}

				if (state.allowedCount > 0 && now > state.allowedUntil) {
					debugLog(`expired ${state.allowedCount} CSI 3J clear-scrollback allowance(s)`);
					state.allowedCount = 0;
					state.allowedUntil = 0;
				}

				filtered++;
				return "";
			});

			if (filtered > 0) {
				state.filteredCount += filtered;
				debugLog(`filtered ${filtered} CSI 3J clear-scrollback sequence(s); total=${state.filteredCount}`);
			}
			if (allowed > 0) {
				debugLog(`allowed ${allowed} CSI 3J clear-scrollback sequence(s); remainingAllowances=${state.allowedCount}`);
			}
		}

		return originalWrite.call(this, data);
	};

	setPatchState(state);
	debugLog(existing ? "stable-scroll patch upgraded" : "stable-scroll patch installed");
}

function allowNextClearScrollback(reason: string): void {
	const state = getPatchState();
	if (!state) return;

	state.allowedCount++;
	state.allowedUntil = Date.now() + ALLOW_CLEAR_SCROLLBACK_MS;
	debugLog(
		`allowing next CSI 3J clear-scrollback sequence for session ${reason}; allowances=${state.allowedCount}; expiresInMs=${ALLOW_CLEAR_SCROLLBACK_MS}`,
	);
}

installStableScrollPatch();

export default function stableScroll(pi: ExtensionAPI): void {
	// Patch is installed at module load time so it also affects already-created TUI instances.
	pi.on("session_shutdown", (event) => {
		if (ALLOW_CLEAR_SCROLLBACK_REASONS.has(event.reason)) {
			allowNextClearScrollback(event.reason);
		}
	});
}
