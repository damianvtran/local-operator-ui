import { BaseDialog } from "@shared/components/common/base-dialog";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Tooltip,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
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
import type { CSSProperties, FC, ReactNode } from "react";
import {
	Component,
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

export type DiagramRenderer = (chart: string, id?: string) => Promise<string>;

export type DiagramViewerProps = {
	chart: string;
	id?: string;
	renderSvg: DiagramRenderer;
	exportName: string;
	diagramStyle?: CSSProperties;
	inlineSvgClassName?: string;
	prepareExport?: (svg: string) => string;
};

const DEFAULT_INLINE_SVG_CLASS = "[&_svg]:h-auto [&_svg]:min-h-100";

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
		data-lo-floating=""
		className={cn(
			"absolute z-10 flex items-center gap-0.5 rounded-md bg-elevated p-1 shadow-overlay",
			className,
		)}
	>
		<Tooltip content={t("ui.chat.mermaid.zoom_in")}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("ui.chat.mermaid.zoom_in")}
				onClick={onZoomIn}
			>
				<ZoomIn />
			</Button>
		</Tooltip>

		<Tooltip content={t("ui.chat.mermaid.zoom_out")}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("ui.chat.mermaid.zoom_out")}
				onClick={onZoomOut}
			>
				<ZoomOut />
			</Button>
		</Tooltip>

		<Tooltip content={t("ui.chat.mermaid.pan_hint")}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("ui.chat.mermaid.pan")}
			>
				<Move />
			</Button>
		</Tooltip>

		<Tooltip content={t("ui.chat.mermaid.reset_view")}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("ui.chat.mermaid.reset_view")}
				onClick={onReset}
			>
				<RotateCcw />
			</Button>
		</Tooltip>

		<Tooltip content={t("ui.chat.mermaid.save_svg")}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("ui.chat.mermaid.save_svg")}
				onClick={onSave}
			>
				<Download />
			</Button>
		</Tooltip>

		<Tooltip
			content={
				copied ? t("ui.chat.mermaid.copied") : t("ui.chat.mermaid.copy_text")
			}
		>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={
					copied ? t("ui.chat.mermaid.copied") : t("ui.chat.mermaid.copy_text")
				}
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

// The core (and its locale subscription) unmounts when the boundary catches.
// Translate in the surviving fallback leaf: getters in the class render do
// not invalidate already-produced JSX behind the outer memo.
const DiagramBoundaryFallback: FC<{ error?: Error }> = ({ error }) => {
	useI18nLocale();
	return (
		<DiagramError title={t("ui.chat.mermaid.error_title")}>
			{error?.message || t("ui.chat.mermaid.unexpected_error")}{" "}
			{t("ui.chat.mermaid.error_contained")}
		</DiagramError>
	);
};

/**
 * Error boundary to catch any rendering errors that escape the component's error handling
 */
class DiagramErrorBoundary extends Component<
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
		console.error("Diagram Error Boundary caught an error:", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback || (
					<DiagramBoundaryFallback error={this.state.error} />
				)
			);
		}

		return this.props.children;
	}
}

/**
 * Diagram viewer shared by the Mermaid and Pele renderers: zoom, pan, save SVG, reset, fullscreen and copy controls around an SVG that a renderer supplies
 */
const DiagramViewerCore: FC<DiagramViewerProps> = memo(
	({
		chart,
		id,
		renderSvg,
		exportName,
		diagramStyle,
		inlineSvgClassName = DEFAULT_INLINE_SVG_CLASS,
		prepareExport,
	}) => {
		// This subscription covers the live core; the boundary fallback owns its
		// own subscription because catching an error unmounts this component.
		useI18nLocale();
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

		const renderDiagram = useCallback(async () => {
			try {
				setIsLoading(true);
				setError(null);
				setSvgContent("");

				// Validate chart content before rendering
				if (!chart || typeof chart !== "string" || chart.trim().length === 0) {
					throw new Error("Invalid or empty chart content");
				}

				const svg = await renderSvg(chart, id);

				// Validate the SVG output
				if (!svg || typeof svg !== "string" || svg.trim().length === 0) {
					throw new Error("The renderer failed to generate valid SVG output");
				}

				setSvgContent(svg);
			} catch (err) {
				console.error("Diagram rendering error:", err);
				const errorMessage =
					err instanceof Error
						? err.message
						: "Failed to render mermaid diagram";
				setError(errorMessage);
				setSvgContent(""); // Ensure SVG content is cleared on error
			} finally {
				setIsLoading(false);
			}
		}, [chart, id, renderSvg]);

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
				const blob = new Blob(
					[prepareExport ? prepareExport(svgContent) : svgContent],
					{
						type: "image/svg+xml",
					},
				);
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = `${exportName}-${Date.now()}.svg`;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
			} catch (err) {
				console.error("Failed to save SVG:", err);
			}
		}, [svgContent, prepareExport, exportName]);

		const handleCopy = useCallback(async () => {
			try {
				await navigator.clipboard.writeText(chart);
				setCopyStatus("copied");
				setTimeout(() => setCopyStatus("idle"), 1200);
			} catch (err) {
				console.error("Failed to copy diagram chart text:", err);
			}
		}, [chart]);

		const handleFullscreenCopy = useCallback(async () => {
			try {
				await navigator.clipboard.writeText(chart);
				setFullscreenCopyStatus("copied");
				setTimeout(() => setFullscreenCopyStatus("idle"), 1200);
			} catch (err) {
				console.error("Failed to copy diagram chart text:", err);
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
				<DiagramError title={t("ui.chat.mermaid.error_title")}>
					{error}
					<span className={cn("mt-2 block text-ink-muted")}>
						{t("ui.chat.mermaid.chart_label")}
					</span>
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
				const containerRef = isFullscreenMode
					? fullscreenElementRef
					: elementRef;
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
						style={diagramStyle}
						onWheel={(e) => handleWheel(e, isFullscreenMode)}
					>
						{isLoading ? (
							<div className={cn("p-4 text-body-sm text-ink-muted")}>
								{t("ui.chat.mermaid.loading")}
							</div>
						) : svgContent ? (
							<div
								className={cn("flex h-full w-full items-center justify-center")}
								style={{
									transform: `translate(${currentTransformState.x}px, ${currentTransformState.y}px) scale(${currentTransformState.scale})`,
									transformOrigin: "center center",
								}}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG content from the diagram renderer is safe
								dangerouslySetInnerHTML={{ __html: svgContent }}
							/>
						) : null}
					</div>
				);
			} catch (err) {
				console.error("Error rendering diagram content:", err);
				return (
					<DiagramError title={t("ui.chat.mermaid.rendering_error")}>
						{t("ui.chat.mermaid.render_failed")}
					</DiagramError>
				);
			}
		};

		return (
			<>
				<div
					className={cn(
						"relative flex items-center justify-center overflow-hidden rounded-md bg-surface",
						inlineSvgClassName,
						"[&_svg]:max-w-none [&_svg]:bg-transparent",
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
						<Tooltip content={t("ui.chat.mermaid.fullscreen")}>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.chat.mermaid.open_fullscreen")}
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
					title={t("ui.chat.mermaid.diagram_title")}
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
							<Tooltip content={t("ui.chat.mermaid.close_fullscreen")}>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t("ui.chat.mermaid.close_fullscreen")}
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
	},
);

/**
 * Diagram viewer wrapped with error boundary for maximum error containment
 */
export const DiagramViewer: FC<DiagramViewerProps> = memo((props) => {
	return (
		<DiagramErrorBoundary>
			<DiagramViewerCore {...props} />
		</DiagramErrorBoundary>
	);
});
