import localOperatorIcon from "@assets/icon.png";
import { Box, Typography, alpha, keyframes } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";

/**
 * Pulse animation for the logo
 */
const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.4);
  }
  70% {
    box-shadow: 0 0 0 15px rgba(var(--primary-rgb), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0);
  }
`;

// Regex for short hex color expansion (moved to top-level for performance)
const SHORT_HEX_COLOR_REGEX = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;

type CollapsibleAppLogoProps = {
	expanded: boolean;
};

const LogoContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "expanded",
})<{ expanded: boolean }>(({ expanded }) => ({
	display: "flex",
	alignItems: "center",
	cursor: "pointer",
	transition: "all 0.3s ease",
	width: expanded ? "auto" : 34,
	position: "relative",
	zIndex: 1,
}));

const LogoImage = styled("img", {
	shouldForwardProp: (prop) => prop !== "expanded",
})<{ expanded: boolean }>(({ theme, expanded }) => {
	// Extract RGB values from primary color for use in animations
	const primaryColor = theme.palette.primary.main;
	const primaryRgb = primaryColor
		.replace(SHORT_HEX_COLOR_REGEX, (_, r, g, b) => `#${r}${r}${g}${g}${b}${b}`)
		.substring(1)
		.match(/.{2}/g)
		?.map((x) => Number.parseInt(x, 16))
		.join(", ");

	return {
		height: 34,
		marginRight: expanded ? theme.spacing(1.5) : 0,
		transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
		filter: `drop-shadow(0 0 8px ${alpha(theme.palette.primary.main, 0.3)})`,
		position: "relative",
		zIndex: 2,
		"--primary-rgb": primaryRgb, // CSS variable for use in keyframes
		"&:hover": {
			transform: "scale(1.12) rotate(5deg)",
			filter: `drop-shadow(0 0 12px ${alpha(theme.palette.primary.main, 0.5)})`,
			animation: `${pulse} 1.5s infinite`,
		},
	};
});

const LogoText = styled(Typography)(({ theme }) => ({
	fontSize: "1.2rem",
	fontWeight: 500,
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.9)"
			: "rgba(0, 0, 0, 0.9)",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
}));

/**
 * CollapsibleAppLogo component displays the application logo and name
 * Shows only the logo when collapsed, and logo + name when expanded
 *
 * @param expanded - Whether the sidebar is expanded or collapsed
 */
export const CollapsibleAppLogo: FC<CollapsibleAppLogoProps> = ({
	expanded,
}) => {
	return (
		<LogoContainer expanded={expanded}>
			<LogoImage
				expanded={expanded}
				src={localOperatorIcon}
				alt="Local Operator Logo"
				loading="eager"
			/>
			{expanded && <LogoText variant="h6">Local Operator</LogoText>}
		</LogoContainer>
	);
};
