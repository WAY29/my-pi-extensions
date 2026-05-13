/**
 * pi-rewind — /rewind command and Esc+Esc shortcut
 *
 * Registers the user-facing rewind command which presents a checkpoint
 * browser and restore options.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { RewindState } from "./state.js";
import type { CheckpointData, SyntheticWorkspaceInfo } from "./core.js";
import {
  restoreCheckpoint,
  createCheckpoint,
  diffCheckpoints,
  git,
  DEFAULT_MAX_CHECKPOINTS,
  cleanAllSyntheticWorkspaces,
  cleanWorkspaceCheckpoints,
  listSyntheticWorkspaces,
  listCheckpointRefsByRecency,
  loadCheckpointPage,
  loadAllCheckpoints,
} from "./core.js";

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function formatDate(ms: number): string {
  if (!ms) return "unknown";
  return new Date(ms).toISOString().slice(0, 10);
}

function workspaceLabel(workspace: SyntheticWorkspaceInfo): string {
  if (!workspace.valid) return `${workspace.key} (invalid metadata)`;
  return workspace.worktreePath || workspace.key;
}

function formatCheckpointLabel(cp: CheckpointData, index: number, _state: RewindState, currentBranch?: string): string {
  const time = formatTimestamp(cp.timestamp);
  const branchTag = (cp.branch && currentBranch && cp.branch !== currentBranch)
    ? ` ⚠️ ${cp.branch}`
    : (cp.branch ? ` [${cp.branch}]` : "");

  if (cp.description) {
    return `#${index + 1} [${time}]${branchTag} ${cp.description}`;
  }

  // Fallback for old checkpoints without description
  if (cp.trigger === "resume") return `#${index + 1} [${time}]${branchTag} Session start`;
  if (cp.trigger === "tool" && cp.toolName) return `#${index + 1} [${time}]${branchTag} → ${cp.toolName}`;
  return `#${index + 1} [${time}]${branchTag} Turn ${cp.turnIndex}`;
}

type RestoreMode = "all" | "files" | "conversation" | "cancel";

const RESTORE_OPTIONS: { label: string; value: RestoreMode }[] = [
  { label: "Restore all (files + conversation)", value: "all" },
  { label: "Files only (keep conversation)", value: "files" },
  { label: "Conversation only (keep files)", value: "conversation" },
  { label: "Cancel", value: "cancel" },
];

function getSortedCheckpoints(state: RewindState): CheckpointData[] {
  return [...state.checkpoints.values()].sort((a, b) => b.timestamp - a.timestamp);
}

async function ensureCheckpointRefIndex(state: RewindState): Promise<void> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) return;
  if (state.checkpointRefsLoaded) return;

  state.checkpointRefs = await listCheckpointRefsByRecency(state.repoRoot, state.sessionId, state.gitDir);
  state.checkpointRefOffset = 0;
  state.checkpointRefsLoaded = true;
  state.checkpointsLoaded = state.checkpointRefs.length === 0;
}

async function loadNextCheckpointPage(state: RewindState): Promise<void> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) return;
  await ensureCheckpointRefIndex(state);
  if (state.checkpointsLoaded) return;

  state.loadingCheckpoints ??= (async () => {
    try {
      const start = state.checkpointRefOffset;
      const end = Math.min(start + state.checkpointPageSize, state.checkpointRefs.length);
      const refs = state.checkpointRefs.slice(start, end);
      const existing = await loadCheckpointPage(state.repoRoot!, refs, state.sessionId!, state.gitDir);
      let newestResume = state.resumeCheckpoint;
      for (const cp of existing) {
        state.checkpoints.set(cp.id, cp);
        if (cp.trigger === "resume" && (!newestResume || cp.timestamp > newestResume.timestamp)) {
          newestResume = cp;
        }
      }
      state.resumeCheckpoint = newestResume;
      state.checkpointRefOffset = end;
      state.checkpointsLoaded = state.checkpointRefOffset >= state.checkpointRefs.length;
    } catch {
      // Keep newly-created in-memory checkpoints usable even if old refs fail to load.
      state.checkpointsLoaded = true;
    } finally {
      state.loadingCheckpoints = null;
    }
  })();

  await state.loadingCheckpoints;
}

async function ensureInitialCheckpointPage(state: RewindState): Promise<void> {
  await ensureCheckpointRefIndex(state);
  if (state.checkpointRefOffset === 0 && !state.checkpointsLoaded) {
    await loadNextCheckpointPage(state);
  }
  while (getSortedCheckpoints(state).length === 0 && !state.checkpointsLoaded) {
    await loadNextCheckpointPage(state);
  }
}

async function loadUntilCheckpointBefore(state: RewindState, targetTs: number): Promise<CheckpointData | undefined> {
  await ensureInitialCheckpointPage(state);
  let target = getSortedCheckpoints(state).find((cp) => cp.timestamp <= targetTs);
  while (!target && !state.checkpointsLoaded) {
    await loadNextCheckpointPage(state);
    target = getSortedCheckpoints(state).find((cp) => cp.timestamp <= targetTs);
  }
  return target;
}

// ============================================================================
// Rewind flow
// ============================================================================

async function runRewindFlow(
  state: RewindState,
  ctx: import("@mariozechner/pi-coding-agent").ExtensionCommandContext,
): Promise<void> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) {
    ctx.ui.notify("Rewind not available (checkpoint storage unavailable or no session)", "warning");
    return;
  }

  if (state.pending) await state.pending;
  await ensureInitialCheckpointPage(state);

  const checkpoints = getSortedCheckpoints(state);

  if (checkpoints.length === 0) {
    ctx.ui.notify("No checkpoints available", "warning");
    return;
  }

  // Build picker items
  const items: string[] = [];
  const currentBranch = await git("rev-parse --abbrev-ref HEAD", state.repoRoot, { gitDir: state.gitDir })
    .catch(() => state.syntheticGit ? "pi-rewind" : "unknown");
  const undoRef = state.redoStack.length > 0 ? state.redoStack[state.redoStack.length - 1] : null;
  if (undoRef) {
    items.push("↩ Undo last rewind");
  }
  for (let i = 0; i < checkpoints.length; i++) {
    items.push(formatCheckpointLabel(checkpoints[i], i, state, currentBranch));
  }
  const loadOlderLabel = `Load older ${state.checkpointPageSize} checkpoints…`;
  if (!state.checkpointsLoaded) {
    items.push(loadOlderLabel);
  }

  const choice = await ctx.ui.select("Rewind to checkpoint:", items);
  if (!choice) {
    ctx.ui.notify("Rewind cancelled", "info");
    return;
  }

  // Handle undo
  if (choice === "↩ Undo last rewind" && undoRef) {
    await performRestore(state, ctx, undoRef, "files");
    state.redoStack.pop();
    ctx.ui.notify("Undo successful — files restored to before last rewind", "info");
    return;
  }

  if (choice === loadOlderLabel) {
    await loadNextCheckpointPage(state);
    return runRewindFlow(state, ctx);
  }

  // Find selected checkpoint
  const idx = items.indexOf(choice) - (undoRef ? 1 : 0);
  if (idx < 0 || idx >= checkpoints.length) return;
  const target = checkpoints[idx];

  // Show diff preview
  let diffText = "";
  try {
    const diff = await diffCheckpoints(state.repoRoot, target.worktreeTreeSha, "HEAD", state.gitDir);
    if (diff && diff !== "(diff unavailable)") {
      diffText = diff.slice(0, 2000);
    }
  } catch {
    // Continue without preview if diff fails
  }

  if (diffText) {
    const proceed = await ctx.ui.confirm(
      `Files changed since checkpoint #${idx + 1}:\n\n${diffText}`,
      "Proceed with restore?",
    );
    if (!proceed) {
      ctx.ui.notify("Rewind cancelled", "info");
      return;
    }
  }

  // Ask restore mode
  const modeChoice = await ctx.ui.select(
    "Restore mode:",
    RESTORE_OPTIONS.map((o) => o.label),
  );
  const mode = RESTORE_OPTIONS.find((o) => o.label === modeChoice)?.value ?? "cancel";
  if (mode === "cancel") {
    ctx.ui.notify("Rewind cancelled", "info");
    return;
  }

  if (mode === "files" || mode === "all") {
    await performRestore(state, ctx, target, "files");
  }

  if (mode === "conversation" || mode === "all") {
    // Navigate conversation tree to the checkpoint's point
    // Find the entry closest to the checkpoint timestamp
    const branch = ctx.sessionManager.getBranch();
    const targetEntry = branch.reduce((best: any, entry: any) => {
      if (!entry.timestamp) return best;
      const entryTs = new Date(entry.timestamp).getTime();
      if (!best) return entryTs <= target.timestamp ? entry : best;
      const bestTs = new Date(best.timestamp).getTime();
      if (entryTs <= target.timestamp && entryTs > bestTs) return entry;
      return best;
    }, null);

    if (targetEntry) {
      try {
        await ctx.navigateTree(targetEntry.id, { summarize: true });
      } catch {
        ctx.ui.notify("Conversation rewind partially failed", "warning");
      }
    }
  }

  const what = mode === "all" ? "files + conversation"
    : mode === "files" ? "files" : "conversation";
  ctx.ui.notify(`Rewound ${what} to checkpoint #${idx + 1}`, "info");
}

async function performRestore(
  state: RewindState,
  ctx: { ui: { notify: (msg: string, level: "info" | "warning" | "error") => void } },
  target: CheckpointData,
  _mode: "files",
): Promise<void> {
  if (!state.repoRoot || !state.sessionId) return;

  // Create before-restore checkpoint (safety net)
  try {
    const beforeId = `before-restore-${state.sessionId}-${Date.now()}`;
    const beforeCp = await createCheckpoint({
      root: state.repoRoot,
      gitDir: state.gitDir,
      id: beforeId,
      sessionId: state.sessionId,
      trigger: "before-restore",
      turnIndex: 0,
    });
    state.redoStack.push(beforeCp);
  } catch {
    // Continue anyway — we tried
  }

  // Restore files
  try {
    await restoreCheckpoint(state.repoRoot, target, state.gitDir);
  } catch (err) {
    ctx.ui.notify(`Restore failed: ${err instanceof Error ? err.message : err}`, "error");
  }
}

// ============================================================================
// Handle fork/tree restore prompts
// ============================================================================

export async function handleForkRestore(
  state: RewindState,
  event: { entryId: string },
  ctx: any,
): Promise<{ cancel: true } | { skipConversationRestore: true } | undefined> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) return undefined;
  if (!ctx.hasUI) return undefined;

  if (state.pending) await state.pending;

  const entry = ctx.sessionManager.getEntry(event.entryId);
  const targetTs = entry?.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

  // Find best checkpoint, loading older pages only if needed.
  const target = (await loadUntilCheckpointBefore(state, targetTs)) ?? getSortedCheckpoints(state).slice(-1)[0];

  if (!target && state.resumeCheckpoint) {
    // Use resume checkpoint as fallback
  }

  const cp = target || state.resumeCheckpoint;

  const options: string[] = ["Conversation only (keep files)"];
  if (cp) {
    options.push("Restore all (files + conversation)");
    options.push("Code only (restore files, keep conversation)");
  }
  if (state.redoStack.length > 0) {
    options.push("↩ Undo last rewind");
  }
  options.push("Cancel");

  const choice = await ctx.ui.select("Restore Options", options);

  if (!choice || choice === "Cancel") return { cancel: true };
  if (choice === "Conversation only (keep files)") return undefined;

  if (choice === "↩ Undo last rewind" && state.redoStack.length > 0) {
    const undoCp = state.redoStack.pop()!;
    await performRestore(state, ctx, undoCp, "files");
    ctx.ui.notify("Files restored to before last rewind", "info");
    return { cancel: true };
  }

  if (!cp) {
    ctx.ui.notify("No checkpoint available", "warning");
    return undefined;
  }

  await performRestore(state, ctx, cp, "files");
  ctx.ui.notify("Files restored from checkpoint", "info");

  if (choice === "Code only (restore files, keep conversation)") {
    return { skipConversationRestore: true };
  }

  return undefined;
}

export async function handleTreeRestore(
  state: RewindState,
  event: { preparation: { targetId: string } },
  ctx: any,
): Promise<{ cancel: true } | undefined> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) return undefined;
  if (!ctx.hasUI) return undefined;

  if (state.pending) await state.pending;

  const entry = ctx.sessionManager.getEntry(event.preparation.targetId);
  const targetTs = entry?.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

  const cp = (await loadUntilCheckpointBefore(state, targetTs)) ?? state.resumeCheckpoint;

  const options: string[] = ["Keep current files"];
  if (cp) options.push("Restore files to that point");
  if (state.redoStack.length > 0) options.push("↩ Undo last rewind");
  options.push("Cancel navigation");

  const choice = await ctx.ui.select("Restore Options", options);

  if (!choice || choice === "Cancel navigation") return { cancel: true };
  if (choice === "Keep current files") return undefined;

  if (choice === "↩ Undo last rewind" && state.redoStack.length > 0) {
    const undoCp = state.redoStack.pop()!;
    await performRestore(state, ctx, undoCp, "files");
    ctx.ui.notify("Files restored to before last rewind", "info");
    return { cancel: true };
  }

  if (cp) {
    await performRestore(state, ctx, cp, "files");
    ctx.ui.notify("Files restored to checkpoint", "info");
  }

  return undefined;
}

// ============================================================================
// Cleanup commands
// ============================================================================

async function refreshCurrentSessionCache(state: RewindState): Promise<void> {
  if (!state.repoRoot || !state.sessionId) return;
  const remaining = await loadAllCheckpoints(state.repoRoot, state.sessionId, state.gitDir);
  state.checkpoints.clear();
  let newestResume: CheckpointData | null = null;
  for (const cp of remaining) {
    state.checkpoints.set(cp.id, cp);
    if (cp.trigger === "resume" && (!newestResume || cp.timestamp > newestResume.timestamp)) {
      newestResume = cp;
    }
  }
  state.resumeCheckpoint = newestResume;
  state.checkpointRefs = remaining.sort((a, b) => b.timestamp - a.timestamp).map((cp) => cp.id);
  state.checkpointRefOffset = state.checkpointRefs.length;
  state.checkpointRefsLoaded = true;
  state.checkpointsLoaded = true;
  state.loadingCheckpoints = null;
}

async function buildCleanupDryRun(state: RewindState): Promise<string> {
  const lines: string[] = ["pi-rewind cleanup preview", ""];

  if (state.repoRoot) {
    const checkpointCount = (await loadAllCheckpoints(state.repoRoot, undefined, state.gitDir).catch(() => [])).length;
    const wouldPrune = Math.max(0, checkpointCount - DEFAULT_MAX_CHECKPOINTS);
    lines.push("Current workspace:");
    lines.push(`  path: ${state.repoRoot}`);
    lines.push(`  mode: ${state.syntheticGit ? "synthetic" : "real git"}`);
    lines.push(`  checkpoints: ${checkpointCount}`);
    lines.push(`  workspace clean keeps latest ${DEFAULT_MAX_CHECKPOINTS}, would remove ${wouldPrune} refs`);
  } else {
    lines.push("Current workspace: unavailable");
  }

  const workspaces = await listSyntheticWorkspaces();
  const missing = workspaces.filter((w) => w.valid && !w.worktreeExists);
  const existing = workspaces.filter((w) => w.valid && w.worktreeExists);
  const invalid = workspaces.filter((w) => !w.valid);
  const totalSize = workspaces.reduce((sum, w) => sum + w.sizeBytes, 0);

  lines.push("");
  lines.push("Synthetic storage:");
  lines.push(`  workspaces: ${workspaces.length}`);
  lines.push(`  total size: ${formatBytes(totalSize)}`);
  lines.push(`  existing paths: ${existing.length}`);
  lines.push(`  missing paths: ${missing.length}`);
  if (invalid.length > 0) lines.push(`  invalid metadata: ${invalid.length} (skipped by cleanup)`);

  if (missing.length > 0) {
    lines.push("");
    lines.push("Missing workspaces (/rewind:clean:all deletes these):");
    for (const workspace of missing.slice(0, 10)) {
      lines.push(`  ${workspaceLabel(workspace)}`);
      lines.push(`    last used: ${formatDate(workspace.lastUsedAtMs)}, size: ${formatBytes(workspace.sizeBytes)}`);
    }
    if (missing.length > 10) lines.push(`  ... ${missing.length - 10} more`);
  }

  lines.push("");
  lines.push("Commands:");
  lines.push("  /rewind:clean:workspace  clean current workspace only");
  lines.push("  /rewind:clean:all        delete missing synthetic workspaces and prune existing synthetic repos");

  return lines.join("\n");
}

async function runWorkspaceClean(state: RewindState, ctx: any): Promise<void> {
  if (!state.gitAvailable || !state.repoRoot) {
    ctx.ui.notify("Rewind cleanup unavailable (checkpoint storage unavailable)", "warning");
    return;
  }
  if (state.pending) await state.pending;

  const result = await cleanWorkspaceCheckpoints(state.repoRoot, state.gitDir, DEFAULT_MAX_CHECKPOINTS);
  await refreshCurrentSessionCache(state);
  ctx.ui.notify(
    `Rewind workspace cleanup complete: ${result.pruned} refs removed, ` +
    `${result.checkpointCountAfter}/${result.checkpointCountBefore} checkpoints remain, gc=${result.gc}.`,
    "info",
  );
}

async function runAllClean(state: RewindState, ctx: any): Promise<void> {
  if (state.pending) await state.pending;

  const result = await cleanAllSyntheticWorkspaces(DEFAULT_MAX_CHECKPOINTS);
  await refreshCurrentSessionCache(state).catch(() => {});
  const pruned = result.cleanedExisting.reduce((sum, item) => sum + item.pruned, 0);
  ctx.ui.notify(
    `Rewind global cleanup complete: deleted ${result.deletedMissing.length} missing workspaces ` +
    `(${formatBytes(result.bytesFreed)}), cleaned ${result.cleanedExisting.length} existing synthetic workspaces, ` +
    `removed ${pruned} refs, skipped ${result.skippedInvalid.length} invalid workspaces.`,
    "info",
  );
}

// ============================================================================
// Registration
// ============================================================================

export function registerCommands(pi: ExtensionAPI, state: RewindState): void {
  pi.registerCommand("rewind", {
    description: "Rewind file changes and/or conversation to a checkpoint",
    handler: async (_args, ctx) => {
      await runRewindFlow(state, ctx);
    },
  });

  pi.registerCommand("rewind:clean:dryrun", {
    description: "Preview pi-rewind cleanup without deleting anything",
    handler: async (_args, ctx) => {
      ctx.ui.notify(await buildCleanupDryRun(state), "info");
    },
  });

  pi.registerCommand("rewind:clean:workspace", {
    description: `Clean current pi-rewind workspace, keeping latest ${DEFAULT_MAX_CHECKPOINTS} checkpoints`,
    handler: async (_args, ctx) => {
      await runWorkspaceClean(state, ctx);
    },
  });

  pi.registerCommand("rewind:clean:all", {
    description: "Clean all pi-rewind synthetic storage",
    handler: async (_args, ctx) => {
      await runAllClean(state, ctx);
    },
  });

  // Esc+Esc shortcut — register as double-escape
  pi.registerShortcut("escape escape", {
    description: "Rewind (same as /rewind)",
    handler: async (ctx) => {
      // Shortcut handler gets ExtensionContext, not CommandContext.
      // We can't call navigateTree from here, so do files-only quick rewind.
      if (!state.gitAvailable || !state.repoRoot || !state.sessionId) {
        ctx.ui.notify("Rewind not available (checkpoint storage unavailable or no session)", "warning");
        return;
      }

      const checkpoints = [...state.checkpoints.values()]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 25);

      if (checkpoints.length === 0) {
        ctx.ui.notify("No checkpoints available", "warning");
        return;
      }

      const currentBranch = await git("rev-parse --abbrev-ref HEAD", state.repoRoot, { gitDir: state.gitDir })
        .catch(() => state.syntheticGit ? "pi-rewind" : "unknown");
      const items = checkpoints.map((cp, i) => formatCheckpointLabel(cp, i, state, currentBranch));
      const choice = await ctx.ui.select("Quick rewind (files only):", items);
      if (!choice) return;

      const idx = items.indexOf(choice);
      if (idx < 0) return;

      await performRestore(state, { ui: ctx.ui }, checkpoints[idx], "files");
      ctx.ui.notify(`Files rewound to checkpoint #${idx + 1}`, "info");
    },
  });
}
