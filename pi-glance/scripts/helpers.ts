import { emptyGitSnapshot } from "../git.js";
import type { GlanceState } from "../types.js";

export function testState(overrides: Partial<GlanceState> = {}): GlanceState {
	const base: GlanceState = {
		workspace: { name: "repo", path: "/repo" },
		git: emptyGitSnapshot(),
		providers: { availableCount: 1 },
		model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking: "off" },
		plan: { enabled: false, executing: false, completed: 0, total: 0 },
		context: { tokens: 46_800, window: 200_000, percent: 23.4 },
		usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 },
		title: { text: null, generating: false },
		version: 0,
	};
	return {
		...base,
		...overrides,
		workspace: { ...base.workspace, ...overrides.workspace },
		git: { ...base.git, ...overrides.git },
		providers: { ...base.providers, ...overrides.providers },
		model: { ...base.model, ...overrides.model },
		plan: { ...base.plan, ...overrides.plan },
		context: { ...base.context, ...overrides.context },
		usage: { ...base.usage, ...overrides.usage },
		title: { ...base.title, ...overrides.title },
	};
}
