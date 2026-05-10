/**
 * Path Autocomplete Normalizer Extension
 *
 * Works around pi path autocomplete suggestions that include repeated `/./` segments
 * when `fd --base-directory` returns paths such as `./B/` for nested @ completions.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

function normalizePathSegments(value: string): string {
	// Keep user-authored leading relative paths like `./foo`, but remove internal
	// current-directory segments introduced by completion, e.g. `A/./B` -> `A/B`.
	return value.replace(/[/\\]\.(?=[/\\])/g, "");
}

function looksPathLike(prefix: string, item: AutocompleteItem): boolean {
	return (
		prefix.startsWith("@") ||
		prefix.startsWith('"') ||
		prefix.startsWith('@"') ||
		prefix.includes("/") ||
		prefix.includes("\\") ||
		item.value.includes("/") ||
		item.value.includes("\\") ||
		item.label.endsWith("/") ||
		item.label.endsWith("\\")
	);
}

function normalizeItem(item: AutocompleteItem, prefix: string): AutocompleteItem {
	if (!looksPathLike(prefix, item)) return item;

	const value = normalizePathSegments(item.value);
	const description = item.description ? normalizePathSegments(item.description) : item.description;

	if (value === item.value && description === item.description) return item;
	return { ...item, value, description };
}

function createPathAutocompleteNormalizer(current: AutocompleteProvider): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			if (!suggestions) return suggestions;

			return {
				...suggestions,
				items: suggestions.items.map((item) => normalizeItem(item, suggestions.prefix)),
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, normalizeItem(item, prefix), prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider(createPathAutocompleteNormalizer);
	});
}
