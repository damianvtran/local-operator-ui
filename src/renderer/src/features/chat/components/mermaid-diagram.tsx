import { Box, IconButton, Tooltip } from "@mui/material";
import { styled } from "@mui/material/styles";
import { BaseDialog } from "@shared/components/common/base-dialog";
import {
	Download,
	Maximize2,
	Move,
	RotateCcw,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import mermaid from "mermaid";
import type { FC } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

type MermaidDiagramProps = {
	chart: string;
	id?: string;
};

const MermaidContainer = styled(Box)(({ theme }) => ({
	position: "relative",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	margin: "16px 0",
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
		minHeight: "200px",
		backgroundColor: "transparent",
		transition: "transform 0.2s ease-out",
	},
}));

const ControlsContainer = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: 8,
	right: 8,
	display: "flex",
	gap: 4,
	backgroundColor: theme.palette.background.paper,
	borderRadius: "6px",
	padding: "4px",
	boxShadow: theme.shadows[2],
	border: `1px solid ${theme.palette.divider}`,
	zIndex: 10,
}));

const ControlButton = styled(IconButton)(({ theme }) => ({
	width: 32,
	height: 32,
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
		maxWidth: "none",
		height: "90%",
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
	padding: "8px",
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
 * Enhanced Mermaid diagram component with zoom, pan, save SVG, reset, and fullscreen controls
 */
export const MermaidDiagram: FC<MermaidDiagramProps> = memo(({ chart, id }) => {
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

	const renderDiagram = useCallback(async () => {
		try {
			setIsLoading(true);
			setError(null);
			setSvgContent("");

			// Initialize mermaid with simplified configuration
			mermaid.initialize({
				startOnLoad: true,
				theme: "default",
				securityLevel: "loose",
				fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
				fontSize: 14,
			});

			// Generate unique ID for the diagram
			const diagramId =
				id || `mermaid-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

			// Render the diagram
			const { svg } = await mermaid.render(diagramId, chart);
			setSvgContent(svg);
		} catch (err) {
			console.error("Mermaid rendering error:", err);
			setError(
				err instanceof Error ? err.message : "Failed to render mermaid diagram",
			);
		} finally {
			setIsLoading(false);
		}
	}, [chart, id]);

	useEffect(() => {
		renderDiagram();
	}, [renderDiagram]);

	const handleZoomIn = useCallback((isFullscreenMode = false) => {
		const setTransformState = isFullscreenMode
			? setFullscreenTransform
			: setTransform;
		setTransformState((prev) => ({
			...prev,
			scale: Math.min(prev.scale * 1.2, 3),
		}));
	}, []);

	const handleZoomOut = useCallback((isFullscreenMode = false) => {
		const setTransformState = isFullscreenMode
			? setFullscreenTransform
			: setTransform;
		setTransformState((prev) => ({
			...prev,
			scale: Math.max(prev.scale / 1.2, 0.1),
		}));
	}, []);

	const handleReset = useCallback((isFullscreenMode = false) => {
		const setTransformState = isFullscreenMode
			? setFullscreenTransform
			: setTransform;
		setTransformState({ scale: 1, x: 0, y: 0 });
	}, []);

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

	const handleMouseDown = useCallback(
		(e: React.MouseEvent, isFullscreenMode = false) => {
			setIsPanning(true);
			setLastPanPoint({ x: e.clientX, y: e.clientY });
			e.preventDefault();
		},
		[],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent, isFullscreenMode = false) => {
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
		},
		[isPanning, lastPanPoint],
	);

	const handleMouseUp = useCallback(() => {
		setIsPanning(false);
	}, []);

	const handleWheel = useCallback(
		(e: React.WheelEvent, isFullscreenMode = false) => {
			e.preventDefault();
			const delta = e.deltaY > 0 ? 0.9 : 1.1;
			const setTransformState = isFullscreenMode
				? setFullscreenTransform
				: setTransform;

			setTransformState((prev) => ({
				...prev,
				scale: Math.min(Math.max(prev.scale * delta, 0.1), 3),
			}));
		},
		[],
	);

	const currentTransform = isFullscreen ? fullscreenTransform : transform;

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
		const containerRef = isFullscreenMode ? fullscreenElementRef : elementRef;
		const currentTransformState = isFullscreenMode
			? fullscreenTransform
			: transform;

		return (
			<div
				ref={containerRef}
				className={`mermaid ${isPanning ? "panning" : ""}`}
				style={{ minHeight: isFullscreenMode ? "100%" : "200px" }}
				onMouseDown={(e) => handleMouseDown(e, isFullscreenMode)}
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
						}}
						// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG content from mermaid library is safe
						dangerouslySetInnerHTML={{ __html: svgContent }}
					/>
				) : null}
			</div>
		);
	};

	return (
		<>
			<MermaidContainer>
				{renderDiagramContent(false)}

				<ControlsContainer>
					<Tooltip title="Zoom In">
						<ControlButton onClick={() => handleZoomIn(false)}>
							<ZoomIn size={16} />
						</ControlButton>
					</Tooltip>

					<Tooltip title="Zoom Out">
						<ControlButton onClick={() => handleZoomOut(false)}>
							<ZoomOut size={16} />
						</ControlButton>
					</Tooltip>

					<Tooltip title="Pan (drag to move)">
						<ControlButton>
							<Move size={16} />
						</ControlButton>
					</Tooltip>

					<Tooltip title="Reset View">
						<ControlButton onClick={() => handleReset(false)}>
							<RotateCcw size={16} />
						</ControlButton>
					</Tooltip>

					<Tooltip title="Save as SVG">
						<ControlButton onClick={handleSaveSVG}>
							<Download size={16} />
						</ControlButton>
					</Tooltip>

					<Tooltip title="Fullscreen">
						<ControlButton onClick={() => setIsFullscreen(true)}>
							<Maximize2 size={16} />
						</ControlButton>
					</Tooltip>
				</ControlsContainer>
			</MermaidContainer>

			<BaseDialog
				open={isFullscreen}
				onClose={() => setIsFullscreen(false)}
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
						<Tooltip title="Zoom In">
							<ControlButton onClick={() => handleZoomIn(true)}>
								<ZoomIn size={20} />
							</ControlButton>
						</Tooltip>

						<Tooltip title="Zoom Out">
							<ControlButton onClick={() => handleZoomOut(true)}>
								<ZoomOut size={20} />
							</ControlButton>
						</Tooltip>

						<Tooltip title="Pan (drag to move)">
							<ControlButton>
								<Move size={20} />
							</ControlButton>
						</Tooltip>

						<Tooltip title="Reset View">
							<ControlButton onClick={() => handleReset(true)}>
								<RotateCcw size={20} />
							</ControlButton>
						</Tooltip>

						<Tooltip title="Save as SVG">
							<ControlButton onClick={handleSaveSVG}>
								<Download size={20} />
							</ControlButton>
						</Tooltip>

						<Tooltip title="Close Fullscreen">
							<ControlButton onClick={() => setIsFullscreen(false)}>
								<X size={20} />
							</ControlButton>
						</Tooltip>
					</FullscreenControls>
				</FullscreenContainer>
			</BaseDialog>
		</>
	);
});
