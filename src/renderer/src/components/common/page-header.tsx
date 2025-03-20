/**
 * Page Header Component
 *
 * A consistent header component for pages with customizable icon, title, and optional subtitle.
 */

import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import React from "react";
import type { FC, ReactNode } from "react";

type PageHeaderProps = {
	/**
	 * The title of the page
	 */
	title: string;

	/**
	 * FontAwesome icon to display next to the title
	 */
	icon: IconDefinition;

	/**
	 * Optional subtitle text to display below the header
	 */
	subtitle?: string;

	/**
	 * Optional additional content to render below the title
	 */
	children?: ReactNode;
};

// Styled components for better theme integration
const HeaderContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: theme.spacing(1),
	paddingBottom: theme.spacing(2),
	borderBottom: `1px solid ${theme.palette.divider}`,
}));

const HeaderIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	marginRight: theme.spacing(2),
	color: theme.palette.primary.main,
	// Add a subtle background to improve contrast in both light and dark modes
	padding: theme.spacing(1),
	borderRadius: 999,
	width: 32,
	height: 32,
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
}));

const SubtitleText = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(3),
	maxWidth: "800px",
	lineHeight: 1,
}));

/**
 * Page Header Component
 *
 * Provides consistent styling for page headers across the application
 * with customizable icon, title, and optional subtitle.
 * The component is fully theme-aware and adapts to both light and dark modes.
 */
export const PageHeader: FC<PageHeaderProps> = ({
	title,
	icon,
	subtitle,
	children,
}) => {
	return (
		<>
			<HeaderContainer>
				<HeaderIcon icon={icon} size="lg" />
				<Typography
					variant="h4"
					sx={{
						fontWeight: 700,
						letterSpacing: "-0.02em",
					}}
				>
					{title}
				</Typography>
			</HeaderContainer>

			{subtitle && (
				<SubtitleText variant="subtitle1" color="text.secondary">
					{subtitle}
				</SubtitleText>
			)}

			{children}
		</>
	);
};
