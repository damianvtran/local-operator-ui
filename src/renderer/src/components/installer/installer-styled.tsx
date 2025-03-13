import { Box, Card } from "@mui/material";
import { styled } from "@mui/material/styles";

/**
 * Container for the installer app
 * Centers content vertically and horizontally
 */
export const AppContainer = styled(Box)(() => ({
	display: "flex",
	height: "100vh",
	overflow: "hidden",
	justifyContent: "center",
	alignItems: "center",
	backgroundColor: "#0A0A0A",
	padding: "32px",
}));

/**
 * Styled card component for the installer content
 */
export const StyledCard = styled(Card)(() => ({
	width: "100%",
	maxWidth: "520px",
	padding: "24px",
	display: "flex",
	flexDirection: "column",
	gap: "24px",
}));

/**
 * Container for the spinner
 */
export const SpinnerContainer = styled(Box)(() => ({
	display: "flex",
	justifyContent: "center",
	margin: "24px 0",
}));

/**
 * Animated spinner component
 */
export const Spinner = styled(Box)(({ theme }) => ({
	width: "40px",
	height: "40px",
	border: `3px solid ${theme.palette.primary.main}20`,
	borderRadius: "50%",
	borderTopColor: theme.palette.primary.main,
	animation: "spin 1s ease-in-out infinite",
	"@keyframes spin": {
		to: { transform: "rotate(360deg)" },
	},
}));
