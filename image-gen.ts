import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, isAbsolute, relative, resolve } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	// @ts-expect-error compat-only runtime exports; extension loader aliases root to compat.
	generateImages,
	// @ts-expect-error compat-only runtime exports; extension loader aliases root to compat.
	registerImagesApiProvider,
	StringEnum,
	Type,
	type AssistantImages,
	type ImageContent,
	type ImagesFunction,
	type ImagesModel,
	type Model,
	type ProviderImagesOptions,
	type Static,
	type Usage,
} from "@earendil-works/pi-ai";

const OPENAI_IMAGES_API = "openai-images" as const;
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const TRANSPARENT_IMAGE_MODEL = "gpt-image-1.5";
const DEFAULT_GROK_IMAGE_MODEL = "grok-imagine-image";
const DEFAULT_GROK_QUALITY_MODEL = "grok-imagine-image-quality";
const DEFAULT_OUTPUT_DIR = "output/imagegen";
const MAX_INPUT_IMAGES = 16;
const TRANSPARENT_CHROMA_KEY_HEX = "#00FF00";

const ACTION_VALUES = ["auto", "generate", "edit"] as const;
const BACKGROUND_VALUES = ["auto", "opaque", "transparent"] as const;
const QUALITY_VALUES = ["auto", "low", "medium", "high"] as const;
const OUTPUT_FORMAT_VALUES = ["png", "webp", "jpeg"] as const;
const SAFE_RESPONSES_SIZES = new Set(["auto", "1024x1024", "1024x1536", "1536x1024"]);

const IMAGE_GEN_PARAMS = Type.Object({
	prompt: Type.String({ description: "The full image generation or edit request" }),
	action: Type.Optional(
		StringEnum(ACTION_VALUES, {
			description: "Whether to auto-detect, force a new generation, or force an edit workflow",
			default: "auto",
		}),
	),
	image_paths: Type.Optional(
		Type.Array(Type.String({ description: "Workspace image path to use as a reference or edit input" }), {
			description: "Explicit workspace image paths. Preferred over attached images when provided.",
			maxItems: MAX_INPUT_IMAGES,
		}),
	),
	mask_path: Type.Optional(Type.String({ description: "Workspace mask image path. v1 only supports explicit mask files." })),
	background: Type.Optional(
		StringEnum(BACKGROUND_VALUES, {
			description: "Background mode. Use transparent when the output needs real alpha.",
		}),
	),
	size: Type.Optional(
		Type.String({
			description:
				"Output size. GPT Image: 1024x1024 / 1536x1024 / auto. Grok Imagine: aspect ratio (1:1, 16:9, auto) or resolution (1k, 2k).",
		}),
	),
	quality: Type.Optional(
		StringEnum(QUALITY_VALUES, {
			description: "Output quality. Use high for text-heavy or detail-critical assets.",
		}),
	),
	n: Type.Optional(Type.Integer({ description: "Number of images to generate", minimum: 1, maximum: 10 })),
	output_format: Type.Optional(
		StringEnum(OUTPUT_FORMAT_VALUES, {
			description: "Final output format for generated images",
		}),
	),
	output_compression: Type.Optional(
		Type.Integer({
			description: "Compression percentage for JPEG/WebP output (0-100)",
			minimum: 0,
			maximum: 100,
		}),
	),
	input_fidelity: Type.Optional(
		Type.String({ description: "Optional input fidelity control for edit/reference workflows on models that support it" }),
	),
	model: Type.Optional(
		Type.String({
			description:
				"Image model id. GPT: gpt-image-2 / gpt-image-1.5. Grok: grok-imagine-image / grok-imagine-image-quality. Default follows current chat provider.",
		}),
	),
	output_dir: Type.Optional(Type.String({ description: "Workspace output directory. Defaults to output/imagegen" })),
	filename_prefix: Type.Optional(Type.String({ description: "Stable filename prefix for saved outputs" })),
});

type ImageGenParams = Static<typeof IMAGE_GEN_PARAMS>;
type ImageGenAction = (typeof ACTION_VALUES)[number];
type BackgroundMode = (typeof BACKGROUND_VALUES)[number];
type QualityMode = (typeof QUALITY_VALUES)[number];
type OutputFormat = (typeof OUTPUT_FORMAT_VALUES)[number];

type OpenAIImagesOptions = ProviderImagesOptions & {
	action?: ImageGenAction;
	background?: BackgroundMode;
	size?: string;
	quality?: QualityMode;
	n?: number;
	output_format?: OutputFormat;
	output_compression?: number;
	input_fidelity?: string;
	mask?: ImageContent;
};

type ResolvedImageInput = {
	source: "path" | "recent-attachment" | "mask";
	label: string;
	mimeType: string;
	data: string;
	hash: string;
	path?: string;
	displayPath?: string;
};

type OpenAIRequestAuth = {
	apiKey: string;
	baseUrl: string;
	headers?: Record<string, string>;
	providerModel: Model<any>;
};

type OpenAIImagesModel = ImagesModel<typeof OPENAI_IMAGES_API> & {
	responseModelId: string;
	responseApi: string;
};

type SelectedModel = {
	explicitModel?: string;
	effectiveModel: string;
	notes: string[];
};

type SavedImage = {
	path: string;
	displayPath: string;
	mimeType: string;
	bytes: number;
	content: ImageContent;
};

type ImageGenDetails = {
	route: "generations" | "edits";
	backend: "responses" | "images";
	responseId?: string;
	requested: {
		action: ImageGenAction;
		background?: BackgroundMode;
		size?: string;
		quality?: QualityMode;
		n?: number;
		output_format?: OutputFormat;
		output_compression?: number;
		input_fidelity?: string;
		model?: string;
		output_dir: string;
		filename_prefix?: string;
	};
	effective: {
		model: string;
		background?: BackgroundMode;
		size?: string;
		quality?: QualityMode;
		n: number;
		output_format?: OutputFormat;
		output_compression?: number;
		usedRecentAttachments: boolean;
		notes: string[];
	};
	outputs: Array<{
		path: string;
		displayPath: string;
		mimeType: string;
		bytes: number;
	}>;
	inputImages: Array<{
		source: ResolvedImageInput["source"];
		label: string;
		mimeType: string;
		path?: string;
		displayPath?: string;
	}>;
	mask?: {
		path: string;
		displayPath: string;
		mimeType: string;
	};
	providerModel: {
		provider: string;
		id: string;
		baseUrl: string;
	};
};

type OpenAIImagesResponse = {
	id?: string;
	data?: Array<{
		b64_json?: string;
		url?: string;
		mime_type?: string;
		revised_prompt?: string;
	}>;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		total_tokens?: number;
		input_tokens_details?: {
			text_tokens?: number;
			image_tokens?: number;
		};
		output_tokens_details?: {
			text_tokens?: number;
			image_tokens?: number;
		};
	};
	output_format?: string;
	error?: {
		message?: string;
	};
};

function stripLeadingAt(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function isGptImage2Model(modelId: string): boolean {
	return modelId === "gpt-image-2" || modelId.startsWith("gpt-image-2-");
}

function isGrokImagineModel(modelId: string): boolean {
	return modelId.startsWith("grok-imagine");
}

function isGrokProvider(provider: string | undefined): boolean {
	if (!provider) {
		return false;
	}
	return provider === "internal-grok" || provider === "xai" || provider.includes("grok");
}

function mapSizeForGrok(size: string | undefined): { aspect_ratio?: string; resolution?: string } {
	const normalized = normalizeOptionalString(size);
	if (!normalized) {
		return {};
	}
	if (normalized === "1k" || normalized === "2k") {
		return { resolution: normalized };
	}
	if (normalized === "auto" || normalized.includes(":")) {
		return { aspect_ratio: normalized };
	}
	const common: Record<string, string> = {
		"1024x1024": "1:1",
		"1024x1536": "2:3",
		"1536x1024": "3:2",
		"1024x1792": "9:16",
		"1792x1024": "16:9",
	};
	if (common[normalized]) {
		return { aspect_ratio: common[normalized] };
	}
	const match = normalized.match(/^(\d+)x(\d+)$/i);
	if (!match) {
		return {};
	}
	const width = Number(match[1]);
	const height = Number(match[2]);
	let a = width;
	let b = height;
	while (b !== 0) {
		const next = a % b;
		a = b;
		b = next;
	}
	const g = a || 1;
	return {
		aspect_ratio: `${width / g}:${height / g}`,
		resolution: Math.max(width, height) >= 1536 ? "2k" : "1k",
	};
}

function ensureTrailingSlash(url: string): string {
	return url.endsWith("/") ? url : `${url}/`;
}

function buildEndpoint(baseUrl: string, path: string): string {
	return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function shortHashFromBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

function shortHashFromBase64(base64Data: string): string {
	return createHash("sha256").update(base64Data, "base64").digest("hex").slice(0, 12);
}

function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	return slug || "imagegen";
}

function outputFormatToMimeType(format?: string): string {
	switch ((format ?? "png").toLowerCase()) {
		case "jpeg":
		case "jpg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		case "png":
		default:
			return "image/png";
	}
}

function mimeTypeToExtension(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "image/png":
		default:
			return "png";
	}
}

function mimeTypeToOutputFormat(mimeType: string): OutputFormat {
	switch (mimeType.toLowerCase()) {
		case "image/jpeg":
			return "jpeg";
		case "image/webp":
			return "webp";
		case "image/png":
		default:
			return "png";
	}
}

function pathToMimeType(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		default:
			throw new Error(`Unsupported image file type for ${path}. Supported extensions: .png, .jpg, .jpeg, .webp, .gif`);
	}
}

function toDataUrl(image: ImageContent): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

function normalizeResponsesToolSize(size: string | undefined): string | undefined {
	const normalized = normalizeOptionalString(size);
	if (!normalized) {
		return undefined;
	}
	return SAFE_RESPONSES_SIZES.has(normalized) ? normalized : undefined;
}

function createImageContent(input: ResolvedImageInput): ImageContent {
	return {
		type: "image",
		mimeType: input.mimeType,
		data: input.data,
	};
}

function buildTextSummaryLines(details: ImageGenDetails): string[] {
	const workflowLabel = details.backend === "responses" ? "/responses + image_generation" : `/images/${details.route}`;
	const lines = [
		`image_gen completed via ${workflowLabel}.`,
		`Model: ${details.effective.model}`,
		`Output dir: ${details.requested.output_dir}`,
	];

	if (details.responseId) {
		lines.push(`Response ID: ${details.responseId}`);
	}

	if (details.inputImages.length > 0) {
		lines.push(`Inputs: ${details.inputImages.map((image) => image.displayPath ?? image.label).join(", ")}`);
	}

	if (details.mask) {
		lines.push(`Mask: ${details.mask.displayPath}`);
	}

	if (details.effective.notes.length > 0) {
		lines.push(...details.effective.notes.map((note) => `Note: ${note}`));
	}

	lines.push("Saved files:");
	for (const output of details.outputs) {
		lines.push(`- ${output.displayPath}`);
	}

	return lines;
}

function normalizeDisplayPath(cwd: string, targetPath: string): string {
	if (!targetPath.startsWith(cwd)) {
		return targetPath;
	}

	const rel = relative(cwd, targetPath);
	return rel || ".";
}

function buildRequestSignature(params: {
	prompt: string;
	filenamePrefix?: string;
	model: string;
	action: ImageGenAction;
	background?: BackgroundMode;
	size?: string;
	quality?: QualityMode;
	n?: number;
	output_format?: OutputFormat;
	output_compression?: number;
	input_fidelity?: string;
	images: ResolvedImageInput[];
	mask?: ResolvedImageInput;
}): string {
	const payload = JSON.stringify({
		prompt: params.prompt,
		filenamePrefix: params.filenamePrefix,
		model: params.model,
		action: params.action,
		background: params.background,
		size: params.size,
		quality: params.quality,
		n: params.n,
		output_format: params.output_format,
		output_compression: params.output_compression,
		input_fidelity: params.input_fidelity,
		images: params.images.map((image) => ({ hash: image.hash, label: image.label, path: image.displayPath })),
		mask: params.mask ? { hash: params.mask.hash, path: params.mask.displayPath } : undefined,
	});
	return createHash("sha256").update(payload).digest("hex").slice(0, 10);
}

function buildTransparentFallbackPrompt(prompt: string): string {
	return `${prompt}\n\nRender the subject on a perfectly flat solid ${TRANSPARENT_CHROMA_KEY_HEX} chroma-key background. Do not use that exact green anywhere inside the subject. No checkerboard, no textured backdrop, and no cast shadow unless explicitly requested.`;
}

function buildRequestHeaders(headers: Record<string, string> | undefined, apiKey: string | undefined): Record<string, string> {
	const merged: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json",
		...(headers ?? {}),
	};

	const hasAuthorization = Object.keys(merged).some((key) => key.toLowerCase() === "authorization");
	if (!hasAuthorization && apiKey) {
		merged.Authorization = `Bearer ${apiKey}`;
	}

	return merged;
}

function parseUsage(rawUsage: OpenAIImagesResponse["usage"]): Usage | undefined {
	if (!rawUsage) {
		return undefined;
	}

	const input = rawUsage.input_tokens ?? 0;
	const output = rawUsage.output_tokens ?? 0;
	const totalTokens = rawUsage.total_tokens ?? input + output;

	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

async function readErrorMessage(response: Response): Promise<string> {
	const bodyText = await response.text();
	if (!bodyText) {
		return `${response.status} ${response.statusText}`;
	}

	try {
		const parsed = JSON.parse(bodyText) as OpenAIImagesResponse;
		const message = parsed.error?.message;
		if (message) {
			return `${response.status} ${response.statusText}: ${message}`;
		}
	} catch {
		// Ignore JSON parse failure and fall back to raw body.
	}

	return `${response.status} ${response.statusText}: ${bodyText}`;
}

async function requestImagesEndpoint(
	model: ImagesModel<typeof OPENAI_IMAGES_API>,
	context: { input: Array<{ type: "text"; text: string } | ImageContent> },
	options: OpenAIImagesOptions | undefined,
	output: AssistantImages,
): Promise<void> {
	const textPrompt = context.input
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text.trim())
		.filter(Boolean)
		.join("\n\n");
	if (!textPrompt) {
		throw new Error("image_gen requires a non-empty prompt.");
	}

	const inputImages = context.input.filter((item): item is ImageContent => item.type === "image");
	const route: "generations" | "edits" = inputImages.length > 0 || options?.mask ? "edits" : "generations";
	if (options?.action === "edit" && inputImages.length === 0) {
		throw new Error("image_gen action=edit requires at least one input image.");
	}

	const endpoint = buildEndpoint(model.baseUrl, route === "generations" ? "images/generations" : "images/edits");
	const grok = isGrokImagineModel(model.id);
	const basePayload: Record<string, unknown> = {
		model: model.id,
		prompt: textPrompt,
	};

	if (options?.n !== undefined) {
		basePayload.n = options.n;
	}

	if (grok) {
		// xAI Images API: aspect_ratio/resolution + b64_json; edits use image/images.url
		basePayload.response_format = "b64_json";
		const mapped = mapSizeForGrok(options?.size);
		if (mapped.aspect_ratio) {
			basePayload.aspect_ratio = mapped.aspect_ratio;
		}
		if (mapped.resolution) {
			basePayload.resolution = mapped.resolution;
		} else if (options?.quality === "high") {
			basePayload.resolution = "2k";
		}
		if (route === "edits") {
			if (options?.mask) {
				throw new Error("Grok Imagine does not support mask_path.");
			}
			if (inputImages.length === 1) {
				basePayload.image = { url: toDataUrl(inputImages[0]) };
			} else {
				basePayload.images = inputImages.map((image) => ({ url: toDataUrl(image) }));
			}
		}
	} else {
		if (options?.background !== undefined) {
			basePayload.background = options.background;
		}
		if (options?.size !== undefined) {
			basePayload.size = options.size;
		}
		if (options?.quality !== undefined) {
			basePayload.quality = options.quality;
		}
		if (options?.output_format !== undefined) {
			basePayload.output_format = options.output_format;
		}
		if (options?.output_compression !== undefined) {
			basePayload.output_compression = options.output_compression;
		}

		if (route === "edits") {
			basePayload.images = inputImages.map((image) => ({ image_url: toDataUrl(image) }));
			if (options?.mask) {
				basePayload.mask = { image_url: toDataUrl(options.mask) };
			}
			if (options?.input_fidelity !== undefined) {
				basePayload.input_fidelity = options.input_fidelity;
			}
		}
	}

	let payload: unknown = basePayload;
	const overriddenPayload = await options?.onPayload?.(payload, model);
	if (overriddenPayload !== undefined) {
		payload = overriddenPayload;
	}

	const response = await fetch(endpoint, {
		method: "POST",
		headers: buildRequestHeaders(model.headers, options?.apiKey),
		body: JSON.stringify(payload),
		signal: options?.signal,
	});
	await options?.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }, model);

	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}

	const responseJson = (await response.json()) as OpenAIImagesResponse;
	if (responseJson.error?.message) {
		throw new Error(responseJson.error.message);
	}

	output.responseId = responseJson.id;
	output.usage = parseUsage(responseJson.usage);

	const fallbackMimeType = outputFormatToMimeType(responseJson.output_format ?? options?.output_format);
	for (const item of responseJson.data ?? []) {
		const mimeType = item.mime_type ?? fallbackMimeType;
		if (item.b64_json) {
			output.output.push({ type: "image", mimeType, data: item.b64_json });
		} else if (item.url) {
			const imageResponse = await fetch(item.url, { signal: options?.signal });
			if (!imageResponse.ok) {
				throw new Error(`Failed to download generated image URL: ${imageResponse.status} ${imageResponse.statusText}`);
			}
			const bytes = new Uint8Array(await imageResponse.arrayBuffer());
			output.output.push({ type: "image", mimeType, data: Buffer.from(bytes).toString("base64") });
		}
		if (item.revised_prompt) {
			output.output.push({ type: "text", text: `Revised prompt: ${item.revised_prompt}` });
		}
	}
}

async function requestResponsesImageGeneration(
	model: OpenAIImagesModel,
	context: { input: Array<{ type: "text"; text: string } | ImageContent> },
	options: OpenAIImagesOptions | undefined,
	output: AssistantImages,
): Promise<void> {
	const textPrompt = context.input
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text.trim())
		.filter(Boolean)
		.join("\n\n");
	if (!textPrompt) {
		throw new Error("image_gen requires a non-empty prompt.");
	}

	const inputImages = context.input.filter((item): item is ImageContent => item.type === "image");
	if (options?.action === "edit" && inputImages.length === 0) {
		throw new Error("image_gen action=edit requires at least one input image.");
	}

	const tool: Record<string, unknown> = {
		type: "image_generation",
		model: model.id,
	};
	if (options?.action !== undefined) {
		tool.action = options.action;
	}
	if (options?.background !== undefined) {
		tool.background = options.background;
	}
	const normalizedToolSize = normalizeResponsesToolSize(options?.size);
	if (normalizedToolSize !== undefined) {
		tool.size = normalizedToolSize;
	}
	if (options?.quality !== undefined) {
		tool.quality = options.quality;
	}
	if (options?.n !== undefined && options.n !== 1) {
		tool.n = options.n;
	}
	if (options?.output_format !== undefined) {
		tool.output_format = options.output_format;
	}
	if (options?.output_compression !== undefined) {
		tool.output_compression = options.output_compression;
	}
	if (options?.input_fidelity !== undefined) {
		tool.input_fidelity = options.input_fidelity;
	}
	if (options?.mask) {
		tool.input_image_mask = { image_url: toDataUrl(options.mask) };
	}

	const basePayload: Record<string, unknown> = {
		model: model.responseModelId,
		input: [
			{
				role: "user",
				content: [
					{ type: "input_text", text: textPrompt },
					...inputImages.map((image) => ({ type: "input_image", image_url: toDataUrl(image), detail: "auto" })),
				],
			},
		],
		tools: [tool],
	};

	let payload: unknown = basePayload;
	const overriddenPayload = await options?.onPayload?.(payload, model);
	if (overriddenPayload !== undefined) {
		payload = overriddenPayload;
	}

	const endpoint = buildEndpoint(model.baseUrl, "responses");
	const response = await fetch(endpoint, {
		method: "POST",
		headers: buildRequestHeaders(model.headers, options?.apiKey),
		body: JSON.stringify(payload),
		signal: options?.signal,
	});
	await options?.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }, model);

	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}

	const responseJson = (await response.json()) as OpenAIImagesResponse & {
		output?: Array<{
			type?: string;
			result?: string;
			output_format?: string;
			revised_prompt?: string;
			background?: string;
			action?: string;
			quality?: string;
			size?: string;
			status?: string;
		}>;
	};
	if (responseJson.error?.message) {
		throw new Error(responseJson.error.message);
	}

	output.responseId = responseJson.id;
	output.usage = parseUsage(responseJson.usage);

	const imageCalls = (responseJson.output ?? []).filter((item) => item.type === "image_generation_call");
	for (const call of imageCalls) {
		if (call.result) {
			const mimeType = outputFormatToMimeType(call.output_format ?? options?.output_format);
			output.output.push({ type: "image", mimeType, data: call.result });
		}
		if (call.revised_prompt) {
			output.output.push({ type: "text", text: `Revised prompt: ${call.revised_prompt}` });
		}
	}
}

const generateImagesOpenAI: ImagesFunction<typeof OPENAI_IMAGES_API, OpenAIImagesOptions> = async (model, context, options) => {
	const output: AssistantImages = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "stop",
		timestamp: Date.now(),
	};

	try {
		const openAIImagesModel = model as OpenAIImagesModel;
		// Grok Imagine is Images API only; GPT Image may use responses or /images.
		if (!isGrokImagineModel(model.id) && openAIImagesModel.responseApi === "openai-responses") {
			await requestResponsesImageGeneration(openAIImagesModel, context, options, output);
		} else {
			await requestImagesEndpoint(model, context, options, output);
		}

		if (!output.output.some((item) => item.type === "image")) {
			throw new Error("OpenAI-compatible backend returned no generated image data.");
		}

		return output;
	} catch (error) {
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = error instanceof Error ? error.message : String(error);
		return output;
	}
};

function isOpenAICompatibleModel(model: Model<any>): boolean {
	return model.provider === "openai" || model.api === "openai-responses" || model.api === "openai-completions";
}

async function resolveOpenAIRequestAuth(ctx: ExtensionContext, imageModelId: string): Promise<OpenAIRequestAuth> {
	const availableModels = await ctx.modelRegistry.getAvailable();
	const wantGrok = isGrokImagineModel(imageModelId);
	const preferredModel = wantGrok
		? (availableModels.find((model: Model<any>) => model.provider === "internal-grok") ??
			availableModels.find((model: Model<any>) => isGrokProvider(model.provider)) ??
			availableModels.find((model: Model<any>) => model.id.toLowerCase().includes("grok")))
		: (availableModels.find((model: Model<any>) => model.provider === "openai") ??
			availableModels.find((model: Model<any>) => model.provider === "internal") ??
			availableModels.find((model: Model<any>) => isOpenAICompatibleModel(model) && !isGrokProvider(model.provider)) ??
			availableModels.find((model: Model<any>) => isOpenAICompatibleModel(model)));
	if (!preferredModel) {
		const knownCompatible = ctx.modelRegistry.getAll().find((model: Model<any>) => isOpenAICompatibleModel(model));
		if (knownCompatible) {
			throw new Error(
				wantGrok
					? `No configured auth found for a Grok-compatible provider (internal-grok/xai). Found unconfigured provider ${knownCompatible.provider}.`
					: `No configured auth found for an OpenAI-compatible provider. Expected provider "openai"/"internal" or another provider using openai-responses/openai-completions; found unconfigured provider ${knownCompatible.provider}.`,
			);
		}
		throw new Error(
			wantGrok
				? "No Grok-compatible provider model is available in pi's model registry, so image_gen cannot resolve Grok Imagine routing."
				: "No OpenAI-compatible provider model is available in pi's model registry, so image_gen cannot resolve image API routing.",
		);
	}

	const resolvedAuth = await ctx.modelRegistry.getApiKeyAndHeaders(preferredModel);
	if (!resolvedAuth.ok) {
		throw new Error(`Failed to resolve image API auth for image_gen: ${resolvedAuth.error}`);
	}
	if (!resolvedAuth.apiKey) {
		throw new Error("Resolved image API auth for image_gen did not include an API key.");
	}

	return {
		apiKey: resolvedAuth.apiKey,
		baseUrl: preferredModel.baseUrl,
		headers: resolvedAuth.headers,
		providerModel: preferredModel,
	};
}

function selectImageModel(params: ImageGenParams, preferGrok: boolean): SelectedModel {
	const explicitModel = normalizeOptionalString(params.model);
	const notes: string[] = [];
	let effectiveModel: string;

	if (explicitModel) {
		effectiveModel = explicitModel;
	} else if (preferGrok) {
		if (params.background === "transparent") {
			throw new Error(
				"Grok Imagine does not support background=transparent. Set model=gpt-image-1.5 (or another GPT Image model) for transparent cutouts.",
			);
		}
		effectiveModel = params.quality === "high" ? DEFAULT_GROK_QUALITY_MODEL : DEFAULT_GROK_IMAGE_MODEL;
		notes.push(`Auto-routed to ${effectiveModel} via Grok Imagine.`);
	} else if (params.background === "transparent") {
		effectiveModel = TRANSPARENT_IMAGE_MODEL;
		notes.push(`Auto-routed transparent request to ${TRANSPARENT_IMAGE_MODEL}.`);
	} else {
		effectiveModel = DEFAULT_IMAGE_MODEL;
	}

	if (isGrokImagineModel(effectiveModel)) {
		if (params.background === "transparent") {
			throw new Error("Grok Imagine does not support background=transparent. Use gpt-image-1.5 instead.");
		}
		if (params.input_fidelity) {
			notes.push("input_fidelity is ignored for Grok Imagine.");
		}
	} else {
		if (params.background === "transparent" && isGptImage2Model(effectiveModel)) {
			throw new Error(
				"gpt-image-2 does not support background=transparent. Omit `model` to let image_gen auto-route to gpt-image-1.5, or choose gpt-image-1.5 explicitly.",
			);
		}

		if (params.input_fidelity && isGptImage2Model(effectiveModel)) {
			throw new Error(
				"input_fidelity is not supported for gpt-image-2. Remove input_fidelity or choose a model that supports it.",
			);
		}
	}

	return {
		explicitModel,
		effectiveModel,
		notes,
	};
}

async function removeChromaKeyWithPython(pi: ExtensionAPI, images: SavedImage[]): Promise<void> {
	const script = String.raw`from PIL import Image
import sys

paths = sys.argv[1:]
tol = 20
for path in paths:
    image = Image.open(path).convert("RGBA")
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if abs(r - 0) <= tol and abs(g - 255) <= tol and abs(b - 0) <= tol:
                pixels[x, y] = (0, 0, 0, 0)
    image.save(path)
`;
	const result = await pi.exec("python3", ["-c", script, ...images.map((image) => image.path)]);
	if (result.code !== 0) {
		throw new Error(result.stderr || result.stdout || "Failed to remove chroma key from transparent fallback image.");
	}
}

function buildImagesModel(auth: OpenAIRequestAuth, modelId: string): OpenAIImagesModel {
	return {
		id: modelId,
		name: modelId,
		api: OPENAI_IMAGES_API,
		provider: auth.providerModel.provider,
		baseUrl: auth.baseUrl,
		headers: auth.headers,
		input: ["text", "image"],
		output: ["image", "text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		responseModelId: auth.providerModel.id,
		responseApi: auth.providerModel.api,
	};
}

async function readWorkspaceImage(cwd: string, rawPath: string, source: ResolvedImageInput["source"], label: string): Promise<ResolvedImageInput> {
	const normalizedPath = stripLeadingAt(rawPath.trim());
	const absolutePath = isAbsolute(normalizedPath) ? normalizedPath : resolve(cwd, normalizedPath);
	await access(absolutePath, fsConstants.R_OK);
	const bytes = await readFile(absolutePath);
	const mimeType = pathToMimeType(absolutePath);

	return {
		source,
		label,
		mimeType,
		data: bytes.toString("base64"),
		hash: shortHashFromBytes(bytes),
		path: absolutePath,
		displayPath: normalizeDisplayPath(cwd, absolutePath),
	};
}

function findRecentAttachedImages(ctx: ExtensionContext): ResolvedImageInput[] {
	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		if (entry.type !== "message" || entry.message.role !== "user" || !Array.isArray(entry.message.content)) {
			continue;
		}

		const images = entry.message.content.filter((item: { type?: string }) => item?.type === "image") as ImageContent[];
		if (images.length === 0) {
			continue;
		}

		return images.map((image, index) => ({
			source: "recent-attachment",
			label: `Attached image ${index + 1}`,
			mimeType: image.mimeType,
			data: image.data,
			hash: shortHashFromBase64(image.data),
		}));
	}

	return [];
}

async function resolveInputBundle(cwd: string, params: ImageGenParams, ctx: ExtensionContext): Promise<{
	images: ResolvedImageInput[];
	mask?: ResolvedImageInput;
	usedRecentAttachments: boolean;
}> {
	const explicitPaths = (params.image_paths ?? []).map((path) => normalizeOptionalString(path)).filter(Boolean) as string[];

	let images: ResolvedImageInput[] = [];
	let usedRecentAttachments = false;
	if (explicitPaths.length > 0) {
		images = await Promise.all(explicitPaths.map((path, index) => readWorkspaceImage(cwd, path, "path", `Image ${index + 1}`)));
	} else {
		images = findRecentAttachedImages(ctx);
		usedRecentAttachments = images.length > 0;
	}

	if (images.length > MAX_INPUT_IMAGES) {
		throw new Error(`image_gen supports at most ${MAX_INPUT_IMAGES} input images, received ${images.length}.`);
	}

	let mask: ResolvedImageInput | undefined;
	const maskPath = normalizeOptionalString(params.mask_path);
	if (maskPath) {
		mask = await readWorkspaceImage(cwd, maskPath, "mask", "Mask");
	}

	return { images, mask, usedRecentAttachments };
}

function resolveOutputDir(cwd: string, rawOutputDir: string | undefined): { absolutePath: string; displayPath: string } {
	const requested = normalizeOptionalString(rawOutputDir) ?? DEFAULT_OUTPUT_DIR;
	const stripped = stripLeadingAt(requested);
	const absolutePath = isAbsolute(stripped) ? stripped : resolve(cwd, stripped);
	return {
		absolutePath,
		displayPath: normalizeDisplayPath(cwd, absolutePath),
	};
}

async function saveGeneratedImages(
	cwd: string,
	images: AssistantImages,
	params: ImageGenParams,
	selectedModel: SelectedModel,
	outputDir: { absolutePath: string; displayPath: string },
	inputBundle: { images: ResolvedImageInput[]; mask?: ResolvedImageInput },
): Promise<SavedImage[]> {
	await mkdir(outputDir.absolutePath, { recursive: true });
	const imageBlocks = images.output.filter((item): item is ImageContent => item.type === "image");
	const filenamePrefix = normalizeOptionalString(params.filename_prefix) ?? slugify(params.prompt).slice(0, 48);
	const signature = buildRequestSignature({
		prompt: params.prompt,
		filenamePrefix,
		model: selectedModel.effectiveModel,
		action: params.action ?? "auto",
		background: params.background,
		size: params.size,
		quality: params.quality,
		n: params.n,
		output_format: params.output_format,
		output_compression: params.output_compression,
		input_fidelity: params.input_fidelity,
		images: inputBundle.images,
		mask: inputBundle.mask,
	});

	const savedImages: SavedImage[] = [];
	for (let index = 0; index < imageBlocks.length; index++) {
		const image = imageBlocks[index];
		const extension = mimeTypeToExtension(image.mimeType);
		const suffix = imageBlocks.length > 1 ? `-${index + 1}` : "";
		const fileName = `${slugify(filenamePrefix)}-${signature}${suffix}.${extension}`;
		const absolutePath = resolve(outputDir.absolutePath, fileName);
		const imageBuffer = Buffer.from(image.data, "base64");
		await writeFile(absolutePath, imageBuffer);
		savedImages.push({
			path: absolutePath,
			displayPath: normalizeDisplayPath(cwd, absolutePath),
			mimeType: image.mimeType,
			bytes: imageBuffer.length,
			content: image,
		});
	}

	return savedImages;
}

export default function imageGenExtension(pi: ExtensionAPI) {
	registerImagesApiProvider(
		{
			api: OPENAI_IMAGES_API,
			generateImages: generateImagesOpenAI,
		},
		"image-gen-extension",
	);

	pi.registerTool({
		name: "image_gen",
		label: "Image Gen",
		description:
			"Generate or edit raster images using OpenAI GPT Image or Grok Imagine models. Supports transparent backgrounds (GPT), reference-image edits, workspace image paths, attached image inputs, and saved outputs in the workspace.",
		promptSnippet:
			"Generate or edit raster image assets such as photos, illustrations, transparent cutouts, sprites, textures, and mockups.",
		promptGuidelines: [
			"Use image_gen when the user needs a raster image asset such as a photo, illustration, sprite, mockup, texture, or transparent-background cutout.",
			"Use image_gen instead of SVG/HTML/CSS placeholders when the requested deliverable should be a bitmap asset.",
			"Use image_gen with explicit image_paths for workspace files; if image_paths are omitted but the user recently attached images, image_gen can use those attachments as edit or reference inputs.",
			"Default image backend follows the current chat provider: internal-grok -> grok-imagine-image; otherwise GPT Image (gpt-image-2). Override with model=grok-imagine-image|grok-imagine-image-quality|gpt-image-2|gpt-image-1.5.",
			"When calling image_gen, omit redundant defaults unless the user explicitly asked for them: do not invent n=1, background=opaque, output_format=png, or action=generate if they are not needed.",
			"When calling image_gen, do not invent tiny thumbnail sizes such as 256x256 unless the user explicitly requested them. Omit size when unsure.",
		],
		parameters: IMAGE_GEN_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const prompt = params.prompt.trim();
			if (!prompt) {
				throw new Error("image_gen requires a non-empty prompt.");
			}

			const explicitModel = normalizeOptionalString(params.model);
			const preferGrok = explicitModel ? isGrokImagineModel(explicitModel) : isGrokProvider(ctx.model?.provider);
			const selectedModel = selectImageModel(params, preferGrok);
			const auth = await resolveOpenAIRequestAuth(ctx, selectedModel.effectiveModel);
			const inputBundle = await resolveInputBundle(ctx.cwd, params, ctx);
			const action = params.action ?? "auto";
			if (action === "edit" && inputBundle.images.length === 0) {
				throw new Error("image_gen action=edit requires at least one explicit image_path or a recent attached image.");
			}
			if (isGrokImagineModel(selectedModel.effectiveModel) && inputBundle.mask) {
				throw new Error("Grok Imagine does not support mask_path.");
			}

			const outputDir = resolveOutputDir(ctx.cwd, params.output_dir);
			const baseProviderOptions: OpenAIImagesOptions = {
				signal,
				apiKey: auth.apiKey,
				action,
				background: params.background,
				size: normalizeOptionalString(params.size),
				quality: params.quality,
				n: params.n,
				output_format: params.output_format,
				output_compression: params.output_compression,
				input_fidelity: normalizeOptionalString(params.input_fidelity),
				mask: inputBundle.mask ? createImageContent(inputBundle.mask) : undefined,
			};

			let effectiveModelId = selectedModel.effectiveModel;
			const effectiveNotes = [...selectedModel.notes];
			let requestPrompt = prompt;
			let assistantImages = await generateImages(
				buildImagesModel(auth, effectiveModelId),
				{
					input: [{ type: "text", text: requestPrompt }, ...inputBundle.images.map((image) => createImageContent(image))],
				},
				baseProviderOptions,
			);

			const canUseTransparentFallback =
				params.background === "transparent" &&
				!selectedModel.explicitModel &&
				selectedModel.effectiveModel === TRANSPARENT_IMAGE_MODEL &&
				auth.providerModel.api === "openai-responses" &&
				inputBundle.images.length === 0 &&
				!inputBundle.mask;
			if (assistantImages.stopReason !== "stop" && canUseTransparentFallback) {
				effectiveModelId = DEFAULT_IMAGE_MODEL;
				requestPrompt = buildTransparentFallbackPrompt(prompt);
				effectiveNotes.push(
					`Transparent request fell back to ${DEFAULT_IMAGE_MODEL} with a local chroma-key removal step because ${TRANSPARENT_IMAGE_MODEL} transparent providers were unavailable on the configured relay.`,
				);
				assistantImages = await generateImages(
					buildImagesModel(auth, effectiveModelId),
					{
						input: [{ type: "text", text: requestPrompt }],
					},
					{
						...baseProviderOptions,
						background: undefined,
						output_format: "png",
					},
				);
			}

			if (assistantImages.stopReason !== "stop") {
				throw new Error(assistantImages.errorMessage || `image_gen failed with stopReason=${assistantImages.stopReason}`);
			}

			const savedImages = await saveGeneratedImages(ctx.cwd, assistantImages, params, { ...selectedModel, effectiveModel: effectiveModelId }, outputDir, inputBundle);
			if (savedImages.length === 0) {
				throw new Error("image_gen completed without any image outputs.");
			}
			if (canUseTransparentFallback && effectiveModelId === DEFAULT_IMAGE_MODEL) {
				await removeChromaKeyWithPython(pi, savedImages);
			}

			const route: ImageGenDetails["route"] = inputBundle.images.length > 0 || inputBundle.mask ? "edits" : "generations";
			const backend: ImageGenDetails["backend"] =
				isGrokImagineModel(effectiveModelId) || auth.providerModel.api !== "openai-responses" ? "images" : "responses";
			const effectiveOutputFormat = mimeTypeToOutputFormat(savedImages[0].mimeType);
			const details: ImageGenDetails = {
				route,
				backend,
				responseId: assistantImages.responseId,
				requested: {
					action,
					background: params.background,
					size: normalizeOptionalString(params.size),
					quality: params.quality,
					n: params.n,
					output_format: params.output_format,
					output_compression: params.output_compression,
					input_fidelity: normalizeOptionalString(params.input_fidelity),
					model: normalizeOptionalString(params.model),
					output_dir: outputDir.displayPath,
					filename_prefix: normalizeOptionalString(params.filename_prefix),
				},
				effective: {
					model: effectiveModelId,
					background: params.background,
					size: normalizeOptionalString(params.size),
					quality: params.quality,
					n: params.n ?? 1,
					output_format: effectiveOutputFormat,
					output_compression: params.output_compression,
					usedRecentAttachments: inputBundle.usedRecentAttachments,
					notes: effectiveNotes,
				},
				outputs: savedImages.map((image) => ({
					path: image.path,
					displayPath: image.displayPath,
					mimeType: image.mimeType,
					bytes: image.bytes,
				})),
				inputImages: inputBundle.images.map((image) => ({
					source: image.source,
					label: image.label,
					mimeType: image.mimeType,
					path: image.path,
					displayPath: image.displayPath,
				})),
				mask: inputBundle.mask
					? {
						path: inputBundle.mask.path!,
						displayPath: inputBundle.mask.displayPath!,
						mimeType: inputBundle.mask.mimeType,
					}
					: undefined,
				providerModel: {
					provider: auth.providerModel.provider,
					id: auth.providerModel.id,
					baseUrl: auth.providerModel.baseUrl,
				},
			};

			const summaryText = buildTextSummaryLines(details).join("\n");
			return {
				content: [{ type: "text", text: summaryText }, ...savedImages.map((image) => image.content)],
				details,
			};
		},
	});
}
