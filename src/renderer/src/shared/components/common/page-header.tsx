/**
 * Page Header Component
 *
 * A consistent header component for pages with customizable icon, title, and optional subtitle.
 */

import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
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
	 * Optional subtitle text to display below the header.
	 */
	subtitle?: string;

	/**
	 * Optional additional content to render below the title and subtitle.
	 */
	children?: ReactNode;
};

// --- Styled Components ---

/**
 * Main container for the entire header section (icon, text, and actions).
 * Uses flexbox for alignment and spacing.
 */
const PageHeaderRoot = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center", // Align items vertically
	justifyContent: "space-between", // Push icon/text left, children right
	marginBottom: theme.spacing(4),
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 2,
	padding: theme.spacing(2),
	gap: theme.spacing(2), // Add gap between left and right sections
}));

/**
 * Container for the icon and text block on the left side.
 */
const LeftContent = styled(Box)({
	display: "flex",
	alignItems: "center",
});

/**
/**
 * Styles for the icon wrapper.
 * Circular background, centered icon.
 */
const HeaderIconWrapper = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(1.5),
	borderRadius: "50%",
	backgroundColor: theme.palette.action.hover,
	width: "48px",
	height: "48px",
	flexShrink: 0,
}));

const StyledIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	color: theme.palette.text.primary,
	width: "24px",
	height: "24px",
}));

/**
 * Container for the title and subtitle text block.
 */
const TextContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	marginLeft: theme.spacing(2),
}));

/**
 * Styles for the main title text.
 */
const TitleText = styled(Typography)(() => ({
	fontSize: "1.5rem",
	fontWeight: 500,
	lineHeight: 1.3,
}));

/**
 * Styles for the optional subtitle text.
 */
const SubtitleText = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontSize: "0.875rem",
	marginTop: theme.spacing(0.5), // Reduced space between title and subtitle
	maxWidth: "800px",
	lineHeight: 1.5,
}));

// --- Component ---

/**
 * Page Header Component
 *
 * Provides consistent styling for page headers, inspired by shadcn principles,
 * using MUI theme variables for adaptability (light/dark modes).
 * Includes a circular icon, title, optional subtitle, and an area for action buttons (children).
 * The layout places the icon and text block on the left, and children (actions) on the right.
 */
export const PageHeader: FC<PageHeaderProps> = ({
	title,
	icon,
	subtitle,
	children,
}) => {
	return (
		<PageHeaderRoot>
			{/* Left side: Icon and Text */}
			<LeftContent>
				<HeaderIconWrapper>
					<StyledIcon icon={icon} />
				</HeaderIconWrapper>
				<TextContainer>
					<TitleText variant="h1">{title}</TitleText>
					{subtitle && <SubtitleText variant="body1">{subtitle}</SubtitleText>}
				</TextContainer>
			</LeftContent>

			{/* Right side: Action Buttons (Children) */}
			{children && <Box>{children}</Box>}
		</PageHeaderRoot>
	);
};
