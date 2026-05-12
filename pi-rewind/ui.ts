/**
 * pi-rewind — UI helpers
 *
 * Footer status and notifications.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { RewindState } from "./state.js";

const STATUS_KEY = "rewind";

/** Update footer status with checkpoint count */
export function updateStatus(state: RewindState, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  if (!state.gitAvailable) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const theme = ctx.ui.theme;
  if (state.failed) {
    ctx.ui.setStatus(STATUS_KEY, theme.fg("warning", "◆ rewind disabled"));
    return;
  }

  const count = state.checkpoints.size;
  const kind = state.syntheticGit ? "local checkpoint" : "checkpoint";
  ctx.ui.setStatus(
    STATUS_KEY,
    theme.fg("dim", "◆ ") + theme.fg("muted", `${count} ${kind}${count === 1 ? "" : "s"}`),
  );
}

/** Clear status */
export function clearStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, undefined);
}
