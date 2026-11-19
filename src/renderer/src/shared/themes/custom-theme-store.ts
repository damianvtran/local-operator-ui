import { useSyncExternalStore } from "react";
import {
	CUSTOM_THEMES_LIMIT,
	CUSTOM_THEMES_STORAGE_KEY,
	type CustomThemeV1,
	sanitizeCustomThemeId,
} from "../../../../shared/theme-engine/appearance.mjs";
import {
	deriveCustomPalette,
	exportCustomTheme,
	parseThemeImport,
	readCustomThemeStorage,
	validateCustomPalette,
} from "../../../../shared/theme-engine/custom.mjs";
import { definitionOf, isThemeName } from "./index";

/** Separate from the hot preferences blob: a sidebar resize must not rewrite
 * every theme, and a corrupt theme must not destroy unrelated preferences.
 * Publishing follows a successful storage write, so quota errors keep drafts.
 */
type Snapshot = { themes: CustomThemeV1[]; error: boolean; loading: boolean };
let snapshot: Snapshot = { themes: [], error: false, loading: false };
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};
export const customThemeSnapshot = () => snapshot;
export const subscribeCustomThemes = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
export const reloadCustomThemes = () => {
	try {
		const themes = readCustomThemeStorage(
			localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY),
			isThemeName,
		).filter((theme) => {
			const base = definitionOf(theme.base)?.palette;
			return (
				base &&
				validateCustomPalette(deriveCustomPalette(base, theme), theme.base)
					.length === 0
			);
		});
		snapshot = { themes, error: false, loading: false };
	} catch {
		snapshot = { themes: [], error: true, loading: false };
	}
	emit();
};
export const useCustomThemes = () =>
	useSyncExternalStore(
		subscribeCustomThemes,
		customThemeSnapshot,
		customThemeSnapshot,
	);
export const findCustomTheme = (id?: string | null) =>
	snapshot.themes.find((theme) => theme.id === id);
const persist = (themes: CustomThemeV1[]) => {
	localStorage.setItem(
		CUSTOM_THEMES_STORAGE_KEY,
		JSON.stringify({ version: 1, themes }),
	);
	snapshot = { themes, error: false, loading: false };
	emit();
};
export const saveCustomTheme = (input: CustomThemeV1) => {
	const id = sanitizeCustomThemeId(input.id);
	if (!id) throw new Error("invalid custom theme id");
	const theme = parseThemeImport(exportCustomTheme(input), isThemeName, {
		id,
		now: input.updatedAt,
	});
	const base = definitionOf(theme.base)?.palette;
	if (
		!base ||
		validateCustomPalette(deriveCustomPalette(base, theme), theme.base).length
	)
		throw new Error("contrast");
	if (
		!findCustomTheme(theme.id) &&
		snapshot.themes.length >= CUSTOM_THEMES_LIMIT
	)
		throw new Error("limit");
	persist([theme, ...snapshot.themes.filter((item) => item.id !== theme.id)]);
};
export const deleteCustomTheme = (id: string) =>
	persist(snapshot.themes.filter((theme) => theme.id !== id));
if (typeof window !== "undefined") {
	reloadCustomThemes();
	window.addEventListener("storage", (event) => {
		if (event.key === CUSTOM_THEMES_STORAGE_KEY || event.key === null)
			reloadCustomThemes();
	});
}
