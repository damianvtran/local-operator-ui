/**
 * Page Header Component
 *
 * A consistent header component for pages with customizable icon, title, and optional subtitle.
 */

import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { LucideIcon } from "lucide-react";
import type { FC, ReactNode } from "react";

/**
 * Props for the PageHeader component.
 *
 * @property title - The title of the page.
 * @property icon - Lucide icon component to display next to the title.
 * @property subtitle - Optional subtitle text to display below the header.
 * @property children - Optional additional content to render below the title and subtitle.
 */
type PageHeaderProps = {
	title: string;
	icon: LucideIcon;
	subtitle?: string;
	children?: ReactNode;
};

// --- Styled Components ---

/**
 * Main container for the entire header section (icon, text, and actions).
 * Uses flexbox for alignment and spacing.
 */
const PageHeaderRoot = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	marginBottom: theme.spacing(4),
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 2,
	padding: theme.spacing(2),
	gap: theme.spacing(2),
}));

/**
 * Container for the icon and text block on the left side.
 */
const LeftContent = styled(Box)({
	display: "flex",
	alignItems: "center",
});

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
	marginTop: theme.spacing(0.5),
	maxWidth: "800px",
	lineHeight: 1.5,
}));

/**
 * Page Header Component
 *
 * Provides consistent styling for page headers, inspired by shadcn principles,
 * using MUI theme variables for adaptability (light/dark modes).
 * Includes a circular icon, title, optional subtitle, and an area for action buttons (children).
 * The layout places the icon and text block on the left, and children (actions) on the right.
 *
 * @param title - The title of the page.
 * @param icon - Lucide icon component to display next to the title.
 * @param subtitle - Optional subtitle text to display below the header.
 * @param children - Optional additional content to render below the title and subtitle.
 * @throws Error if the icon prop is not a valid LucideIcon component.
 */
export const PageHeader: FC<PageHeaderProps> = ({
	title,
	icon: Icon,
	subtitle,
	children,
}) => {
	return (
		<PageHeaderRoot>
			<LeftContent>
				<HeaderIconWrapper>
					<Icon size={24} strokeWidth={2} />
				</HeaderIconWrapper>
				<TextContainer>
					<TitleText variant="h1">{title}</TitleText>
					{subtitle && <SubtitleText variant="body1">{subtitle}</SubtitleText>}
				</TextContainer>
			</LeftContent>
			{children && <Box>{children}</Box>}
		</PageHeaderRoot>
	);
};
