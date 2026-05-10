import { strict as assert } from "node:assert";
import { visibleWidth } from "@mariozechner/pi-tui";
import { defaultConfig } from "../config.js";
import { stripControls } from "../format.js";
import { renderInputSurface } from "../renderer.js";
import { fallbackTitleFromPrompt, sanitizeGeneratedTitle, shouldGenerateTitle, TITLE_MAX_WIDTH } from "../title.js";
import { testState } from "./helpers.js";

const config = defaultConfig();

const titled = renderInputSurface(testState({ title: { text: "Refactor authentication flow", generating: false } }), config, 80);
assert.equal(stripControls(titled.at(-1) ?? ""), "Refactor authentication flow", "title should render below the input box");

const disabled = defaultConfig();
disabled.title.enabled = false;
const hidden = renderInputSurface(testState({ title: { text: "Hidden title", generating: false } }), disabled, 80).join("\n");
assert.ok(!stripControls(hidden).includes("Hidden title"), "disabled title config should hide the title line");

const generating = renderInputSurface(testState({ title: { text: null, generating: true } }), config, 80);
assert.equal(stripControls(generating.at(-1) ?? ""), "Generating Title...", "generating state should render a placeholder below the box");

assert.equal(sanitizeGeneratedTitle('"Fix login flow."', "fallback"), "Fix login flow", "generated title should drop quotes and trailing punctuation");
assert.equal(sanitizeGeneratedTitle("\n# Update glance title rendering\n\nextra", "fallback"), "Update glance title rendering", "generated title should keep the first clean line");
assert.equal(sanitizeGeneratedTitle("标题：修改 glance 标题显示", "fallback"), "修改 glance 标题显示", "generated title should drop common title prefixes");
assert.equal(sanitizeGeneratedTitle("\x1b[31mColored generated title\x1b[0m", "fallback"), "Colored generated title", "title text should drop ANSI controls");

const fallback = fallbackTitleFromPrompt("请帮我修改 glance 扩展，第一次用户提问之后生成一个很长很长的标题用于测试截断");
assert.equal(TITLE_MAX_WIDTH, 64, "title budget should allow longer generated titles");
assert.ok(visibleWidth(fallback) <= TITLE_MAX_WIDTH, "fallback title should fit the title budget");
assert.ok(!fallback.includes("\x1b"), "fallback title should not persist ANSI controls from truncation");
assert.ok(fallback.startsWith("请帮我修改"), "fallback title should preserve the user's language/content");

assert.equal(
	shouldGenerateTitle({ text: "local fallback", generating: false, source: "fallback" }, "openai/gpt-5.2"),
	true,
	"stored fallback titles should be eligible for AI upgrade when a title model is configured",
);
assert.equal(
	shouldGenerateTitle({ text: "legacy local fallback", generating: false }, "openai/gpt-5.2"),
	true,
	"legacy stored titles without source metadata should be eligible for AI upgrade",
);
assert.equal(
	shouldGenerateTitle({ text: "old fallback", generating: false, source: "fallback", model: "openai/gpt-5.2" }, "openai/gpt-5.2"),
	true,
	"fallback titles from the same attempted model should be eligible for retry after the title generator changes or reloads",
);
assert.equal(
	shouldGenerateTitle({ text: "AI title", generating: false, source: "llm", model: "openai/gpt-5.2" }, "anthropic/claude-sonnet-4"),
	false,
	"existing AI titles should not be replaced just because the configured title model changes",
);

console.log("✓ title rendering and normalization checks passed");