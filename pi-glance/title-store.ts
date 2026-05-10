import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export const TITLE_STORE_PATH = join(getAgentDir(), "pi-glance", "title.json");

export interface StoredTitle {
	text: string;
	source?: "fallback" | "llm";
	prompt?: string;
	model?: string;
	updatedAt?: string;
}

interface TitleStore {
	version: 1;
	sessions: Record<string, StoredTitle>;
}

function emptyStore(): TitleStore {
	return { version: 1, sessions: {} };
}

function parseSource(value: unknown): StoredTitle["source"] {
	return value === "fallback" || value === "llm" ? value : undefined;
}

function normalizeTitle(value: unknown): StoredTitle | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.text !== "string" || !record.text.trim()) return undefined;
	const title: StoredTitle = { text: record.text.trim() };
	const source = parseSource(record.source);
	if (source) title.source = source;
	if (typeof record.prompt === "string") title.prompt = record.prompt;
	if (typeof record.model === "string") title.model = record.model;
	if (typeof record.updatedAt === "string") title.updatedAt = record.updatedAt;
	return title;
}

function normalizeStore(raw: unknown): TitleStore {
	if (!raw || typeof raw !== "object") return emptyStore();
	const record = raw as Record<string, unknown>;
	const sessions = record.sessions && typeof record.sessions === "object" ? (record.sessions as Record<string, unknown>) : {};
	const normalized = emptyStore();
	for (const [key, value] of Object.entries(sessions)) {
		const title = normalizeTitle(value);
		if (title) normalized.sessions[key] = title;
	}
	return normalized;
}

async function readStore(path = TITLE_STORE_PATH): Promise<TitleStore> {
	try {
		return normalizeStore(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return emptyStore();
	}
}

export async function loadStoredTitle(sessionKey: string, path = TITLE_STORE_PATH): Promise<StoredTitle | undefined> {
	if (!sessionKey) return undefined;
	const store = await readStore(path);
	return store.sessions[sessionKey];
}

export async function saveStoredTitle(sessionKey: string, title: StoredTitle, path = TITLE_STORE_PATH): Promise<void> {
	if (!sessionKey) return;
	const store = await readStore(path);
	store.sessions[sessionKey] = {
		...title,
		text: title.text.trim(),
		updatedAt: title.updatedAt ?? new Date().toISOString(),
	};
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(store, null, "\t")}\n`, "utf8");
}