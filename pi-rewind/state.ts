/**
 * pi-rewind — Shared state
 *
 * Mutable state shared between index.ts, commands.ts, and ui.ts.
 */

import type { CheckpointData } from "./core.js";

export interface RewindState {
  /** Is git-backed checkpoint storage available? */
  gitAvailable: boolean;
  /** Absolute path to repo root, or real worktree root for synthetic storage */
  repoRoot: string | null;
  /** External bare git dir for non-git workspaces; null for real git repos */
  gitDir: string | null;
  /** True when using pi-rewind-managed git storage outside the worktree */
  syntheticGit: boolean;
  /** Current session ID (UUID) */
  sessionId: string | null;
  /** In-memory checkpoint cache: checkpoint ID → data */
  checkpoints: Map<string, CheckpointData>;
  /** Checkpoint taken at session start (fallback for restore) */
  resumeCheckpoint: CheckpointData | null;
  /** Stack of before-restore checkpoints for undo */
  redoStack: CheckpointData[];
  /** True if checkpoint creation failed (stop retrying) */
  failed: boolean;
  /** Promise of in-flight checkpoint (avoid races) */
  pending: Promise<void> | null;
  /** Current turn index (updated by turn_start) */
  currentTurnIndex: number;
  /** Current user prompt (updated by before_agent_start) */
  currentPrompt: string;
  /** Pending tool info captured from tool_call (before execution ends) */
  pendingToolInfo: Map<string, string>;
  /** Tool descriptions accumulated during the current turn */
  turnToolDescriptions: string[];
  /** Whether the current turn had any mutating tool calls */
  turnHadMutations: boolean;
  /** Last worktree tree SHA (to detect actual file changes) */
  lastWorktreeTree: string | null;
}

export function createInitialState(): RewindState {
  return {
    gitAvailable: false,
    repoRoot: null,
    gitDir: null,
    syntheticGit: false,
    sessionId: null,
    checkpoints: new Map(),
    resumeCheckpoint: null,
    redoStack: [],
    failed: false,
    pending: null,
    currentTurnIndex: 0,
    currentPrompt: "",
    pendingToolInfo: new Map(),
    turnToolDescriptions: [],
    turnHadMutations: false,
    lastWorktreeTree: null,
  };
}

export function resetState(state: RewindState): void {
  state.gitAvailable = false;
  state.repoRoot = null;
  state.gitDir = null;
  state.syntheticGit = false;
  state.sessionId = null;
  state.checkpoints.clear();
  state.resumeCheckpoint = null;
  state.redoStack = [];
  state.failed = false;
  state.pending = null;
  state.currentTurnIndex = 0;
  state.currentPrompt = "";
  state.pendingToolInfo.clear();
  state.turnToolDescriptions = [];
  state.turnHadMutations = false;
  state.lastWorktreeTree = null;
}
