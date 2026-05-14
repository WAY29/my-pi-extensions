import type { Api, Model } from "@mariozechner/pi-ai";

export interface TitleModelRegistry {
	find(provider: string, modelId: string): Model<Api> | undefined;
	getAll(): Model<Api>[];
	getAvailable(): Model<Api>[];
}

export function titleModelKey(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function sameModelId(model: Model<Api>, modelId: string): boolean {
	return model.id === modelId;
}

function findByModelId(models: Model<Api>[], modelId: string): Model<Api> | undefined {
	return models.find((model) => sameModelId(model, modelId));
}

function findByProvider(models: Model<Api>[], provider: string): Model<Api> | undefined {
	return models.find((model) => model.provider === provider);
}

function cloneForModelId(template: Model<Api>, modelId: string): Model<Api> {
	return {
		...template,
		id: modelId,
		name: modelId,
	};
}

function synthesizeProviderModel(registry: TitleModelRegistry, provider: string, modelId: string): Model<Api> | undefined {
	const template = findByProvider(registry.getAvailable(), provider) ?? findByProvider(registry.getAll(), provider);
	return template ? cloneForModelId(template, modelId) : undefined;
}

export function resolveTitleModelSpec(
	registry: TitleModelRegistry,
	currentModel: Model<Api> | undefined,
	spec: string,
): Model<Api> | undefined {
	const trimmed = spec.trim();
	if (!trimmed) return undefined;

	const slash = trimmed.indexOf("/");
	if (slash >= 0) {
		const provider = trimmed.slice(0, slash).trim();
		const modelId = trimmed.slice(slash + 1).trim();
		if (!provider || !modelId) return undefined;
		return registry.find(provider, modelId) ?? synthesizeProviderModel(registry, provider, modelId);
	}

	if (currentModel?.provider) {
		const currentProviderMatch = registry.find(currentModel.provider, trimmed);
		if (currentProviderMatch) return currentProviderMatch;

		// Bare model names are scoped to the active provider. If the active provider
		// does not list that model id, still use the active provider's endpoint and
		// auth with the requested id instead of silently selecting another provider.
		return cloneForModelId(currentModel, trimmed);
	}

	return findByModelId(registry.getAvailable(), trimmed) ?? findByModelId(registry.getAll(), trimmed);
}

export function resolveAutoModelSpec(
	registry: TitleModelRegistry,
	currentModel: Model<Api> | undefined,
	spec: string,
): Model<Api> | undefined {
	const trimmed = spec.trim();
	if (!trimmed) return undefined;

	const slash = trimmed.indexOf("/");
	if (slash >= 0) {
		const provider = trimmed.slice(0, slash).trim();
		const modelId = trimmed.slice(slash + 1).trim();
		if (!provider || !modelId) return undefined;
		return registry.find(provider, modelId) ?? synthesizeProviderModel(registry, provider, modelId);
	}

	return (
		findByModelId(registry.getAvailable(), trimmed) ??
		findByModelId(registry.getAll(), trimmed) ??
		(currentModel ? cloneForModelId(currentModel, trimmed) : undefined)
	);
}