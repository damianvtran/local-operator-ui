import { Box, Typography } from "@mui/material";
import { keyframes, styled } from "@mui/material/styles";

/**
 * Container for the installer app
 * Fills the entire screen with a dark background
 */
export const AppContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	height: "100vh",
	width: "100vw",
	overflow: "hidden",
	backgroundColor: theme.palette.background.default, // Use theme variable
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
	padding: theme.spacing(6), // Use theme spacing
	backgroundColor: theme.palette.background.paper, // Solid, slightly lighter background
	position: "relative",
	overflow: "hidden",
	"&::after": {
		content: '""',
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		width: "1px",
		backgroundColor: theme.palette.divider, // Softer divider
	},
	"@media (max-width: 900px)": {
		flex: "1 1 auto",
		padding: theme.spacing(4, 3),
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
export const ProgressSection = styled(Box)(({ theme }) => ({
	flex: "1 1 50%",
	display: "flex",
	flexDirection: "column",
	justifyContent: "center",
	alignItems: "center",
	padding: theme.spacing(6), // Use theme spacing
	backgroundColor: theme.palette.background.default, // Main background for contrast
	"@media (max-width: 900px)": {
		flex: "1 1 auto",
		padding: theme.spacing(4, 3),
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
	width: "40px", // Slightly smaller
	height: "40px",
	border: `4px solid ${theme.palette.action.disabledBackground}`, // Muted track
	borderRadius: "50%",
	borderTopColor: theme.palette.primary.main, // Accent color for spinner part
	animation: "spin 0.8s linear infinite", // Smoother, faster animation
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
	width: "64px", // Smaller icon container
	height: "64px",
	borderRadius: theme.shape.borderRadius * 2, // Rounded square like shadcn cards
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	marginBottom: theme.spacing(3),
	backgroundColor: theme.palette.action.hover, // Muted background
	// border: `1px solid ${theme.palette.divider}`, // Subtle border
	color: theme.palette.primary.main, // Icon color
	fontSize: "2rem", // Adjusted icon size
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
	fontSize: "1.5rem", // Adjusted size
	fontWeight: 600,
	marginBottom: theme.spacing(1.5),
	color: theme.palette.text.primary, // Solid color
}));

/**
 * Feature description typography
 */
export const FeatureDescription = styled(Typography)(({ theme }) => ({
	fontSize: "0.9rem", // Slightly smaller for balance
	lineHeight: 1.7, // Increased line height for readability
	color: theme.palette.text.secondary,
	maxWidth: "400px", // Limit width for better readability
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
		width: "10px", // Slightly larger dots
		height: "10px",
		borderRadius: "50%",
		backgroundColor: active
			? theme.palette.primary.main
			: theme.palette.action.disabledBackground, // Muted inactive color
		transition: "background-color 0.3s ease, transform 0.3s ease",
		cursor: "pointer",
		"&:hover": {
			transform: "scale(1.2)",
		},
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
	opacity: 0.03, // Even more subtle
	backgroundImage:
		"radial-gradient(rgba(255, 255, 255, 0.05) 0.5px, transparent 0.5px)", // Smaller dots
	backgroundSize: "20px 20px", // Smaller grid
	pointerEvents: "none",
}));
