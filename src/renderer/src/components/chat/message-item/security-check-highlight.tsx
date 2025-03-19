import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { SecurityCheckHighlightProps } from "./types";

const HighlightContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(() => ({
	position: "relative",
	padding: "16px",
	borderRadius: "8px",
	marginBottom: "16px",
	boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
	width: "100%",
	border: "1px solid rgba(255, 193, 7, 0.5)",
	backgroundColor: "rgba(255, 193, 7, 0.1)",
	transition: "all 0.2s ease",
	"&:hover": {
		boxShadow: "0 6px 16px rgba(0, 0, 0, 0.2)",
	},
}));

const SecurityBadge = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: "-10px",
	right: "16px",
	padding: "4px 8px",
	borderRadius: "12px",
	fontSize: "0.7rem",
	fontWeight: "bold",
	backgroundColor: theme.palette.warning.main,
	color: "#fff",
	display: "flex",
	alignItems: "center",
	gap: "4px",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
}));

/**
 * Component for highlighting security check execution type
 * Adds a prominent yellow caution outline and warning symbol
 * to indicate that a security risk was reviewed and averted
 */
export const SecurityCheckHighlight: FC<SecurityCheckHighlightProps> = ({
	children,
	isUser,
}) => {
	return (
		<HighlightContainer isUser={isUser}>
			<SecurityBadge>
				<FontAwesomeIcon icon={faExclamationTriangle} size="xs" />
				AI SECURITY BLOCK
			</SecurityBadge>
			{children}
		</HighlightContainer>
	);
};
