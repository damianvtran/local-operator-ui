import { useResolvedAppearance } from "@shared/themes/use-resolved-appearance";
import type { Mermaid } from "mermaid";
import type { FC } from "react";
import { memo, useCallback } from "react";
import { DiagramErrorBoundary, DiagramViewer } from "./diagram-viewer";

/*
 * The mermaid theme, expressed in role variables.
 *
 * mermaid emits its colours into a `<style>` block inside the SVG it returns,
 * and that SVG is mounted inline in this document, so a value of
 * `var(--color-elevated)` resolves against the active `[data-theme]` exactly
 * like a role utility would. The diagram therefore repaints on a theme switch
 * with no React involvement — the same reasoning as
 * `shared/components/common/themed-toast-container.tsx`.
 *
 * Two things stop this being var() all the way down.
 *
 * 1. mermaid's `base` theme derives most of its palette with khroma
 *    (`darken`, `adjust`, `invert`), and khroma throws
 *    `Unsupported color format` on a `var()` string. A derivation is only
 *    skipped when the value it would compute is supplied, so every key whose
 *    default is computed is listed below.
 * 2. Five keys are fed to khroma *unconditionally* — by the theme
 *    (`cScale0..11`, `git0..7`, `quadrant1Fill`) or by a diagram's own
 *    stylesheet at render time (`fade(edgeLabelBackground)` in every
 *    flowchart, `fade(mainBkg | clusterBkg | clusterBorder)` in block
 *    diagrams, `fade(tertiaryColor)` in ER). Those cannot be `var()` at all,
 *    so they are seeded with the *resolved* value of a role read off the
 *    document, and mermaid derives its categorical scales from them.
 *
 * The seeds are resolved when `initialize()` runs, so they — and everything
 * mermaid derives from them — are frozen into whichever palette was active for
 * that call. The flowchart node fill is one of these, because flowchart-v2
 * paints it from `mainBkg`. That is why the singleton is re-initialised on a
 * theme change and every mounted diagram re-renders: the `var()` half of this
 * table repaints on its own, but the seeded half only moves when mermaid
 * recomputes the SVG.
 */
const ROLE_INK = "var(--color-ink)";
const ROLE_INK_MUTED = "var(--color-ink-muted)";
const ROLE_SURFACE = "var(--color-surface)";
const ROLE_ELEVATED = "var(--color-elevated)";
const ROLE_SUNKEN = "var(--color-sunken)";
const ROLE_HAIRLINE = "var(--color-hairline)";
const ROLE_CONTROL = "var(--color-control)";
const ROLE_ACCENT = "var(--color-accent)";
const ROLE_ACCENT_WASH = "var(--color-accent-wash)";
const ROLE_ACCENT_ALT_WASH = "var(--color-accent-alt-wash)";
const ROLE_ON_ACCENT = "var(--color-on-accent)";
const ROLE_INFO = "var(--color-info)";
const ROLE_INFO_WASH = "var(--color-info-wash)";
const ROLE_SUCCESS = "var(--color-success)";
const ROLE_SUCCESS_WASH = "var(--color-success-wash)";
const ROLE_WARNING = "var(--color-warning)";
const ROLE_WARNING_WASH = "var(--color-warning-wash)";
const ROLE_WARNING_BORDER = "var(--color-warning-border)";
const ROLE_DANGER = "var(--color-danger)";
const ROLE_DANGER_WASH = "var(--color-danger-wash)";

/**
 * Categorical fills cycle the decorative and semantic washes so labels stay `ink`
 * on them.
 *
 * The second accent sits at INDEX 1, ahead of the semantics, and that position is
 * the change: `fillType0..7` is this app's only categorical ramp (the journey and
 * radar diagram types are the ones that spend it — the flowchart, pie and
 * quadrant types derive their fills elsewhere), and until this entry existed
 * category 1 was painted `info` — the colour that everywhere else means "here is
 * a fact". A
 * diagram's second category is the one surface where a second decorative hue buys
 * something functional rather than aesthetic, which is why the role exists at all
 * (`palette-contract.ts`'s `accentAlt`).
 *
 * The fills are WASHES and the labels are `ink`, so no `onAccentAlt` is needed
 * and no category label sits on a solid decorative fill. The adjacency the ramp
 * creates is `accentWash` beside `accentAltWash`, and the contract asserts that
 * pair at the field floor (ΔE00 2.0); measured across all 59 palettes the
 * tightest is 2.05. Category 2 is `accentAltWash` beside `infoWash`, which is
 * also the pair a palette can make close: measured across the 59 the five
 * tightest are `catppuccinMocha` 2.93, `palenight` 3.38, `vaporwave` 3.56,
 * `radient` 3.81 and `obsidian` 4.24, and the tightest of those is also the one
 * palette whose second hue shares `info`'s family (`catppuccinMocha`, 2.68
 * degrees off it). It is not close today: 2.93 is above the 2.0 field floor, so
 * no palette needs the ramp reordered. That is worth re-measuring rather than
 * assuming if either family moves: this is the one surface where a decorative
 * hue and a semantic are read side by side.
 */
const WASH_CYCLE = [
	ROLE_ACCENT_WASH,
	ROLE_ACCENT_ALT_WASH,
	ROLE_INFO_WASH,
	ROLE_SUCCESS_WASH,
	ROLE_WARNING_WASH,
	ROLE_DANGER_WASH,
];

/** The substituted value of a role variable, or `""` when no theme is set. */
const resolveRole = (name: string): string =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const buildThemeVariables = (): Record<string, unknown> => {
	/*
	 * Seeds must be khroma-parseable, so they carry a resolved colour rather
	 * than a `var()`. A role that resolves to nothing (no `[data-theme]` yet)
	 * is dropped so mermaid falls back to its own default instead of being
	 * handed an empty string, which would throw for every diagram.
	 */
	const seeds: Record<string, string> = {
		primaryColor: resolveRole("--color-accent"),
		secondaryColor: resolveRole("--color-success"),
		tertiaryColor: resolveRole("--color-info"),
		mainBkg: resolveRole("--color-elevated"),
		clusterBkg: resolveRole("--color-sunken"),
		clusterBorder: resolveRole("--color-hairline"),
		edgeLabelBackground: resolveRole("--color-surface"),
		quadrant1Fill: resolveRole("--color-accent-wash"),
	};
	for (const [key, value] of Object.entries(seeds)) {
		if (value === "") delete seeds[key];
	}

	const variables: Record<string, unknown> = {
		// mermaid picks the direction of its own lightness maths from this.
		darkMode: getComputedStyle(document.documentElement).colorScheme.includes(
			"dark",
		),
		background: ROLE_SURFACE,
		primaryTextColor: ROLE_INK,
		primaryBorderColor: ROLE_CONTROL,
		secondaryTextColor: ROLE_INK,
		secondaryBorderColor: ROLE_HAIRLINE,
		tertiaryTextColor: ROLE_INK,
		tertiaryBorderColor: ROLE_HAIRLINE,
		lineColor: ROLE_INK_MUTED,
		arrowheadColor: ROLE_INK_MUTED,
		textColor: ROLE_INK,
		secondBkg: ROLE_SUNKEN,
		border1: ROLE_CONTROL,
		border2: ROLE_HAIRLINE,
		labelColor: ROLE_INK,
		// flowchart
		nodeBkg: ROLE_ELEVATED,
		nodeBorder: ROLE_CONTROL,
		nodeTextColor: ROLE_INK,
		defaultLinkColor: ROLE_INK_MUTED,
		titleColor: ROLE_INK,
		// notes read as the one "stuck on" surface in the system
		noteBkgColor: ROLE_WARNING_WASH,
		noteBorderColor: ROLE_WARNING_BORDER,
		noteTextColor: ROLE_INK,
		// sequence
		actorBkg: ROLE_ELEVATED,
		actorBorder: ROLE_CONTROL,
		actorTextColor: ROLE_INK,
		actorLineColor: ROLE_HAIRLINE,
		signalColor: ROLE_INK_MUTED,
		signalTextColor: ROLE_INK,
		labelBoxBkgColor: ROLE_ELEVATED,
		labelBoxBorderColor: ROLE_HAIRLINE,
		labelTextColor: ROLE_INK,
		loopTextColor: ROLE_INK,
		activationBkgColor: ROLE_ACCENT_WASH,
		activationBorderColor: ROLE_ACCENT,
		sequenceNumberColor: ROLE_SURFACE,
		// gantt
		sectionBkgColor: ROLE_SUNKEN,
		sectionBkgColor2: ROLE_SURFACE,
		altSectionBkgColor: ROLE_SUNKEN,
		excludeBkgColor: ROLE_SUNKEN,
		taskBkgColor: ROLE_ACCENT_WASH,
		taskBorderColor: ROLE_CONTROL,
		taskTextColor: ROLE_INK,
		taskTextLightColor: ROLE_INK,
		taskTextDarkColor: ROLE_INK,
		taskTextOutsideColor: ROLE_INK,
		taskTextClickableColor: ROLE_ACCENT,
		activeTaskBkgColor: ROLE_ACCENT_WASH,
		activeTaskBorderColor: ROLE_ACCENT,
		gridColor: ROLE_HAIRLINE,
		doneTaskBkgColor: ROLE_SUNKEN,
		doneTaskBorderColor: ROLE_HAIRLINE,
		critBkgColor: ROLE_DANGER_WASH,
		critBorderColor: ROLE_DANGER,
		todayLineColor: ROLE_ACCENT,
		// state
		transitionColor: ROLE_INK_MUTED,
		transitionLabelColor: ROLE_INK,
		stateLabelColor: ROLE_INK,
		stateBkg: ROLE_ELEVATED,
		labelBackgroundColor: ROLE_SURFACE,
		compositeBackground: ROLE_SUNKEN,
		altBackground: ROLE_SUNKEN,
		compositeTitleBackground: ROLE_ELEVATED,
		compositeBorder: ROLE_HAIRLINE,
		innerEndBackground: ROLE_INK,
		specialStateColor: ROLE_INK,
		// class and entity relationship
		classText: ROLE_INK,
		attributeBackgroundColorOdd: ROLE_SURFACE,
		attributeBackgroundColorEven: ROLE_SUNKEN,
		rowOdd: ROLE_SURFACE,
		rowEven: ROLE_SUNKEN,
		errorBkgColor: ROLE_DANGER_WASH,
		errorTextColor: ROLE_DANGER,
		// pie
		pieTitleTextColor: ROLE_INK,
		pieSectionTextColor: ROLE_INK,
		pieLegendTextColor: ROLE_INK,
		pieStrokeColor: ROLE_SURFACE,
		pieOuterStrokeColor: ROLE_HAIRLINE,
		// requirement
		requirementBackground: ROLE_ELEVATED,
		requirementBorderColor: ROLE_CONTROL,
		requirementTextColor: ROLE_INK,
		relationColor: ROLE_INK_MUTED,
		relationLabelBackground: ROLE_SURFACE,
		relationLabelColor: ROLE_INK,
		/*
		 * Branch chips and the mindmap root are filled with a git colour, which
		 * mermaid lightens in a dark theme and darkens in a light one — so their
		 * text is the role for "on a filled accent", not `ink`.
		 */
		branchLabelColor: ROLE_ON_ACCENT,
		commitLabelColor: ROLE_INK,
		commitLabelBackground: ROLE_SURFACE,
		tagLabelColor: ROLE_INK,
		tagLabelBackground: ROLE_ACCENT_WASH,
		tagLabelBorder: ROLE_CONTROL,
		// quadrant
		quadrant2Fill: ROLE_INFO_WASH,
		quadrant3Fill: ROLE_SUCCESS_WASH,
		quadrant4Fill: ROLE_WARNING_WASH,
		quadrant2TextFill: ROLE_INK,
		quadrant3TextFill: ROLE_INK,
		quadrant4TextFill: ROLE_INK,
		quadrantPointFill: ROLE_ACCENT,
		// architecture
		archEdgeColor: ROLE_INK_MUTED,
		archEdgeArrowColor: ROLE_INK_MUTED,
		archGroupBorderColor: ROLE_HAIRLINE,
		scaleLabelColor: ROLE_INK,
		packet: {
			startByteColor: ROLE_INK,
			endByteColor: ROLE_INK,
			labelColor: ROLE_INK,
			titleColor: ROLE_INK,
			blockStrokeColor: ROLE_CONTROL,
			blockFillColor: ROLE_ELEVATED,
		},
		/*
		 * `radar` and `xyChart` are replaced wholesale rather than merged, so
		 * the non-colour keys have to be restated at mermaid's own defaults.
		 */
		radar: {
			axisColor: ROLE_INK_MUTED,
			axisStrokeWidth: 2,
			axisLabelFontSize: 12,
			curveOpacity: 0.5,
			curveStrokeWidth: 2,
			graticuleColor: ROLE_HAIRLINE,
			graticuleStrokeWidth: 1,
			graticuleOpacity: 0.3,
			legendBoxSize: 12,
			legendFontSize: 12,
		},
		xyChart: {
			backgroundColor: ROLE_SURFACE,
			titleColor: ROLE_INK,
			xAxisTitleColor: ROLE_INK,
			xAxisLabelColor: ROLE_INK,
			xAxisTickColor: ROLE_HAIRLINE,
			xAxisLineColor: ROLE_HAIRLINE,
			yAxisTitleColor: ROLE_INK,
			yAxisLabelColor: ROLE_INK,
			yAxisTickColor: ROLE_HAIRLINE,
			yAxisLineColor: ROLE_HAIRLINE,
			plotColorPalette: [
				ROLE_ACCENT,
				ROLE_INFO,
				ROLE_SUCCESS,
				ROLE_WARNING,
				ROLE_DANGER,
			].join(","),
		},
	};

	// Mindmap and architecture surfaces, and the journey/section fills.
	for (let i = 0; i < 5; i++) {
		variables[`surface${i}`] = ROLE_ELEVATED;
		variables[`surfacePeer${i}`] = ROLE_HAIRLINE;
	}
	for (let i = 0; i < 8; i++) {
		variables[`fillType${i}`] = WASH_CYCLE[i % WASH_CYCLE.length];
	}

	return { ...variables, ...seeds };
};

// mermaid drags in cytoscape plus a per-diagram-type chunk for every syntax it
// supports (roughly 3.6 MB of JS). A static import puts all of it in the startup
// path even for sessions that never render a diagram, so the module is fetched
// on first use and the promise memoised at module scope.
let mermaidModulePromise: Promise<Mermaid> | null = null;

// The theme the singleton is currently configured for.
//
// initialize() is not per-render setup — mermaid is a singleton and this call
// used to sit inside renderDiagram, reconfiguring it for every diagram on every
// render. But it is not one-time setup either: buildThemeVariables() resolves
// its seed colours off the document, so a given config is only correct for the
// theme that was active when it ran. Keying it on the theme id re-themes
// diagrams on a switch while still importing the module exactly once.
let configuredThemeName: string | null = null;

const getMermaid = async (themeName: string): Promise<Mermaid> => {
	if (!mermaidModulePromise) {
		mermaidModulePromise = import("mermaid").then(
			({ default: mermaid }) => mermaid,
		);
	}
	const mermaid = await mermaidModulePromise;

	if (configuredThemeName !== themeName) {
		mermaid.initialize({
			startOnLoad: true,
			// `base` is the only built-in theme that takes an override table;
			// the rest hardcode a palette.
			theme: "base",
			securityLevel: "loose",
			fontFamily: "var(--font-sans)",
			fontSize: 14,
			// Prevents mermaid inserting global error elements into the DOM;
			// this component renders its own error state.
			suppressErrorRendering: true,
			themeVariables: buildThemeVariables(),
		});
		configuredThemeName = themeName;
	}

	return mermaid;
};

type MermaidDiagramProps = {
	chart: string;
	id?: string;
};

export const renderMermaidSvg = async (
	themeName: string,
	chart: string,
	id?: string,
): Promise<string> => {
	const mermaid = await getMermaid(themeName);
	const diagramId =
		id || `mermaid-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
	const { svg } = await mermaid.render(diagramId, chart);
	return svg;
};

/**
 * Mermaid diagram component with zoom, pan, save SVG, reset, fullscreen, and copy controls
 */
const MermaidDiagramCore: FC<MermaidDiagramProps> = memo(({ chart, id }) => {
	/* The seeded half of the mermaid palette is baked into the SVG at render
		   time, so a theme switch has to reach mermaid rather than just the
		   stylesheet. ThemeProvider publishes `data-theme` in a layout effect,
		   which runs before this component's passive effect, so the role variables
		   the new config resolves are already the new theme's. */
	/* Keyed on the PAINTED id - the built-in's, or `lo-<hash>` for a contrast
		   preset or custom accent - not on `themeName`: a contrast change keeps the
		   name and changes every colour, and a name key left the previous
		   composition's colours baked into the SVG. */
	const themeName = useResolvedAppearance().id;
	const renderSvg = useCallback(
		(source: string, diagramId?: string) =>
			renderMermaidSvg(themeName, source, diagramId),
		[themeName],
	);

	return (
		<DiagramViewer
			chart={chart}
			id={id}
			renderSvg={renderSvg}
			exportName="mermaid-diagram"
		/>
	);
});

export const MermaidDiagram: FC<MermaidDiagramProps> = memo((props) => (
	<DiagramErrorBoundary>
		<MermaidDiagramCore {...props} />
	</DiagramErrorBoundary>
));
