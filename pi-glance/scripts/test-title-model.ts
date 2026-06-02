import { strict as assert } from "node:assert";
import type { Api, Model } from "@mariozechner/pi-ai";
import { resolveAutoModelSelection, resolveAutoModelSpec, resolveTitleModelSpec, titleModelKey, type TitleModelRegistry } from "../title-model.js";

function model(provider: string, id: string, name = id): Model<Api> {
	return {
		id,
		name,
		api: "openai-completions",
		provider: provider as Model<Api>["provider"],
		baseUrl: `https://${provider}.example.invalid`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
}

class FakeRegistry implements TitleModelRegistry {
	constructor(
		private readonly allModels: Model<Api>[],
		private readonly availableModels: Model<Api>[] = allModels,
	) {}

	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.allModels.find((candidate) => candidate.provider === provider && candidate.id === modelId);
	}

	getAll(): Model<Api>[] {
		return this.allModels;
	}

	getAvailable(): Model<Api>[] {
		return this.availableModels;
	}
}

const anthropicCurrent = model("anthropic", "claude-sonnet-4");
const anthropicShared = model("anthropic", "shared-title-model");
const openaiTitle = model("openai", "gpt-5.2");
const openaiShared = model("openai", "shared-title-model");
const unavailableOnly = model("local", "offline-title-model");
const ollamaColonId = model("ollama", "llama3.1:8b");

const registry = new FakeRegistry([anthropicCurrent, anthropicShared, openaiTitle, openaiShared, unavailableOnly, ollamaColonId], [anthropicCurrent, anthropicShared, openaiTitle, ollamaColonId]);

assert.equal(
	resolveTitleModelSpec(registry, anthropicCurrent, "openai/gpt-5.2"),
	openaiTitle,
	"provider/model title specs should resolve exactly",
);

assert.equal(
	resolveTitleModelSpec(registry, anthropicCurrent, "shared-title-model"),
	anthropicShared,
	"bare title model specs should prefer the current provider when it has the model",
);

const synthesizedCurrentProviderTitle = resolveTitleModelSpec(registry, anthropicCurrent, "gpt-5.2");
assert.equal(synthesizedCurrentProviderTitle?.provider, "anthropic", "bare title model specs should stay on the current provider");
assert.equal(synthesizedCurrentProviderTitle?.id, "gpt-5.2", "bare title model specs should keep the requested model id");
assert.equal(synthesizedCurrentProviderTitle?.baseUrl, anthropicCurrent.baseUrl, "synthesized title models should reuse current provider routing");

const autoBareRegisteredModel = resolveAutoModelSpec(registry, anthropicCurrent, "gpt-5.2");
assert.equal(autoBareRegisteredModel, openaiTitle, "bare auto model specs should switch to the configured provider for a registered model id");

const autoBareUnknownModel = resolveAutoModelSpec(registry, anthropicCurrent, "unlisted-model");
assert.equal(autoBareUnknownModel?.provider, "anthropic", "unknown bare auto model specs should still fall back to the current provider template");
assert.equal(autoBareUnknownModel?.id, "unlisted-model", "unknown bare auto model specs should keep the requested model id");

const autoThinkingSelection = resolveAutoModelSelection(registry, anthropicCurrent, "gpt-5.2:high");
assert.equal(autoThinkingSelection?.model, openaiTitle, "auto model selections should resolve the requested model before applying thinking");
assert.equal(autoThinkingSelection?.thinkingLevel, "high", "auto model selections should parse bare model thinking shorthand");

const autoProviderThinkingSelection = resolveAutoModelSelection(registry, anthropicCurrent, "openai/gpt-5.2:medium");
assert.equal(autoProviderThinkingSelection?.model, openaiTitle, "provider/model auto model selections should resolve exactly");
assert.equal(autoProviderThinkingSelection?.thinkingLevel, "medium", "provider/model auto model selections should parse thinking shorthand");

const autoColonIdSelection = resolveAutoModelSelection(registry, anthropicCurrent, "llama3.1:8b");
assert.equal(autoColonIdSelection?.model, ollamaColonId, "auto model selections should prefer exact model ids that contain colons");
assert.equal(autoColonIdSelection?.thinkingLevel, undefined, "exact colon model ids should not be misparsed as thinking shorthand");

const autoColonIdWithThinking = resolveAutoModelSelection(registry, anthropicCurrent, "llama3.1:8b:low");
assert.equal(autoColonIdWithThinking?.model, ollamaColonId, "colon model ids should still resolve when a thinking suffix is added");
assert.equal(autoColonIdWithThinking?.thinkingLevel, "low", "colon model ids should support a trailing thinking shorthand");

const synthesizedExplicitProviderTitle = resolveTitleModelSpec(registry, anthropicCurrent, "local/gpt-5.2");
assert.equal(synthesizedExplicitProviderTitle?.provider, "local", "provider/model specs should use the explicit provider");
assert.equal(synthesizedExplicitProviderTitle?.id, "gpt-5.2", "provider/model specs should keep the requested model id");
assert.equal(synthesizedExplicitProviderTitle?.baseUrl, unavailableOnly.baseUrl, "synthesized explicit provider models should reuse that provider routing");

assert.equal(resolveTitleModelSpec(registry, undefined, "gpt-5.2"), openaiTitle, "without an active model, bare specs can still resolve by model id");
assert.equal(resolveTitleModelSpec(registry, undefined, "missing-model"), undefined, "unknown title models should not resolve without an active model");
assert.equal(titleModelKey(openaiTitle), "openai/gpt-5.2", "title model keys should be provider/model");

console.log("✓ title model resolution checks passed");