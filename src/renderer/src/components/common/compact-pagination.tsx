/**
 * Compact Pagination Component
 *
 * A sleek, minimal pagination component for sidebars
 */

import {
	faChevronLeft,
	faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, IconButton, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import React from "react";

const PaginationContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: theme.spacing(1, 2),
	borderTop: "1px solid rgba(255, 255, 255, 0.08)",
	backgroundColor: theme.palette.background.paper,
	position: "sticky",
	bottom: 0,
	left: 0,
	right: 0,
	zIndex: 10,
	minHeight: 40, // Ensure consistent height
	boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.1)", // Subtle shadow for visual separation
}));

const PageInfo = styled(Typography)({
	fontSize: "0.75rem",
	color: "rgba(255, 255, 255, 0.6)",
	userSelect: "none",
	fontWeight: 500,
});

const NavButton = styled(IconButton)(({ theme }) => ({
	width: 28,
	height: 28,
	color: theme.palette.text.secondary,
	backgroundColor: "rgba(255, 255, 255, 0.05)",
	"&:hover": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		color: theme.palette.primary.main,
	},
	"&.Mui-disabled": {
		color: "rgba(255, 255, 255, 0.2)",
		backgroundColor: "rgba(255, 255, 255, 0.03)",
	},
}));

/**
 * Props for the CompactPagination component
 */
type CompactPaginationProps = {
	/** Current page number */
	page: number;
	/** Total number of pages */
	count: number;
	/** Callback for page change */
	onChange: (page: number) => void;
};

/**
 * Compact Pagination Component
 *
 * A sleek, minimal pagination component designed for sidebars
 */
export const CompactPagination: FC<CompactPaginationProps> = ({
	page,
	count,
	onChange,
}) => {
	const handlePrevious = () => {
		if (page > 1) {
			onChange(page - 1);
		}
	};

	const handleNext = () => {
		if (page < count) {
			onChange(page + 1);
		}
	};

	// Always render the pagination component, even if there's only one page
	// This ensures consistent UI and prevents layout shifts

	return (
		<PaginationContainer>
			<NavButton
				size="small"
				onClick={handlePrevious}
				disabled={page <= 1}
				aria-label="Previous page"
			>
				<FontAwesomeIcon icon={faChevronLeft} size="xs" />
			</NavButton>

			<PageInfo>
				Page {page} of {count}
			</PageInfo>

			<NavButton
				size="small"
				onClick={handleNext}
				disabled={page >= count}
				aria-label="Next page"
			>
				<FontAwesomeIcon icon={faChevronRight} size="xs" />
			</NavButton>
		</PaginationContainer>
	);
};
