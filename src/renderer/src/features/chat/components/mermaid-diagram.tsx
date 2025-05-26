import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { memo, useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

type MermaidDiagramProps = {
	chart: string;
	id?: string;
};

const MermaidContainer = styled(Box)(() => ({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	margin: "16px 0",
	overflow: "auto",
	"& .mermaid": {
		display: "flex",
		justifyContent: "center",
		alignItems: "center",
		width: "100%",
	},
	"& svg": {
		maxWidth: "100%",
		height: "auto",
    minHeight: "640px",
		backgroundColor: "transparent",
	},
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
 * Mermaid diagram component that renders mermaid syntax as SVG diagrams.
 * Uses dynamic import to load mermaid library only when needed.
 * Supports theme-aware styling and error handling.
 */
export const MermaidDiagram: FC<MermaidDiagramProps> = memo(
	({ chart, id }) => {
		const elementRef = useRef<HTMLDivElement>(null);
		const [error, setError] = useState<string | null>(null);
		const [isLoading, setIsLoading] = useState(true);
		const [svgContent, setSvgContent] = useState<string>("");

		useEffect(() => {
			let isMounted = true;

			const renderDiagram = async () => {
				try {
					setIsLoading(true);
					setError(null);
					setSvgContent("");

					if (!isMounted) return;

					// Initialize mermaid with simplified configuration
					mermaid.initialize({
						startOnLoad: true,
						theme: "default",
						securityLevel: "loose",
						fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
						fontSize: 14,
					});

					// Generate unique ID for the diagram (ensure no decimal points for valid CSS selector)
					const diagramId = id || `mermaid-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

					// Render the diagram
					const { svg } = await mermaid.render(diagramId, chart);

					if (!isMounted) return;

					// Store the SVG content in state instead of directly manipulating DOM
					setSvgContent(svg);
				} catch (err) {
					if (!isMounted) return;

					console.error("Mermaid rendering error:", err);
					setError(
						err instanceof Error
							? err.message
							: "Failed to render mermaid diagram",
					);
				} finally {
					if (isMounted) {
						setIsLoading(false);
					}
				}
			};

			renderDiagram();

			return () => {
				isMounted = false;
			};
		}, [chart, id]);

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

		return (
			<MermaidContainer>
				<div ref={elementRef} className="mermaid" style={{ minHeight: "50px" }}>
					{isLoading ? (
						<Box sx={{ padding: 2, color: "text.secondary" }}>
							Loading diagram...
						</Box>
					) : svgContent ? (
						<>
							{/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG content from mermaid library is safe */}
							<div dangerouslySetInnerHTML={{ __html: svgContent }} />
						</>
					) : null}
				</div>
			</MermaidContainer>
		);
	},
);
