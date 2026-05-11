import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const toHex = (data: string): string =>
  [...Buffer.from(data, "utf8")].map((b) => b.toString(16).padStart(2, "0")).join(" ");

const clip = (line: string, width: number): string =>
  line.length <= width ? line : line.slice(0, Math.max(0, width - 1)) + "…";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("keydump", {
    description: "Show raw key sequences received by pi.",
    handler: async (_args, ctx) => {
      await ctx.ui.custom((tui, _theme, keybindings, done) => {
        const log: string[] = [];

        return {
          render: (width) =>
            ["pi keydump — press keys; Esc closes", "", ...log].map((line) =>
              clip(line, width),
            ),
          invalidate: () => {},
          handleInput: (data) => {
            if (keybindings.matches(data, "tui.select.cancel")) {
              done(null);
              return;
            }

            log.unshift(`${JSON.stringify(data)}  [${toHex(data)}]`);
            if (log.length > 18) log.pop();
            tui.requestRender();
          },
        };
      });
    },
  });
}
