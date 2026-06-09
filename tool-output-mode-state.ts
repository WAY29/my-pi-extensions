import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ToolOutputMode = "hidden" | "compact" | "full";

interface ToolOutputModeState {
  active: boolean;
  mode: ToolOutputMode;
}

const STATE_KEY = Symbol.for("pi.extensions.toolOutputMode");

function getState(): ToolOutputModeState {
  const globalRecord = globalThis as typeof globalThis & {
    [STATE_KEY]?: ToolOutputModeState;
  };
  globalRecord[STATE_KEY] ??= {
    active: false,
    mode: "hidden",
  };
  return globalRecord[STATE_KEY];
}

export function activateToolOutputMode(): void {
  getState().active = true;
}

export function deactivateToolOutputMode(): void {
  getState().active = false;
}

export function getToolOutputMode(): ToolOutputMode | undefined {
  const state = getState();
  return state.active ? state.mode : undefined;
}

export function peekToolOutputMode(): ToolOutputMode {
  return getState().mode;
}

export function setToolOutputMode(mode: ToolOutputMode): ToolOutputMode {
  const state = getState();
  const previousMode = state.mode;
  state.mode = mode;
  return previousMode;
}

export function nextToolOutputMode(
  mode: ToolOutputMode = peekToolOutputMode(),
): ToolOutputMode {
  if (mode === "hidden") return "compact";
  if (mode === "compact") return "full";
  return "hidden";
}

export default function toolOutputModeStateHelper(_pi: ExtensionAPI): void {
  // This file lives at the top level so sibling extensions can import it.
  // Pi auto-discovers top-level .ts files as extensions, so keep a no-op
  // default export to make discovery safe.
}
