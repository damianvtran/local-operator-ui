import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useMemo } from "react";
import { type ResolvedAppearance, resolveAppearance } from "./appearance";

/**
 * The composition the document is painting, for components that need a FACT
 * about it rather than its colours (colours come from `var(--color-*)` and need
 * nothing): CodeMirror's dark flag, Mermaid's config cache key.
 *
 * WHY NOT `getTheme(themeName)`. With contrast and accent layers the painted
 * palette is `compose(themeName, contrast[mode], accent[mode])`, and its id is
 * `lo-<hash>` - a reader keyed on the name alone misses every layer change
 * (Mermaid kept the previous composition's colours baked into its SVG). This
 * subscribes to all three fields and resolves through the same cache the
 * provider fills, so it is a cache hit, never a second compose.
 *
 * Selected field by field (not one object selector) so a write to any other
 * preference does not re-render the caller.
 */
export const useResolvedAppearance = (): ResolvedAppearance => {
	const themeName = useUiPreferencesStore((s) => s.themeName);
	const contrast = useUiPreferencesStore((s) => s.contrast);
	const accent = useUiPreferencesStore((s) => s.accent);
	return useMemo(
		() => resolveAppearance({ themeName, contrast, accent }),
		[themeName, contrast, accent],
	);
};

/** True when the painted palette is a dark one. */
export const useAppearanceIsDark = (): boolean =>
	useResolvedAppearance().palette.mode === "dark";
