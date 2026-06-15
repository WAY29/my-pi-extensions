import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createGrepToolDefinition } from "@earendil-works/pi-coding-agent";

export type GrepToolDefinition = ReturnType<typeof createGrepToolDefinition>;
export type GrepToolDefinitionWrapper = (next: GrepToolDefinition) => GrepToolDefinition;

export interface GrepToolPlugin {
  id: string;
  priority?: number;
  wrapDefinition?: GrepToolDefinitionWrapper;
}

interface GrepToolCoordinatorState {
  plugins: Map<string, GrepToolPlugin>;
  ownerPi?: ExtensionAPI;
  cwd?: string;
}

const STATE_KEY = Symbol.for("pi.extensions.grepToolCoordinator");

function getState(): GrepToolCoordinatorState {
  const globalRecord = globalThis as typeof globalThis & {
    [STATE_KEY]?: GrepToolCoordinatorState;
  };
  globalRecord[STATE_KEY] ??= { plugins: new Map() };
  return globalRecord[STATE_KEY];
}

function orderedPlugins(state: GrepToolCoordinatorState): GrepToolPlugin[] {
  return [...state.plugins.values()].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id),
  );
}

function createComposedGrepTool(cwd: string, state: GrepToolCoordinatorState): GrepToolDefinition {
  let definition = createGrepToolDefinition(cwd);
  for (const plugin of orderedPlugins(state)) {
    if (plugin.wrapDefinition) definition = plugin.wrapDefinition(definition);
  }
  return definition;
}

function registerWithCurrentOwner(state: GrepToolCoordinatorState): boolean {
  if (!state.ownerPi || !state.cwd) return false;
  try {
    state.ownerPi.registerTool(createComposedGrepTool(state.cwd, state));
    return true;
  } catch {
    state.ownerPi = undefined;
    state.cwd = undefined;
    return false;
  }
}

export function registerGrepToolPlugin(_pi: ExtensionAPI, plugin: GrepToolPlugin): void {
  const state = getState();
  state.plugins.set(plugin.id, plugin);
  registerWithCurrentOwner(state);
}

export function ensureGrepToolRegistered(pi: ExtensionAPI, cwd: string): void {
  const state = getState();
  state.cwd = cwd;
  if (!registerWithCurrentOwner(state)) {
    state.ownerPi = pi;
    state.cwd = cwd;
    state.ownerPi.registerTool(createComposedGrepTool(cwd, state));
  }
}

export function refreshGrepTool(): void {
  registerWithCurrentOwner(getState());
}

export function releaseGrepToolOwner(pi: ExtensionAPI): void {
  const state = getState();
  if (state.ownerPi !== pi) return;
  state.ownerPi = undefined;
  state.cwd = undefined;
}

export default function grepToolCoordinator(_pi: ExtensionAPI): void {
  // This file is also discovered as a standalone pi extension. It intentionally
  // registers nothing by itself; other extensions import the named helpers above
  // to compose the shared grep tool without clobbering each other.
}
