import { Box, Typography } from "@mui/material";
import { styled, keyframes } from "@mui/material/styles";

/**
 * Container for the installer app
 * Fills the entire screen with a dark background
 */
export const AppContainer = styled(Box)(() => ({
	display: "flex",
	height: "100vh",
	width: "100vw",
	overflow: "hidden",
	backgroundColor: "#0A0A0A",
}));

/**
 * Main layout container for the installer
 * Divides the screen into two sections
 */
export const InstallerLayout = styled(Box)(() => ({
	display: "flex",
	width: "100%",
	height: "100%",
	"@media (max-width: 900px)": {
		flexDirection: "column",
	},
}));

/**
 * Left section of the installer containing the feature carousel
 */
export const FeatureSection = styled(Box)(({ theme }) => ({
	flex: "1 1 50%",
	display: "flex",
	flexDirection: "column",
	justifyContent: "center",
	alignItems: "center",
	padding: "48px",
	background: `linear-gradient(135deg, ${theme.palette.background.default} 0%, #111111 100%)`,
	position: "relative",
	overflow: "hidden",
	"&::after": {
		content: '""',
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		width: "1px",
		background: "rgba(255, 255, 255, 0.1)",
	},
	"@media (max-width: 900px)": {
		flex: "1 1 auto",
		padding: "32px 24px",
		"&::after": {
			width: "100%",
			height: "1px",
			bottom: 0,
			right: "auto",
		},
	},
}));

/**
 * Right section of the installer containing the progress information
 */
export const ProgressSection = styled(Box)(() => ({
	flex: "1 1 50%",
	display: "flex",
	flexDirection: "column",
	justifyContent: "center",
	alignItems: "center",
	padding: "48px",
	"@media (max-width: 900px)": {
		flex: "1 1 auto",
		padding: "32px 24px",
	},
}));

/**
 * Container for the spinner
 */
export const SpinnerContainer = styled(Box)(() => ({
	display: "flex",
	justifyContent: "center",
	margin: "16px 0",
}));

/**
 * Animated spinner component
 */
export const Spinner = styled(Box)(({ theme }) => ({
	width: "48px",
	height: "48px",
	border: `3px solid ${theme.palette.primary.main}20`,
	borderRadius: "50%",
	borderTopColor: theme.palette.primary.main,
	animation: "spin 1s ease-in-out infinite",
	"@keyframes spin": {
		to: { transform: "rotate(360deg)" },
	},
}));

/**
 * Logo container
 */
export const LogoContainer = styled(Box)(() => ({
	marginBottom: "24px",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	height: "120px",
}));

/**
 * Feature icon container
 */
export const FeatureIconContainer = styled(Box)(({ theme }) => ({
	width: "80px",
	height: "80px",
	borderRadius: "50%",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	marginBottom: "24px",
	background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 100%)`,
	boxShadow: "0 8px 32px rgba(56, 201, 106, 0.2)",
	fontSize: "2.5rem",
}));

// Animation keyframes
const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const fadeOut = keyframes`
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-10px);
  }
`;

/**
 * Animated feature content
 */
export const FeatureContent = styled(Box)<{ isActive: boolean }>(
	({ isActive }) => ({
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		textAlign: "center",
		maxWidth: "480px",
		animation: isActive
			? `${fadeIn} 0.5s ease-out forwards`
			: `${fadeOut} 0.5s ease-out forwards`,
		position: "absolute",
	}),
);

/**
 * Feature title typography
 */
export const FeatureTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.75rem",
	fontWeight: 600,
	marginBottom: "16px",
	background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
	WebkitBackgroundClip: "text",
	WebkitTextFillColor: "transparent",
}));

/**
 * Feature description typography
 */
export const FeatureDescription = styled(Typography)(() => ({
	fontSize: "1rem",
	lineHeight: 1.6,
	color: "rgba(255, 255, 255, 0.8)",
}));

/**
 * Progress indicator dots
 */
export const ProgressDots = styled(Box)(() => ({
	display: "flex",
	justifyContent: "center",
	gap: "8px",
	marginTop: "0",
	position: "relative",
	bottom: "0",
}));

/**
 * Individual progress dot
 */
export const ProgressDot = styled(Box)<{ active: boolean }>(
	({ active, theme }) => ({
		width: "8px",
		height: "8px",
		borderRadius: "50%",
		background: active
			? theme.palette.primary.main
			: "rgba(255, 255, 255, 0.2)",
		transition: "background 0.3s ease",
	}),
);

/**
 * Background pattern element
 */
export const BackgroundPattern = styled(Box)(() => ({
	position: "absolute",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	opacity: 0.05,
	backgroundImage:
		"radial-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px)",
	backgroundSize: "30px 30px",
	pointerEvents: "none",
}));
