import {
	faDownload,
	faFileExport,
	faFilePdf,
	faFileWord,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	Menu,
	MenuItem,
	Tooltip,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { FC } from "react";
import { useCallback, useState } from "react";
import type { CanvasDocument, ExportFormat } from "../../types/canvas";

type CanvasToolbarProps = {
	/**
	 * The currently active document
	 */
	document: CanvasDocument;
};

/**
 * Styled toolbar container
 */
const ToolbarContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: theme.spacing(1, 2),
	borderBottom: `1px solid ${alpha(
		theme.palette.divider,
		theme.palette.mode === "light" ? 0.2 : 0.1,
	)}`,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.grey[100], 0.5)
			: alpha(theme.palette.background.default, 0.2),
}));

/**
 * Styled toolbar button
 */
const ToolbarButton = styled(Button)(({ theme }) => ({
	textTransform: "none",
	padding: theme.spacing(0.5, 1.5),
	fontSize: "0.85rem",
	minWidth: "auto",
	marginLeft: theme.spacing(1),
}));

/**
 * Toolbar component for the markdown canvas
 * Provides document actions like export
 *
 * @deprecated This component is not yet in use and may change in future releases.
 */
export const CanvasToolbar: FC<CanvasToolbarProps> = ({ document }) => {
	// State for export menu
	const [exportMenuAnchor, setExportMenuAnchor] = useState<null | HTMLElement>(
		null,
	);
	const isExportMenuOpen = Boolean(exportMenuAnchor);

	// Handle opening export menu
	const handleOpenExportMenu = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			setExportMenuAnchor(event.currentTarget);
		},
		[],
	);

	// Handle closing export menu
	const handleCloseExportMenu = useCallback(() => {
		setExportMenuAnchor(null);
	}, []);

	// Handle exporting document
	const handleExport = useCallback(
		(format: ExportFormat) => {
			// Close the menu
			handleCloseExportMenu();

			// TODO: Implement actual export functionality
			console.log(`Exporting ${document.title} as ${format}`);

			// For PDF export, we could use a library like jsPDF
			// For DOCX export, we could use a library like html-docx-js

			// For now, we'll just download the markdown file
			const blob = new Blob([document.content], { type: "text/markdown" });
			const url = URL.createObjectURL(blob);
			const a = window.document.createElement("a");
			a.href = url;
			a.download = `${document.title}.md`;
			a.click();
			URL.revokeObjectURL(url);
		},
		[document, handleCloseExportMenu],
	);

	return (
		<ToolbarContainer>
			<Box>
				<Typography variant="body2" fontWeight={500}>
					{document.title}
				</Typography>
			</Box>
			<Box>
				{/* Download original markdown file */}
				<Tooltip title="Download Markdown">
					<ToolbarButton
						size="small"
						variant="text"
						onClick={() => handleExport("md" as ExportFormat)}
						startIcon={<FontAwesomeIcon icon={faDownload} />}
					>
						Download
					</ToolbarButton>
				</Tooltip>

				{/* Export menu */}
				<Tooltip title="Export Document">
					<ToolbarButton
						size="small"
						variant="text"
						onClick={handleOpenExportMenu}
						startIcon={<FontAwesomeIcon icon={faFileExport} />}
					>
						Export
					</ToolbarButton>
				</Tooltip>

				{/* Export menu */}
				<Menu
					anchorEl={exportMenuAnchor}
					open={isExportMenuOpen}
					onClose={handleCloseExportMenu}
					anchorOrigin={{
						vertical: "bottom",
						horizontal: "right",
					}}
					transformOrigin={{
						vertical: "top",
						horizontal: "right",
					}}
				>
					<MenuItem onClick={() => handleExport("pdf")}>
						<FontAwesomeIcon
							icon={faFilePdf}
							style={{ marginRight: 8, color: "#e53935" }}
						/>
						Export as PDF
					</MenuItem>
					<MenuItem onClick={() => handleExport("docx")}>
						<FontAwesomeIcon
							icon={faFileWord}
							style={{ marginRight: 8, color: "#2196f3" }}
						/>
						Export as DOCX
					</MenuItem>
				</Menu>
			</Box>
		</ToolbarContainer>
	);
};
