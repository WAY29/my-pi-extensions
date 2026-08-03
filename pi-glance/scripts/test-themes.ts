import { strict as assert } from "node:assert";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXED_THEMES, PALETTES, paletteFromHostColors, resolvePalette } from "../palette.js";
import type { GlancePalette } from "../types.js";

for (const theme of FIXED_THEMES) {
	assert.ok(PALETTES[theme], `${theme} palette should exist`);
	assert.equal(PALETTES[theme].name, theme, `${theme} palette name should match`);
}

const allThemes = Object.keys(PALETTES).sort();
assert.deepEqual(allThemes, [...FIXED_THEMES].sort(), "palette keys should match fixed themes");

function assertSegmentPalette(theme: GlancePalette): void {
	for (const segment of ["git", "plan", "sandbox", "model", "context", "tokens", "cost"] as const) {
		assert.ok(theme.segments[segment], `${theme.name} should define ${segment} segment color`);
	}
}

assertSegmentPalette(PALETTES["catppuccin-latte"]);
assertSegmentPalette(PALETTES["catppuccin-mocha"]);

// follow without host → dark fallback
const followFallback = resolvePalette("follow", null);
assert.equal(followFallback.name, "dark");

// follow with host colors
const host = paletteFromHostColors("cockpit-demo", {
	text: "#f2f5f7",
	dim: "#7d8794",
	warning: "#addfbd",
	error: "#efa7c5",
	border: "#66717f",
	accent: "#79d49a",
	success: "#8bd49c",
	muted: "#b8c0ca",
});
assert.equal(host.name, "cockpit-demo");
assert.equal(host.title.r, 0x79);
assertSegmentPalette(host);

const dir = mkdtempSync(join(tmpdir(), "glance-theme-"));
try {
	const path = join(dir, "demo.json");
	writeFileSync(
		path,
		JSON.stringify({
			name: "demo",
			vars: { a: "#112233" },
			colors: { accent: "a", text: "#ffffff", dim: "#888888", warning: "#aaaa00", error: "#ff0000", border: "#444444", success: "#00ff00", muted: "#666666" },
		}),
		"utf8",
	);
	const followed = resolvePalette("follow", { name: "demo", path });
	assert.equal(followed.name, "demo");
	assert.equal(followed.title.r, 0x11);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("✓ theme config checks passed");
