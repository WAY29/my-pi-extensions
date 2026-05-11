import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import {
  createBashToolDefinition,
  createLocalBashOperations,
} from "@earendil-works/pi-coding-agent";

type BashToolDefinition = ReturnType<typeof createBashToolDefinition>;
type BashRenderResult = (
  ...args: Parameters<NonNullable<BashToolDefinition["renderResult"]>>
) => Component;

type BashRenderResultWrapper = (next: BashRenderResult) => BashRenderResult;
type BashOperationsWrapper = (next: BashOperations) => BashOperations;

export interface BashToolPlugin {
  id: string;
  priority?: number;
  wrapOperations?: BashOperationsWrapper;
  wrapRenderResult?: BashRenderResultWrapper;
}

interface BashToolCoordinatorState {
  plugins: Map<string, BashToolPlugin>;
  ownerPi?: ExtensionAPI;
  cwd?: string;
}

const STATE_KEY = Symbol.for("pi.extensions.bashToolCoordinator");

function getState(): BashToolCoordinatorState {
  const globalRecord = globalThis as typeof globalThis & {
    [STATE_KEY]?: BashToolCoordinatorState;
  };
  globalRecord[STATE_KEY] ??= { plugins: new Map() };
  return globalRecord[STATE_KEY];
}

function orderedPlugins(state: BashToolCoordinatorState): BashToolPlugin[] {
  return [...state.plugins.values()].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id),
  );
}

function composeOperations(state: BashToolCoordinatorState): BashOperations {
  let operations = createLocalBashOperations();
  for (const plugin of orderedPlugins(state)) {
    if (plugin.wrapOperations) operations = plugin.wrapOperations(operations);
  }
  return operations;
}

function composeRenderResult(
  state: BashToolCoordinatorState,
  baseRenderResult: BashRenderResult,
): BashRenderResult {
  let renderResult = baseRenderResult;
  for (const plugin of orderedPlugins(state)) {
    if (plugin.wrapRenderResult) renderResult = plugin.wrapRenderResult(renderResult);
  }
  return renderResult;
}

function createComposedBashTool(cwd: string, state: BashToolCoordinatorState): BashToolDefinition {
  const base = createBashToolDefinition(cwd, { operations: composeOperations(state) });
  if (!base.renderResult) return base;

  return {
    ...base,
    renderResult: composeRenderResult(state, base.renderResult as BashRenderResult) as NonNullable<
      BashToolDefinition["renderResult"]
    >,
  };
}

function registerWithCurrentOwner(state: BashToolCoordinatorState): boolean {
  if (!state.ownerPi || !state.cwd) return false;
  try {
    state.ownerPi.registerTool(createComposedBashTool(state.cwd, state));
    return true;
  } catch {
    state.ownerPi = undefined;
    state.cwd = undefined;
    return false;
  }
}

export function registerBashToolPlugin(_pi: ExtensionAPI, plugin: BashToolPlugin): void {
  const state = getState();
  state.plugins.set(plugin.id, plugin);
  registerWithCurrentOwner(state);
}

export function ensureBashToolRegistered(pi: ExtensionAPI, cwd: string): void {
  const state = getState();
  state.cwd = cwd;
  if (!registerWithCurrentOwner(state)) {
    state.ownerPi = pi;
    state.cwd = cwd;
    state.ownerPi.registerTool(createComposedBashTool(cwd, state));
  }
}

export function refreshBashTool(): void {
  registerWithCurrentOwner(getState());
}

export function releaseBashToolOwner(pi: ExtensionAPI): void {
  const state = getState();
  if (state.ownerPi !== pi) return;
  state.ownerPi = undefined;
  state.cwd = undefined;
}

export default function bashToolCoordinator(_pi: ExtensionAPI): void {
  // This file is also discovered as a standalone pi extension when placed in
  // the extensions directory. It intentionally registers nothing by itself;
  // other extensions import the named helpers above to compose the shared bash tool.
}

export type { BashRenderResult, BashRenderResultWrapper, BashOperationsWrapper };
