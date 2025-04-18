import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, IconButton, Tab, Tabs, alpha, styled } from "@mui/material";
import { type FC, useCallback, useEffect, useState } from "react";
import type { CanvasDocument } from "./types";

type CanvasTabsProps = {
	/**
	 * List of open documents
	 */
	documents: CanvasDocument[];

	/**
	 * ID of the currently active document
	 */
	activeDocumentId: string | null;

	/**
	 * Callback when a document tab is selected
	 */
	onChangeActiveDocument: (documentId: string) => void;

	/**
	 * Callback when a document tab is closed
	 */
	onCloseDocument: (documentId: string) => void;
};

/**
 * Styled tabs component
 */
const StyledTabs = styled(Tabs)(({ theme }) => ({
	borderBottom: `1px solid ${alpha(theme.palette.divider, 0.05)}`,
	maxWidth: "100%",
	minHeight: "42px",
	"& .MuiTabs-indicator": {
		height: 2,
		borderRadius: "2px 2px 0 0",
	},
}));

/**
 * Styled tab component
 */
const StyledTab = styled(Tab, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive?: boolean }>(({ theme, isActive }) => ({
	minHeight: "42px",
	padding: "4px 12px",
	textTransform: "none",
	fontSize: "0.85rem",
	fontWeight: 500,
	transition: "all 0.2s ease",
	opacity: isActive ? 1 : 0.7,
	maxWidth: "200px",
	position: "relative",
	paddingRight: "32px", // Space for close button
	"&:hover": {
		opacity: 1,
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.common.black,
			0.05,
		),
	},
}));

/**
 * Styled close button for tabs
 */
const CloseTabButton = styled(IconButton)(({ theme }) => ({
	position: "absolute",
	right: 4,
	top: "50%",
	transform: "translateY(-50%)",
	padding: 2,
	width: 18,
	height: 18,
	fontSize: "0.7rem",
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: alpha(theme.palette.error.main, 0.1),
		color: theme.palette.error.main,
	},
}));

/**
 * Tabs component for the markdown canvas
 * Displays a tab for each open document
 */
export const CanvasTabs: FC<CanvasTabsProps> = ({
	documents,
	activeDocumentId,
	onChangeActiveDocument,
	onCloseDocument,
}) => {
	const [value, setValue] = useState<string | false>(false);

	useEffect(() => {
		// Synchronizes internal tab selection state with the active document id from props
		// Ensures that the currently active tab matches the externally controlled
		if (
			activeDocumentId &&
			documents.find((document) => document.id === activeDocumentId)
		) {
			setValue(activeDocumentId);
		} else if (documents.length > 0 && !activeDocumentId) {
			// If there's no active document but we have documents, select the first one
			setValue(documents[0].id);
		} else if (documents.length === 0) {
			// If there are no documents, reset the value
			setValue(false);
		}
	}, [documents, activeDocumentId]);

	// Handle direct tab click
	const handleTabClick = useCallback(
		(documentId: string) => {
			onChangeActiveDocument(documentId);
		},
		[onChangeActiveDocument],
	);

	// Handle tab close
	const handleCloseTab = useCallback(
		(e: React.MouseEvent, documentId: string) => {
			e.stopPropagation(); // Prevent tab selection when closing
			onCloseDocument(documentId);
		},
		[onCloseDocument],
	);

	// If no documents, don't render tabs
	if (documents.length === 0) {
		return null;
	}

	return (
		<Box sx={{ borderBottom: 1, borderColor: "divider" }}>
			<StyledTabs
				value={activeDocumentId || value}
				variant="scrollable"
				scrollButtons="auto"
				aria-label="Markdown document tabs"
			>
				{documents.map((doc) => (
					<StyledTab
						key={doc.id}
						label={doc.title}
						value={doc.id}
						isActive={doc.id === activeDocumentId}
						onClick={() => handleTabClick(doc.id)}
						icon={
							<CloseTabButton
								onClick={(e) => handleCloseTab(e, doc.id)}
								size="small"
								aria-label={`Close ${doc.title}`}
							>
								<FontAwesomeIcon icon={faTimes} size="xs" />
							</CloseTabButton>
						}
						iconPosition="end"
					/>
				))}
			</StyledTabs>
		</Box>
	);
};
