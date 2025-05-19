import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Synth theme
 *
 * A retro synthwave-inspired theme with vibrant pinks, oranges, and neon blues
 * set against a dark, moody background.
 */
const synthTheme = createTheme({
	breakpoints: {
		values: {
			xs: 0,
			sm: 600,
			md: 900,
			lg: 1300,
			xl: 1800,
		},
	},
	palette: {
		mode: "dark",
		primary: {
			main: "#FF4081", // Vibrant Pink
			dark: "#F50057", // Darker Pink
			light: "#FF79B0", // Lighter Pink
			contrastText: "#FFFFFF",
		},
		secondary: {
			main: "#00E5FF", // Neon Blue
			dark: "#00B8D4", // Darker Neon Blue
			light: "#69FFFF", // Lighter Neon Blue
			contrastText: "#000000",
		},
		background: {
			default: "#120720", // Even Darker Purple/Indigo
			paper: "#1B0A2F", // Even Slightly Lighter Darker Purple
		},
		text: {
			primary: "#F9FAFB", // from darkTheme
			secondary: "#9CA3AF", // from darkTheme
		},
		caption: "rgba(255, 255, 255, 0.8)", // from darkTheme
		sidebar: {
			background: "#120720", // Main navigation sidebar (Even Darker Purple)
			secondaryBackground: "#1B0A2F", // Secondary sidebars (Even Slightly Lighter Darker Purple)
			border: "rgba(255, 64, 129, 0.2)", // Primary color (Vibrant Pink) with alpha
			itemHover: "rgba(255, 64, 129, 0.1)",
			itemActive: "rgba(0, 229, 255, 0.2)", // Neon Blue with opacity
			itemActiveHover: "rgba(0, 229, 255, 0.25)", // Neon Blue with higher opacity for hover
			itemText: "rgba(255, 255, 255, 0.85)", // from darkTheme
			itemActiveText: "#00E5FF", // Neon Blue
			toggleButton: {
				background: "rgba(255, 64, 129, 0.08)",
				border: "rgba(255, 64, 129, 0.25)",
				hoverBackground: "rgba(255, 64, 129, 0.15)",
				hoverBorder: "rgba(255, 64, 129, 0.45)",
			},
		},
		tooltip: {
			background: "#2C1D43", // Darker Purple
			border: "rgba(255, 64, 129, 0.25)",
			text: "#FFFFFF", // from darkTheme
		},
		userMessage: {
			background: "rgba(255, 64, 129, 0.1)", // Primary color (Vibrant Pink) with alpha
			border: "rgba(255, 64, 129, 0.35)",
			shadow: "0 4px 12px rgba(255, 64, 129, 0.2)",
		},
		messagesView: {
			background: "rgba(18, 7, 32, 0.6)", // Even Darker Purple background for messages view
		},
		inputField: {
			background: "rgba(18, 7, 32, 0.9)", // Even Darker Purple
			hoverBackground: "rgba(27, 10, 47, 0.9)", // Even Darker Purple hover
			focusBackground: "#2C1D43", // Darker Purple
			border: "rgba(0, 229, 255, 0.25)", // Neon Blue border
		},
		actionHighlight: {
			done: {
				background: "rgba(0, 229, 255, 0.1)", // Neon Blue with opacity
				border: "rgba(0, 229, 255, 0.4)",
			},
			ask: {
				background: "rgba(255, 165, 0, 0.15)", // Bright Orange with opacity
				border: "rgba(255, 165, 0, 0.5)", // Bright Orange for border
			},
		},
		icon: {
			background: "rgba(255, 64, 129, 0.15)", // Primary color (Vibrant Pink) with opacity
			text: "#FF4081", // Primary color (Vibrant Pink)
		},
	},
	typography: {
		fontFamily:
			"system-ui, Inter, -apple-system, BlinkMacSystemFont, sans-serif", // from darkTheme
		fontSize: 16, // from darkTheme
		h1: { fontWeight: 600 }, // from darkTheme
		h2: { fontWeight: 600 }, // from darkTheme
		h3: { // from darkTheme (structure)
			fontWeight: 600,
			fontSize: "3rem",
			textShadow: "0 0 5px #FF4081", // Keep some pink shadow for vibrancy
			"@media (max-width:600px)": {
				fontSize: "2.7rem",
			},
		},
		gradientTitle: { // from darkTheme (structure), but with synth colors
			fontSize: "1.4rem",
			fontWeight: 400,
			letterSpacing: "0.02em",
			background: "linear-gradient(90deg, #FF4081, #FFA500, #00E5FF)", // Pink to Orange to Blue gradient
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 10px rgba(255, 64, 129, 0.3), 0 0 15px rgba(0, 229, 255, 0.2)", // Adjusted synth shadow
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(18, 7, 32, 0.88)", // Even Darker Purple with alpha
					backdropFilter: "blur(10px)",
					boxShadow: "0 2px 12px rgba(255, 64, 129, 0.25)", // Pink glow shadow
				},
			},
		},
		MuiListItemButton: {
			styleOverrides: {
				root: ({ theme }) => ({
					borderRadius: 6, // Sharper edges
					transition: "all 0.15s ease-in-out",
					paddingTop: 10,
					paddingBottom: 10,
					border: "1px solid transparent",
					"&:hover": {
						background: "rgba(255, 64, 129, 0.1)", // Pink hover
						borderColor: "rgba(255, 64, 129, 0.25)",
						backdropFilter: "blur(3px)",
					},
					"&.Mui-selected": {
						background: "rgba(0, 229, 255, 0.18)", // Blue selected
						borderColor: "rgba(0, 229, 255, 0.45)",
						boxShadow: `0 0 10px ${theme.palette.secondary.main}44`, // Blue glow
					},
				}),
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(240, 244, 248, 0.9)",
					marginRight: 6,
					transition: "all 0.15s ease-in-out",
					"&:hover": {
						background: "rgba(255, 64, 129, 0.12)", // Pink hover
						color: "#FF4081", // Pink color on hover
						textShadow: "0 0 6px #FF4081",
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: ({ theme }) => ({
						color: "rgba(240, 244, 248, 0.9)",
						margin: "0 3px",
						padding: "7px 14px",
						borderRadius: 6, // Sharper edges
						border: "1px solid rgba(0, 229, 255, 0.25)", // Blue border
						transition: "all 0.15s ease-in-out",
						fontSize: "0.8rem",
						"&:hover": {
							background: "rgba(0, 229, 255, 0.12)", // Blue hover
							borderColor: "rgba(0, 229, 255, 0.55)",
							color: theme.palette.secondary.main, // Blue text
							boxShadow: `0 0 10px ${theme.palette.secondary.main}66`,
							backdropFilter: "blur(3px)",
						},
					}),
				},
			],
			styleOverrides: {
				root: {
					textTransform: "uppercase", // Uppercase for retro feel
					borderRadius: 6, // Sharper edges
					padding: "7px 14px",
					transition: "all 0.15s ease-in-out",
				},
				containedPrimary: ({ theme }) => ({
					boxShadow: `0 0 12px ${theme.palette.primary.main}88`,
					border: `1px solid ${theme.palette.primary.dark}`,
					"&:hover": {
						boxShadow: `0 0 18px ${theme.palette.primary.main}BB`,
						backgroundColor: theme.palette.primary.dark,
					},
				}),
				containedSecondary: ({ theme }) => ({
					boxShadow: `0 0 12px ${theme.palette.secondary.main}88`,
					border: `1px solid ${theme.palette.secondary.dark}`,
					"&:hover": {
						boxShadow: `0 0 18px ${theme.palette.secondary.main}BB`,
						backgroundColor: theme.palette.secondary.dark,
					},
				}),
				outlinedPrimary: ({ theme }) => ({
					borderColor: theme.palette.primary.main,
					color: theme.palette.primary.main,
					"&:hover": {
						backgroundColor: "rgba(255, 64, 129, 0.12)", // Pink hover
						borderColor: theme.palette.primary.light,
						boxShadow: `0 0 10px ${theme.palette.primary.main}66`,
					},
				}),
			},
		},
		MuiCard: {
			styleOverrides: {
				root: () => ({
					backgroundColor: "rgba(27, 10, 47, 0.9)", // Even Darker Purple with alpha
					borderRadius: 10, // Slightly less rounded
					border: "1px solid rgba(255, 64, 129, 0.3)", // Pink border
					backdropFilter: "blur(8px)",
					boxShadow: "0 5px 18px rgba(255, 64, 129, 0.15)", // Pink glow
				}),
			},
		},
		MuiContainer: {
			styleOverrides: {
				maxWidthLg: {
					maxWidth: "1300px",
					"@media (min-width:1300px)": {
						maxWidth: "1300px",
					},
				},
				maxWidthXl: {
					maxWidth: "1800px",
					"@media (min-width:1800px)": {
						maxWidth: "1800px",
					},
				},
			},
		},
	},
});

export default synthTheme;
