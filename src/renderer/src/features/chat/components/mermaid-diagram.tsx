import { BaseDialog } from "@shared/components/common/base-dialog";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	Copy as CopyIcon,
	Download,
	Maximize2,
	Move,
	RotateCcw,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import type { Mermaid } from "mermaid";
import type { FC, ReactNode } from "react";
import {
	Component,
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

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

/** Categorical fills cycle the semantic washes so labels stay `ink` on them. */
const WASH_CYCLE = [
	ROLE_ACCENT_WASH,
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

type ErrorBoundaryState = {
	hasError: boolean;
	error?: Error;
};

type ErrorBoundaryProps = {
	children: ReactNode;
	fallback?: ReactNode;
};

/**
 * Every control strip on a diagram: the same seven buttons over the inline
 * diagram and over the fullscreen one, differing only in the trailing button
 * (enter fullscreen vs. leave it) and in how much room they have.
 *
 * The strip floats over arbitrary diagram content rather than sitting on a
 * known ground, so it takes the system's one shadow on the `elevated` step —
 * the same case as a toast.
 */
type DiagramControlsProps = {
	className?: string;
	copied: boolean;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onReset: () => void;
	onSave: () => void;
	onCopy: () => void;
	/** The trailing button: enter fullscreen, or close it. */
	children: ReactNode;
};

const DiagramControls: FC<DiagramControlsProps> = ({
	className,
	copied,
	onZoomIn,
	onZoomOut,
	onReset,
	onSave,
	onCopy,
	children,
}) => (
	<div
		className={cn(
			"absolute z-10 flex items-center gap-0.5 rounded-md bg-elevated p-1 shadow-overlay",
			className,
		)}
	>
		<Tooltip content="Zoom in">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Zoom in"
				onClick={onZoomIn}
			>
				<ZoomIn />
			</Button>
		</Tooltip>

		<Tooltip content="Zoom out">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Zoom out"
				onClick={onZoomOut}
			>
				<ZoomOut />
			</Button>
		</Tooltip>

		<Tooltip content="Drag the diagram to pan">
			<Button variant="ghost" size="icon-sm" aria-label="Drag to pan">
				<Move />
			</Button>
		</Tooltip>

		<Tooltip content="Reset view">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Reset view"
				onClick={onReset}
			>
				<RotateCcw />
			</Button>
		</Tooltip>

		<Tooltip content="Save as SVG">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Save as SVG"
				onClick={onSave}
			>
				<Download />
			</Button>
		</Tooltip>

		<Tooltip content={copied ? "Copied" : "Copy mermaid text"}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={copied ? "Copied" : "Copy mermaid text"}
				onClick={onCopy}
			>
				<CopyIcon className={cn(copied && "text-success")} />
			</Button>
		</Tooltip>

		{children}
	</div>
);

/**
 * The diagram error state, used for a mermaid parse failure, a failure inside
 * the render path, and by the error boundary.
 */
type DiagramErrorProps = {
	title: string;
	children: ReactNode;
};

const DiagramError: FC<DiagramErrorProps> = ({ title, children }) => (
	<Alert variant="danger" role="alert" className="my-4">
		<AlertTitle>{title}</AlertTitle>
		<AlertDescription>{children}</AlertDescription>
	</Alert>
);

/**
 * Error boundary to catch any rendering errors that escape the component's error handling
 */
class MermaidErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("Mermaid Error Boundary caught an error:", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback || (
					<DiagramError title="Mermaid diagram error">
						{this.state.error?.message ||
							"An unexpected error occurred while rendering the diagram"}{" "}
						The error was contained within the diagram component.
					</DiagramError>
				)
			);
		}

		return this.props.children;
	}
}

/**
 * Enhanced Mermaid diagram component with zoom, pan, save SVG, reset, fullscreen, and copy controls
 */
const MermaidDiagramCore: FC<MermaidDiagramProps> = memo(({ chart, id }) => {
	const elementRef = useRef<HTMLDivElement>(null);
	const fullscreenElementRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [svgContent, setSvgContent] = useState<string>("");
	const [isFullscreen, setIsFullscreen] = useState(false);

	// Transform state for zoom and pan
	const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
	const [fullscreenTransform, setFullscreenTransform] = useState({
		scale: 1,
		x: 0,
		y: 0,
	});
	const [isPanning, setIsPanning] = useState(false);
	const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });

	const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
	const [fullscreenCopyStatus, setFullscreenCopyStatus] = useState<
		"idle" | "copied"
	>("idle");

	/* The seeded half of the mermaid palette is baked into the SVG at render
	   time, so a theme switch has to reach mermaid rather than just the
	   stylesheet. ThemeProvider publishes `data-theme` in a layout effect,
	   which runs before this component's passive effect, so the role variables
	   the new config resolves are already the new theme's. */
	const themeName = useUiPreferencesStore((state) => state.themeName);

	const renderDiagram = useCallback(async () => {
		try {
			setIsLoading(true);
			setError(null);
			setSvgContent("");

			// Validate chart content before rendering
			if (!chart || typeof chart !== "string" || chart.trim().length === 0) {
				throw new Error("Invalid or empty chart content");
			}

			const mermaid = await getMermaid(themeName);

			// Generate unique ID for the diagram
			const diagramId =
				id || `mermaid-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

			// Render the diagram
			const { svg } = await mermaid.render(diagramId, chart);

			// Validate the SVG output
			if (!svg || typeof svg !== "string" || svg.trim().length === 0) {
				throw new Error("Mermaid failed to generate valid SVG output");
			}

			setSvgContent(svg);
		} catch (err) {
			console.error("Mermaid rendering error:", err);
			const errorMessage =
				err instanceof Error ? err.message : "Failed to render mermaid diagram";
			setError(errorMessage);
			setSvgContent(""); // Ensure SVG content is cleared on error
		} finally {
			setIsLoading(false);
		}
	}, [chart, id, themeName]);

	useEffect(() => {
		// Wrap the async call in a try-catch to prevent unhandled promise rejections
		renderDiagram().catch((err) => {
			console.error("Error in renderDiagram effect:", err);
			setError("Failed to initialize diagram rendering");
			setIsLoading(false);
		});
	}, [renderDiagram]);

	// Calculate initial scale for fullscreen mode to fit the diagram properly
	const calculateInitialFullscreenScale = useCallback(() => {
		try {
			if (!svgContent || !fullscreenElementRef.current) return 1;

			const container = fullscreenElementRef.current;
			const containerRect = container.getBoundingClientRect();
			const tempDiv = document.createElement("div");
			tempDiv.innerHTML = svgContent;
			const svgElement = tempDiv.querySelector("svg");

			if (!svgElement) return 1;

			const svgWidth =
				svgElement.getBoundingClientRect?.()?.width ||
				Number.parseFloat(svgElement.getAttribute("width") || "0") ||
				svgElement.viewBox?.baseVal?.width ||
				800;
			const svgHeight =
				svgElement.getBoundingClientRect?.()?.height ||
				Number.parseFloat(svgElement.getAttribute("height") || "0") ||
				svgElement.viewBox?.baseVal?.height ||
				600;

			const scaleX = (containerRect.width * 0.9) / svgWidth;
			const scaleY = (containerRect.height * 0.9) / svgHeight;

			return Math.min(scaleX, scaleY, 1); // Don't scale up beyond original size
		} catch (err) {
			console.error("Error calculating fullscreen scale:", err);
			return 1;
		}
	}, [svgContent]);

	// Reset fullscreen transform when entering fullscreen
	useEffect(() => {
		if (isFullscreen && svgContent) {
			// Small delay to ensure the container is rendered
			setTimeout(() => {
				try {
					const initialScale = calculateInitialFullscreenScale();
					setFullscreenTransform({ scale: initialScale, x: 0, y: 0 });
				} catch (err) {
					console.error("Error setting fullscreen transform:", err);
				}
			}, 100);
		}
	}, [isFullscreen, svgContent, calculateInitialFullscreenScale]);

	const handleZoomIn = useCallback((isFullscreenMode = false) => {
		try {
			const setTransformState = isFullscreenMode
				? setFullscreenTransform
				: setTransform;
			setTransformState((prev) => ({
				...prev,
				scale: Math.min(prev.scale * 1.2, 10),
			}));
		} catch (err) {
			console.error("Error in zoom in:", err);
		}
	}, []);

	const handleZoomOut = useCallback((isFullscreenMode = false) => {
		try {
			const setTransformState = isFullscreenMode
				? setFullscreenTransform
				: setTransform;
			setTransformState((prev) => ({
				...prev,
				scale: Math.max(prev.scale / 1.2, 0.1),
			}));
		} catch (err) {
			console.error("Error in zoom out:", err);
		}
	}, []);

	const handleReset = useCallback(
		(isFullscreenMode = false) => {
			try {
				const setTransformState = isFullscreenMode
					? setFullscreenTransform
					: setTransform;

				if (isFullscreenMode) {
					const initialScale = calculateInitialFullscreenScale();
					setTransformState({ scale: initialScale, x: 0, y: 0 });
				} else {
					setTransformState({ scale: 1, x: 0, y: 0 });
				}
			} catch (err) {
				console.error("Error in reset:", err);
			}
		},
		[calculateInitialFullscreenScale],
	);

	const handleSaveSVG = useCallback(() => {
		if (!svgContent) return;

		try {
			const blob = new Blob([svgContent], { type: "image/svg+xml" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `mermaid-diagram-${Date.now()}.svg`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error("Failed to save SVG:", err);
		}
	}, [svgContent]);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(chart);
			setCopyStatus("copied");
			setTimeout(() => setCopyStatus("idle"), 1200);
		} catch (err) {
			console.error("Failed to copy Mermaid chart text:", err);
		}
	}, [chart]);

	const handleFullscreenCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(chart);
			setFullscreenCopyStatus("copied");
			setTimeout(() => setFullscreenCopyStatus("idle"), 1200);
		} catch (err) {
			console.error("Failed to copy Mermaid chart text:", err);
		}
	}, [chart]);

	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		try {
			setIsPanning(true);
			setLastPanPoint({ x: e.clientX, y: e.clientY });
			e.preventDefault();
		} catch (err) {
			console.error("Error in mouse down:", err);
		}
	}, []);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent, isFullscreenMode = false) => {
			try {
				if (!isPanning) return;

				const deltaX = e.clientX - lastPanPoint.x;
				const deltaY = e.clientY - lastPanPoint.y;

				const setTransformState = isFullscreenMode
					? setFullscreenTransform
					: setTransform;
				setTransformState((prev) => ({
					...prev,
					x: prev.x + deltaX,
					y: prev.y + deltaY,
				}));

				setLastPanPoint({ x: e.clientX, y: e.clientY });
			} catch (err) {
				console.error("Error in mouse move:", err);
			}
		},
		[isPanning, lastPanPoint],
	);

	const handleMouseUp = useCallback(() => {
		try {
			setIsPanning(false);
		} catch (err) {
			console.error("Error in mouse up:", err);
		}
	}, []);

	const handleWheel = useCallback(
		(e: React.WheelEvent, isFullscreenMode = false) => {
			try {
				e.preventDefault();
				const delta = e.deltaY > 0 ? 0.9 : 1.1;
				const setTransformState = isFullscreenMode
					? setFullscreenTransform
					: setTransform;

				setTransformState((prev) => ({
					...prev,
					scale: Math.min(Math.max(prev.scale * delta, 0.1), 5), // Increased max zoom to 5x
				}));
			} catch (err) {
				console.error("Error in wheel:", err);
			}
		},
		[],
	);

	const handleFullscreenToggle = useCallback((open: boolean) => {
		try {
			setIsFullscreen(open);
		} catch (err) {
			console.error("Error toggling fullscreen:", err);
		}
	}, []);

	if (error) {
		return (
			<DiagramError title="Mermaid diagram error">
				{error}
				<span className={cn("mt-2 block text-ink-muted")}>Chart</span>
				<span
					className={cn(
						"mt-1 block whitespace-pre-wrap font-mono text-mono-sm",
					)}
				>
					{chart}
				</span>
			</DiagramError>
		);
	}

	const renderDiagramContent = (isFullscreenMode = false) => {
		try {
			const containerRef = isFullscreenMode ? fullscreenElementRef : elementRef;
			const currentTransformState = isFullscreenMode
				? fullscreenTransform
				: transform;

			return (
				<div
					ref={containerRef}
					/*
					 * The `mermaid` class is what the SVG sizing rules on the two
					 * containers hang off; the cursor is driven by React state
					 * rather than by a `panning` class so there is one source of
					 * truth for it.
					 */
					className={cn(
						"mermaid flex w-full items-center justify-center",
						isFullscreenMode ? "h-full min-h-full" : "h-auto min-h-50",
						isPanning ? "cursor-grabbing" : "cursor-grab",
					)}
					onMouseDown={handleMouseDown}
					onMouseMove={(e) => handleMouseMove(e, isFullscreenMode)}
					onMouseUp={handleMouseUp}
					onMouseLeave={handleMouseUp}
					onWheel={(e) => handleWheel(e, isFullscreenMode)}
				>
					{isLoading ? (
						<div className={cn("p-4 text-body-sm text-ink-muted")}>
							Loading diagram...
						</div>
					) : svgContent ? (
						<div
							className={cn("flex h-full w-full items-center justify-center")}
							style={{
								transform: `translate(${currentTransformState.x}px, ${currentTransformState.y}px) scale(${currentTransformState.scale})`,
								transformOrigin: "center center",
							}}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG content from mermaid library is safe
							dangerouslySetInnerHTML={{ __html: svgContent }}
						/>
					) : null}
				</div>
			);
		} catch (err) {
			console.error("Error rendering diagram content:", err);
			return (
				<DiagramError title="Rendering error">
					Failed to render diagram content.
				</DiagramError>
			);
		}
	};

	return (
		<>
			<div
				className={cn(
					"relative flex items-center justify-center overflow-hidden rounded-md bg-surface",
					"[&_svg]:h-auto [&_svg]:min-h-100 [&_svg]:max-w-none [&_svg]:bg-transparent",
				)}
			>
				{renderDiagramContent(false)}

				<DiagramControls
					className="top-2 right-2"
					copied={copyStatus === "copied"}
					onZoomIn={() => handleZoomIn(false)}
					onZoomOut={() => handleZoomOut(false)}
					onReset={() => handleReset(false)}
					onSave={handleSaveSVG}
					onCopy={handleCopy}
				>
					<Tooltip content="Fullscreen">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Open diagram fullscreen"
							onClick={() => handleFullscreenToggle(true)}
						>
							<Maximize2 />
						</Button>
					</Tooltip>
				</DiagramControls>
			</div>

			<BaseDialog
				open={isFullscreen}
				onClose={() => handleFullscreenToggle(false)}
				title="Mermaid diagram"
				maxWidth="xl"
				fullWidth
				dialogProps={{ className: "h-[90vh] max-h-[90vh]" }}
			>
				<div
					className={cn(
						"relative flex h-[80vh] w-full items-center justify-center overflow-hidden",
						"[&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full [&_svg]:bg-transparent",
					)}
				>
					{renderDiagramContent(true)}

					<DiagramControls
						className="top-4 right-4"
						copied={fullscreenCopyStatus === "copied"}
						onZoomIn={() => handleZoomIn(true)}
						onZoomOut={() => handleZoomOut(true)}
						onReset={() => handleReset(true)}
						onSave={handleSaveSVG}
						onCopy={handleFullscreenCopy}
					>
						<Tooltip content="Close fullscreen">
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Close fullscreen"
								onClick={() => handleFullscreenToggle(false)}
							>
								<X />
							</Button>
						</Tooltip>
					</DiagramControls>
				</div>
			</BaseDialog>
		</>
	);
});

/**
 * Mermaid diagram component wrapped with error boundary for maximum error containment
 */
export const MermaidDiagram: FC<MermaidDiagramProps> = memo((props) => {
	return (
		<MermaidErrorBoundary>
			<MermaidDiagramCore {...props} />
		</MermaidErrorBoundary>
	);
});
