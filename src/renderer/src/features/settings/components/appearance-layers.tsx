import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { definitionOf, themes } from "@shared/themes";
import type { ResolvedAppearance } from "@shared/themes/appearance";
import type { ThemePalette } from "@shared/themes/palette-contract";
import { useAuthoredPalette } from "@shared/themes/use-authored-palette";
import { useResolvedAppearance } from "@shared/themes/use-resolved-appearance";
import type { FC, ReactNode } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AccentRef } from "../../../../../shared/theme-engine/accent.mjs";
import type { PaletteRecord } from "../../../../../shared/theme-engine/accent.mjs";
import { contrastCandidate } from "../../../../../shared/theme-engine/contrast.mjs";
import {
	ACCENT_ROLES,
	PRESET_ORDER,
	PREVIEW_IDS,
	allAccents,
	curatedAccents,
	previewCss,
} from "../../../../../shared/theme-engine/picker.mjs";
import type { WindowGlassState } from "../../../../../shared/window-glass";
import { AccentRow } from "./accent-row";
import { previewGlassPaint } from "./appearance-preview-glass";
import { AppearancePreviewStrip } from "./appearance-preview-strip";
import { ContrastControl } from "./contrast-control";

/**
 * The three appearance layers above the theme gallery - preview strip, then
 * (after the gallery, which `ThemeSelector` renders) contrast and accent - wired
 * to the preferences store. Split into `AppearancePreviewSection` (top) and
 * `AppearanceLayerControls` (under the gallery) so the page keeps the designer's
 * reading order Theme -> Contrast -> Accent, which is also the composition order.
 *
 * LIVE-APPLY (designer 4.1): theme, contrast and accent apply to the whole app
 * immediately; undo is the control itself plus a per-layer reset. The one
 * exception is the slider DURING a drag, which previews in a scoped subtree and
 * commits on release - see `useContrastDraft`.
 */

/** The `<style>` the drag and chip previews are written into. */
const PREVIEW_STYLE_ID = "lo-appearance-preview";

/**
 * Upsert the scoped preview blocks. Pure CSS text from `previewCss`, which only
 * emits ids and values that pass the same grammar `applyAppearance` enforces.
 * Never touches `:root`'s `data-theme`.
 */
const writePreviewStyle = (css: string): void => {
	let style = document.getElementById(PREVIEW_STYLE_ID);
	if (!css) {
		style?.remove();
		return;
	}
	if (!style) {
		style = document.createElement("style");
		style.id = PREVIEW_STYLE_ID;
		document.head.appendChild(style);
	}
	if (style.textContent !== css) style.textContent = css;
};

/** The composed accent roles, carried over drag candidates. */
const accentOverlay = (resolved: ResolvedAppearance) => {
	if (resolved.identity) return null;
	const palette = resolved.palette as unknown as Record<string, string>;
	const out: Record<string, string> = {};
	for (const role of ACCENT_ROLES) out[role] = palette[role];
	return out;
};

/*
 * The draft is shared between the strip (top of the section) and the slider
 * (under the gallery) through a tiny module store rather than React context,
 * because the two halves render as siblings in `settings-page.tsx` with other
 * rows between them, and lifting state into the page would re-render the whole
 * settings page per pointer move.
 */
type DraftListener = (value: number | null) => void;
const draftListeners = new Set<DraftListener>();
let currentDraft: number | null = null;
const publishDraft = (value: number | null) => {
	currentDraft = value;
	for (const listener of draftListeners) listener(value);
};
const useDraft = (): number | null => {
	const [value, setValue] = useState<number | null>(currentDraft);
	useEffect(() => {
		draftListeners.add(setValue);
		return () => {
			draftListeners.delete(setValue);
		};
	}, []);
	return value;
};

/**
 * The scoped preview CSS for the active theme: one block per preset chip (each
 * chip's swatch shows THIS theme at THAT preset, as authored with the committed
 * accent laid over) and, during a drag, one for the strip at the draft value.
 *
 * Throttled to one write per animation frame: a pointer reports far more often
 * than the screen paints, and `contrastCandidate` (~1 ms) plus a style write is
 * the whole per-frame cost - no verified compose ever runs during a drag.
 */
const usePreviewStyle = (resolved: ResolvedAppearance) => {
	const draft = useDraft();
	const base = useAuthoredPalette().palette as PaletteRecord | undefined;
	const overlay = useMemo(() => accentOverlay(resolved), [resolved]);
	// Preset blocks do not depend on a moving thumb; compose them once per palette.
	const chipCss = useMemo(
		() =>
			base
				? previewCss(
						base,
						PRESET_ORDER.map(({ name, value }) => ({
							id: PREVIEW_IDS.chip(name),
							contrast: value,
						})),
						overlay,
					)
				: "",
		[base, overlay],
	);
	const frame = useRef<number | null>(null);
	useLayoutEffect(() => {
		if (!base) return;
		const write = () => {
			frame.current = null;
			const strip =
				currentDraft === null
					? ""
					: previewCss(
							base,
							[{ id: PREVIEW_IDS.strip, contrast: currentDraft }],
							overlay,
						);
			writePreviewStyle(chipCss + strip);
		};
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		/* The first write (mount, theme or accent change) is synchronous so the
		   chips never paint unscoped; drag updates ride the next frame. */
		if (draft === null) write();
		else frame.current = requestAnimationFrame(write);
	}, [base, overlay, draft, chipCss]);
	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			writePreviewStyle("");
		},
		[],
	);
	return draft;
};

/** [A] In-flow preview: gallery tiles must never scroll beneath the sample. */
export const AppearancePreviewSection: FC<{
	glass?: WindowGlassState | null;
}> = ({ glass }) => {
	const resolved = useResolvedAppearance();
	const draft = usePreviewStyle(resolved);
	const authored = useAuthoredPalette().palette;
	const paint = useMemo(() => {
		// Match previewCss's candidate and committed accent overlay, not the
		// document palette that intentionally stays verified during a drag.
		const palette =
			draft === null || !authored
				? resolved.palette
				: {
						...(draft === 0 ? authored : contrastCandidate(authored, draft)),
						...accentOverlay(resolved),
					};
		return previewGlassPaint(glass, palette as ThemePalette);
	}, [glass, resolved, authored, draft]);
	return (
		<div
			/* The section owns its divider in normal flow. Pinning this sample
			   occludes the first gallery row and steals narrow-window space. */
			className="border-hairline border-b pb-3"
		>
			<AppearancePreviewStrip
				glassPaint={paint}
				previewTheme={draft === null ? undefined : PREVIEW_IDS.strip}
			/>
		</div>
	);
};

/** A layer's heading row: `h3` on the left, an optional action on the right. */
const LayerHeading: FC<{ title: string; action?: ReactNode }> = ({
	title,
	action,
}) => (
	<div className="flex min-h-7 items-center justify-between gap-2 px-1 pb-2">
		<h3 className="text-meta text-ink-dim">{title}</h3>
		{action}
	</div>
);

/**
 * Commit a contrast value: persist it, and report "applying" until the provider
 * has composed it. The compose runs in the provider's render (it is pure and
 * memoised), so `pending` is shown for the frame between the store write and
 * the provider's commit; on a cache hit it never paints.
 */
const useContrastCommit = () => {
	const setContrast = useUiPreferencesStore((s) => s.setContrast);
	const [pending, setPending] = useState(false);
	const commit = useCallback(
		(mode: "dark" | "light", value: number) => {
			setPending(true);
			/*
			 * Let the "Applying contrast…" line and the released thumb paint
			 * BEFORE the synchronous compose blocks the thread (up to ~1 s cold
			 * at Soft); two frames, because the first rAF runs before that frame
			 * paints. The draft clears only after the store write, so the strip
			 * keeps showing the candidate - never the old composition - until the
			 * verified one replaces it.
			 */
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					setContrast(mode, value);
					publishDraft(null);
					setPending(false);
				}),
			);
		},
		[setContrast],
	);
	return { commit, pending };
};

/** [C] Contrast and [D] Accent, under the gallery. */
export const AppearanceLayerControls: FC = () => {
	useI18nLocale();
	const resolved = useResolvedAppearance();
	const themeName = useUiPreferencesStore((s) => s.themeName);
	const contrast = useUiPreferencesStore((s) => s.contrast);
	const accent = useUiPreferencesStore((s) => s.accent);
	const customAccents = useUiPreferencesStore((s) => s.customAccents);
	const customAccentNames = useUiPreferencesStore((s) => s.customAccentNames);
	const setAccent = useUiPreferencesStore((s) => s.setAccent);
	const addCustomAccent = useUiPreferencesStore((s) => s.addCustomAccent);
	const replaceCustomAccent = useUiPreferencesStore(
		(s) => s.replaceCustomAccent,
	);
	const renameCustomAccent = useUiPreferencesStore((s) => s.renameCustomAccent);
	const removeCustomAccent = useUiPreferencesStore((s) => s.removeCustomAccent);
	const { commit, pending } = useContrastCommit();

	const authored = useAuthoredPalette();
	const base = authored.palette;
	const mode = base?.mode ?? "dark";
	const committed = contrast[mode] ?? 0;
	const selected: AccentRef = accent[mode] ?? { kind: "theme" };

	const palettes = useMemo(
		() =>
			(Object.keys(themes) as Array<keyof typeof themes>)
				.map((id) => {
					const palette = definitionOf(id)?.palette;
					return palette
						? { id, palette: palette as unknown as PaletteRecord }
						: null;
				})
				.filter((p): p is { id: keyof typeof themes; palette: PaletteRecord } =>
					Boolean(p),
				),
		[],
	);
	const curated = useMemo(
		() => curatedAccents(palettes, mode, themeName),
		[palettes, mode, themeName],
	);
	const all = useMemo(() => allAccents(palettes, mode), [palettes, mode]);

	if (!base) return null;
	const themeLabel = authored.name;
	return (
		<div className="flex flex-col gap-6">
			<section data-appearance-layer="contrast">
				<ContrastControl
					committed={committed}
					effective={resolved.effectiveContrast}
					backgroundAtCeiling={
						mode === "light" &&
						committed > 0 &&
						resolved.palette.canvas.toUpperCase() === base.canvas.toUpperCase()
					}
					mode={mode}
					pending={pending}
					onDraft={publishDraft}
					onCommit={(value) => commit(mode, value)}
				/>
			</section>
			<section data-appearance-layer="accent">
				<LayerHeading
					title={t("ui.settings.appearance.accent.title")}
					action={
						selected.kind !== "theme" ? (
							<Button
								type="button"
								variant="link"
								size="sm"
								className="min-h-6 min-w-6"
								onClick={() => setAccent(mode, { kind: "theme" })}
							>
								{t("ui.settings.appearance.accent.reset")}
							</Button>
						) : null
					}
				/>
				<AccentRow
					themeName={themeLabel}
					themeAccent={base.accent}
					themeAccentAlt={base.accentAlt}
					curated={curated}
					all={all}
					paletteName={(id) => themes[id as keyof typeof themes]?.name ?? id}
					custom={customAccents}
					customNames={customAccentNames}
					selected={selected}
					paintedAccent={resolved.palette.accent}
					adjusted={resolved.accentAdjusted}
					applied={resolved.accentApplied}
					onSelect={(ref) => setAccent(mode, ref)}
					onAdd={(hex) => addCustomAccent(hex, mode)}
					onReplace={replaceCustomAccent}
					onRename={renameCustomAccent}
					onRemove={removeCustomAccent}
				/>
			</section>
		</div>
	);
};

/**
 * The reminder in the Theme header row while the user's own accent overrides the
 * theme's (designer 7.1): "Accent: #3B82F6 (yours) · Use theme accent". It says
 * why Dracula isn't purple and gives the one-click way back.
 */
export const AccentOverrideNotice: FC = () => {
	useI18nLocale();
	const themeName = useUiPreferencesStore((s) => s.themeName);
	const accent = useUiPreferencesStore((s) => s.accent);
	const names = useUiPreferencesStore((s) => s.customAccentNames);
	const setAccent = useUiPreferencesStore((s) => s.setAccent);
	const mode = definitionOf(themeName)?.palette.mode ?? "dark";
	const ref = accent[mode];
	const resolved = useResolvedAppearance();
	if (!ref || ref.kind === "theme" || ref.kind === "theme-alt") return null;
	return (
		<p className="flex flex-wrap items-center gap-1.5 text-meta text-ink-muted">
			<span
				aria-hidden="true"
				className="inline-block size-3 rounded-full border border-hairline"
				style={{ backgroundColor: resolved.palette.accent }}
			/>
			<span>
				{ref.kind === "custom"
					? t("ui.settings.appearance.accent.override_notice", {
							colour: names[ref.hex] ?? ref.hex,
						})
					: t("ui.settings.appearance.accent.palette_override_notice", {
							theme: themes[ref.id as keyof typeof themes]?.name ?? ref.id,
						})}
			</span>
			<span aria-hidden="true">·</span>
			<Button
				type="button"
				variant="link"
				size="sm"
				className="min-h-6 min-w-6"
				onClick={() => setAccent(mode, { kind: "theme" })}
			>
				{t("ui.settings.appearance.accent.use_theme_accent")}
			</Button>
		</p>
	);
};

/** The Theme layer's header row: heading plus the accent-override reminder. */
export const ThemeLayerHeading: FC = () => {
	useI18nLocale();
	return (
		<div className="flex flex-col gap-1">
			<h3 className="px-1 text-meta text-ink-dim">
				{t("ui.settings.appearance.layers.theme")}
			</h3>
			<div className="px-1">
				<AccentOverrideNotice />
			</div>
		</div>
	);
};

/**
 * The whole layered picker in the designer's order: preview strip, Theme
 * (gallery), Contrast, Accent. The settings page and the stories both render
 * this, so a frame is a picture of the shipped subtree.
 */
export const AppearanceLayers: FC<{
	gallery: ReactNode;
	glass?: WindowGlassState | null;
}> = ({ gallery, glass }) => (
	<div className="flex flex-col gap-6">
		<AppearancePreviewSection glass={glass} />
		<div className="flex flex-col gap-2">
			<ThemeLayerHeading />
			{gallery}
		</div>
		<AppearanceLayerControls />
	</div>
);
