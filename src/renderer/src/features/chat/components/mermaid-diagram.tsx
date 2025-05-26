import { Box, IconButton, Tooltip } from "@mui/material";
import { styled } from "@mui/material/styles";
import { BaseDialog } from "@shared/components/common/base-dialog";
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
import mermaid from "mermaid";
import type { FC, ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState, Component } from "react";

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

const MermaidContainer = styled(Box)(({ theme }) => ({
	position: "relative",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	overflow: "hidden",
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: "8px",
	backgroundColor: theme.palette.background.paper,
	"& .mermaid": {
		display: "flex",
		justifyContent: "center",
		alignItems: "center",
		width: "100%",
		cursor: "grab",
		"&.panning": {
			cursor: "grabbing",
		},
	},
	"& svg": {
		maxWidth: "none",
		height: "auto",
		minHeight: "400px",
		backgroundColor: "transparent",
		transition: "transform 0.2s ease-out",
	},
}));

const ControlsContainer = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: 8,
	right: 8,
	display: "flex",
	gap: 2,
	backgroundColor: theme.palette.background.paper,
	borderRadius: "6px",
	padding: "4px",
	boxShadow: theme.shadows[2],
	border: `1px solid ${theme.palette.divider}`,
	zIndex: 10,
}));

const ControlButton = styled(IconButton)(({ theme }) => ({
	width: 26,
	height: 26,
	padding: 4,
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
		color: theme.palette.text.primary,
	},
}));

const FullscreenContainer = styled(Box)(() => ({
	position: "relative",
	width: "100%",
	height: "80vh",
	overflow: "hidden",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	"& .mermaid": {
		display: "flex",
		justifyContent: "center",
		alignItems: "center",
		width: "100%",
		height: "100%",
		cursor: "grab",
		"&.panning": {
			cursor: "grabbing",
		},
	},
	"& svg": {
		maxWidth: "100%",
		maxHeight: "100%",
		width: "auto",
		height: "auto",
		backgroundColor: "transparent",
		transition: "transform 0.2s ease-out",
	},
}));

const FullscreenControls = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: 16,
	right: 16,
	display: "flex",
	gap: 8,
	backgroundColor: theme.palette.background.paper,
	borderRadius: "8px",
	padding: "6px",
	boxShadow: theme.shadows[4],
	border: `1px solid ${theme.palette.divider}`,
	zIndex: 10,
}));

const ErrorContainer = styled(Box)(({ theme }) => ({
	padding: "16px",
	margin: "16px 0",
	backgroundColor:
		theme.palette.mode === "light"
			? theme.palette.error.light
			: theme.palette.error.dark,
	color: theme.palette.error.contrastText,
	borderRadius: "8px",
	border: `1px solid ${theme.palette.error.main}`,
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.875rem",
}));

/**
 * Error boundary to catch any rendering errors that escape the component's error handling
 */
class MermaidErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
					<ErrorContainer>
						<strong>Mermaid Diagram Error:</strong>
						<br />
						{this.state.error?.message || "An unexpected error occurred while rendering the diagram"}
						<br />
						<br />
						<em>This error has been contained within the diagram component.</em>
					</ErrorContainer>
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

	const renderDiagram = useCallback(async () => {
		try {
			setIsLoading(true);
			setError(null);
			setSvgContent("");

			// Validate chart content before rendering
			if (!chart || typeof chart !== "string" || chart.trim().length === 0) {
				throw new Error("Invalid or empty chart content");
			}

			// Initialize mermaid with configuration that prevents global error rendering
			mermaid.initialize({
				startOnLoad: true,
				theme: "default",
				securityLevel: "loose",
				fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
				fontSize: 14,
				suppressErrorRendering: true, // Prevents global error elements from being inserted into DOM
			});

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
			const errorMessage = err instanceof Error ? err.message : "Failed to render mermaid diagram";
			setError(errorMessage);
			setSvgContent(""); // Ensure SVG content is cleared on error
		} finally {
			setIsLoading(false);
		}
	}, [chart, id]);

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
				scale: Math.min(prev.scale * 1.2, 5), // Increased max zoom to 5x
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
			<ErrorContainer>
				<strong>Mermaid Diagram Error:</strong>
				<br />
				{error}
				<br />
				<br />
				<strong>Chart:</strong>
				<pre style={{ margin: "8px 0 0 0", whiteSpace: "pre-wrap" }}>
					{chart}
				</pre>
			</ErrorContainer>
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
					className={`mermaid ${isPanning ? "panning" : ""}`}
					style={{
						minHeight: isFullscreenMode ? "100%" : "200px",
						width: "100%",
						height: isFullscreenMode ? "100%" : "auto",
					}}
					onMouseDown={handleMouseDown}
					onMouseMove={(e) => handleMouseMove(e, isFullscreenMode)}
					onMouseUp={handleMouseUp}
					onMouseLeave={handleMouseUp}
					onWheel={(e) => handleWheel(e, isFullscreenMode)}
				>
					{isLoading ? (
						<Box sx={{ padding: 2, color: "text.secondary" }}>
							Loading diagram...
						</Box>
					) : svgContent ? (
						<div
							style={{
								transform: `translate(${currentTransformState.x}px, ${currentTransformState.y}px) scale(${currentTransformState.scale})`,
								transformOrigin: "center center",
								width: "100%",
								height: "100%",
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
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
				<ErrorContainer>
					<strong>Rendering Error:</strong>
					<br />
					Failed to render diagram content
				</ErrorContainer>
			);
		}
	};

	return (
		<>
			<MermaidContainer>
				{renderDiagramContent(false)}

				<ControlsContainer>
					{/* @ts-ignore */}
					<Tooltip title="Zoom In">
						<ControlButton onClick={() => handleZoomIn(false)}>
							<ZoomIn size={14} />
						</ControlButton>
					</Tooltip>

					{/* @ts-ignore */}
					<Tooltip title="Zoom Out">
						<ControlButton onClick={() => handleZoomOut(false)}>
							<ZoomOut size={14} />
						</ControlButton>
					</Tooltip>

					{/* @ts-ignore */}
					<Tooltip title="Pan (drag to move)">
						<ControlButton>
							<Move size={14} />
						</ControlButton>
					</Tooltip>

					{/* @ts-ignore */}
					<Tooltip title="Reset View">
						<ControlButton onClick={() => handleReset(false)}>
							<RotateCcw size={14} />
						</ControlButton>
					</Tooltip>

					{/* @ts-ignore */}
					<Tooltip title="Save as SVG">
						<ControlButton onClick={handleSaveSVG}>
							<Download size={14} />
						</ControlButton>
					</Tooltip>

					{/* @ts-ignore */}
					<Tooltip
						title={copyStatus === "copied" ? "Copied!" : "Copy Mermaid Text"}
					>
						<ControlButton onClick={handleCopy}>
							<CopyIcon
								size={14}
								color={copyStatus === "copied" ? "#4caf50" : undefined}
							/>
						</ControlButton>
					</Tooltip>

					{/* @ts-ignore */}
					<Tooltip title="Fullscreen">
						<ControlButton onClick={() => handleFullscreenToggle(true)}>
							<Maximize2 size={14} />
						</ControlButton>
					</Tooltip>
				</ControlsContainer>
			</MermaidContainer>

			<BaseDialog
				open={isFullscreen}
				onClose={() => handleFullscreenToggle(false)}
				title="Mermaid Diagram"
				maxWidth="xl"
				fullWidth
				dialogProps={{
					PaperProps: {
						sx: { maxHeight: "90vh", height: "90vh" },
					},
				}}
			>
				<FullscreenContainer>
					{renderDiagramContent(true)}

					<FullscreenControls>
						{/* @ts-ignore */}
						<Tooltip title="Zoom In">
							<ControlButton onClick={() => handleZoomIn(true)}>
								<ZoomIn size={14} />
							</ControlButton>
						</Tooltip>

						{/* @ts-ignore */}
						<Tooltip title="Zoom Out">
							<ControlButton onClick={() => handleZoomOut(true)}>
								<ZoomOut size={14} />
							</ControlButton>
						</Tooltip>

						{/* @ts-ignore */}
						<Tooltip title="Pan (drag to move)">
							<ControlButton>
								<Move size={14} />
							</ControlButton>
						</Tooltip>

						{/* @ts-ignore */}
						<Tooltip title="Reset View">
							<ControlButton onClick={() => handleReset(true)}>
								<RotateCcw size={14} />
							</ControlButton>
						</Tooltip>

						{/* @ts-ignore */}
						<Tooltip title="Save as SVG">
							<ControlButton onClick={handleSaveSVG}>
								<Download size={14} />
							</ControlButton>
						</Tooltip>

						{/* @ts-ignore */}
						<Tooltip
							title={
								fullscreenCopyStatus === "copied"
									? "Copied!"
									: "Copy Mermaid Text"
							}
						>
							<ControlButton onClick={handleFullscreenCopy}>
								<CopyIcon
									size={14}
									color={
										fullscreenCopyStatus === "copied" ? "#4caf50" : undefined
									}
								/>
							</ControlButton>
						</Tooltip>

						{/* @ts-ignore */}
						<Tooltip title="Close Fullscreen">
							<ControlButton onClick={() => handleFullscreenToggle(false)}>
								<X size={14} />
							</ControlButton>
						</Tooltip>
					</FullscreenControls>
				</FullscreenContainer>
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
