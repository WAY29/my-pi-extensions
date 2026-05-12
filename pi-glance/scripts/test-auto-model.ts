import { strict as assert } from "node:assert";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	captureGlobalSettingsSnapshot,
	formatWorkspaceModelRule,
	getWorkspaceAutoModelSpec,
	listWorkspaceModelRules,
	loadGlobalDefaultModelReference,
	normalizeWorkspaceDirectory,
	normalizeWorkspaceModelRules,
	parseWorkspaceModelRuleEntry,
	restoreGlobalSettingsSnapshot,
} from "../auto-model.js";

const repo = normalizeWorkspaceDirectory("/tmp/pi-glance-auto-model/repo///");
const other = normalizeWorkspaceDirectory("/tmp/pi-glance-auto-model/other");

assert.equal(repo, "/tmp/pi-glance-auto-model/repo", "workspace directories should be normalized");
assert.equal(
	normalizeWorkspaceDirectory("./src", repo),
	"/tmp/pi-glance-auto-model/repo/src",
	"relative workspace directories should resolve from the provided base directory",
);

const rules = normalizeWorkspaceModelRules({
	" /tmp/pi-glance-auto-model/repo/// ": " openai/gpt-5.2 ",
	"/tmp/pi-glance-auto-model/empty": "   ",
	"   ": "anthropic/claude-sonnet-4",
	"/tmp/pi-glance-auto-model/other": 42,
});

assert.deepEqual(
	rules,
	{
		"/tmp/pi-glance-auto-model/repo": "openai/gpt-5.2",
	},
	"workspace auto model rules should trim paths/specs and drop invalid entries",
);

const parsedRule = parseWorkspaceModelRuleEntry("./api => anthropic/claude-sonnet-4", repo);
assert.deepEqual(
	parsedRule,
	{
		directory: "/tmp/pi-glance-auto-model/repo/api",
		model: "anthropic/claude-sonnet-4",
	},
	"workspace auto model rules should parse relative rule entries against the current workspace",
);
assert.equal(
	formatWorkspaceModelRule(parsedRule!),
	"/tmp/pi-glance-auto-model/repo/api => anthropic/claude-sonnet-4",
	"workspace auto model rules should round-trip to editable text",
);
assert.equal(
	parseWorkspaceModelRuleEntry("missing separator", repo),
	undefined,
	"workspace auto model rules should reject malformed list entries",
);

assert.deepEqual(
	listWorkspaceModelRules({
		"/tmp/pi-glance-auto-model/z": "model-z",
		"/tmp/pi-glance-auto-model/a": "model-a",
	}),
	[
		{ directory: "/tmp/pi-glance-auto-model/a", model: "model-a" },
		{ directory: "/tmp/pi-glance-auto-model/z", model: "model-z" },
	],
	"workspace auto model rules should render in stable directory order",
);

assert.equal(
	getWorkspaceAutoModelSpec(rules, repo),
	"openai/gpt-5.2",
	"exact workspace matches should resolve their configured model",
);

assert.equal(
	getWorkspaceAutoModelSpec(rules, `${repo}/src`),
	undefined,
	"workspace auto model rules should only match the exact session cwd",
);

assert.equal(
	getWorkspaceAutoModelSpec(rules, other),
	undefined,
	"unconfigured workspaces should fall back to the default model",
);

const settingsDir = await mkdtemp(join(tmpdir(), "pi-glance-settings-"));
const settingsPath = join(settingsDir, "settings.json");
const originalText = JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5.2", theme: "dark" }, null, 2);
await restoreGlobalSettingsSnapshot({ existed: true, text: originalText }, settingsPath);
assert.deepEqual(
	await loadGlobalDefaultModelReference(settingsPath),
	{ provider: "openai", modelId: "gpt-5.2" },
	"global default model references should be read from settings.json",
);
const snapshot = await captureGlobalSettingsSnapshot(settingsPath);
await restoreGlobalSettingsSnapshot({ existed: true, text: JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4" }) }, settingsPath);
await restoreGlobalSettingsSnapshot(snapshot, settingsPath);
assert.equal(await readFile(settingsPath, "utf8"), originalText, "global settings snapshots should restore the original file contents exactly");

console.log("✓ workspace auto model checks passed");
