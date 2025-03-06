import localOperatorIcon from "@assets/icon.png";
import { Box, Typography, keyframes } from "@mui/material";
import { styled } from "@mui/material/styles";
import React from "react";
import type { FC } from "react";

/**
 * Pulse animation for the logo
 */
const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(56, 201, 106, 0.4);
  }
  70% {
    box-shadow: 0 0 0 15px rgba(56, 201, 106, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(56, 201, 106, 0);
  }
`;

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
})<{ expanded: boolean }>(({ theme, expanded }) => ({
	height: 34,
	marginRight: expanded ? theme.spacing(1.5) : 0,
	transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
	filter: "drop-shadow(0 0 8px rgba(56, 201, 106, 0.3))",
	position: "relative",
	zIndex: 2,
	"&:hover": {
		transform: "scale(1.12) rotate(5deg)",
		filter: "drop-shadow(0 0 12px rgba(56, 201, 106, 0.5))",
		animation: `${pulse} 1.5s infinite`,
	},
}));

const LogoText = styled(Typography)({
	fontSize: "1.2rem",
	fontWeight: 500,
	color: "rgba(255, 255, 255, 0.9)",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
});

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
