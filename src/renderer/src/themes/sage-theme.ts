import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Sage Theme
 *
 * A Zelda-inspired theme with sage green colors
 */
const sageTheme = createTheme({
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
		mode: "light",
		primary: {
			main: "#B2CEB3", // Celadon - main sage green
			dark: "#8DA985", // Ash gray 100 - darker sage
			light: "#C1D7C2", // Celadon 600 - lighter sage
			contrastText: "#222C1F", // Ash gray 100 - dark text for contrast
		},
		secondary: {
			main: "#ABB79E", // Ash gray 2 - deeper green for contrast
			dark: "#677657", // Ash gray 2 300 - darker secondary
			light: "#BCC6B2", // Ash gray 2 600 - lighter secondary
			contrastText: "#293429", // Platinum 100 - dark text for contrast
		},
		background: {
			default: "#FDF9F1", // Floral white - very light background
			paper: "#FFFFFF", // White paper background
		},
		text: {
			primary: "#222C1F", // Ash gray 100 - darker forest green for better contrast
			secondary: "#454F3A", // Ash gray 2 200 - darker sage for secondary text
		},
		caption: "rgba(34, 44, 31, 0.75)", // Dark caption text with better contrast
		sidebar: {
			background: "#E6EBE6", // Platinum - light sage background
			border: "rgba(34, 44, 31, 0.1)",
			itemHover: "rgba(34, 44, 31, 0.07)",
			itemActive: "rgba(178, 206, 179, 0.15)",
			itemActiveHover: "rgba(178, 206, 179, 0.22)",
			itemText: "rgba(34, 44, 31, 0.8)",
			itemActiveText: "#677657", // Ash gray 2 300
			toggleButton: {
				background: "rgba(34, 44, 31, 0.05)",
				border: "rgba(34, 44, 31, 0.12)",
				hoverBackground: "rgba(178, 206, 179, 0.12)",
				hoverBorder: "rgba(178, 206, 179, 0.35)",
			},
		},
		tooltip: {
			background: "#FFFFFF",
			border: "rgba(34, 44, 31, 0.12)",
			text: "#222C1F", // Ash gray 100
		},
		userMessage: {
			background: "rgba(178, 206, 179, 0.15)",
			border: "rgba(178, 206, 179, 0.3)",
			shadow: "0 4px 12px rgba(178, 206, 179, 0.18)",
		},
		actionHighlight: {
			done: {
				background: "rgba(178, 206, 179, 0.08)", // Success color with opacity
				border: "rgba(178, 206, 179, 0.55)", // Success color with opacity
			},
			ask: {
				background: "rgba(171, 183, 158, 0.08)", // Info color with opacity
				border: "rgba(171, 183, 158, 0.55)", // Info color with opacity
			},
		},
	},
	typography: {
		fontFamily:
			"system-ui, Inter, -apple-system, BlinkMacSystemFont, sans-serif",
		fontSize: 16,
		h1: { fontWeight: 600 },
		h2: { fontWeight: 600 },
		h3: {
			fontWeight: 600,
			fontSize: "3rem",
			"@media (max-width:600px)": {
				fontSize: "2.7rem",
			},
		},
		gradientTitle: {
			fontSize: "1.4rem",
			fontWeight: 400,
			letterSpacing: "0.02em",
			background:
				"linear-gradient(90deg, rgba(34,44,31,0.95), rgba(34,44,31,0.85))", // Gradient
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 30px rgba(34,44,31,0.1)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(253,249,241,0.85)", // Floral white app bar
					backdropFilter: "blur(10px)",
					boxShadow: "0 1px 3px rgba(34,44,31,0.12)",
				},
			},
		},
		MuiListItemButton: {
			styleOverrides: {
				root: {
					borderRadius: 12,
					transition: "all 0.2s ease-in-out",
					paddingTop: 12,
					paddingBottom: 12,
					"&:hover": {
						background: "rgba(34,44,31,0.06)", // Light hover effect
						backdropFilter: "blur(4px)",
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(34,44,31,0.75)", // Dark icon color
					marginRight: 8,
					"&:hover": {
						background: "rgba(34,44,31,0.06)", // Light hover effect
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: {
						color: "rgba(34,44,31,0.75)", // Dark text
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 12,
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(34,44,31,0.06)", // Light hover effect
							backdropFilter: "blur(4px)",
						},
					},
				},
			],
			styleOverrides: {
				root: {
					textTransform: "none",
					borderRadius: 6,
					fontWeight: 500,
					padding: "8px 16px",
				},
				contained: {
					boxShadow: "none",
					"&:hover": {
						boxShadow: "none",
					},
				},
			},
		},
		MuiCard: {
			styleOverrides: {
				root: {
					backgroundColor: "#FFFFFF", // White card background
					borderRadius: 12,
					border: "1px solid rgba(34, 44, 31, 0.12)", // Light border
					boxShadow: "0 2px 8px rgba(34, 44, 31, 0.06)", // Subtle shadow
					backdropFilter: "blur(8px)",
				},
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
		MuiPaper: {
			styleOverrides: {
				root: {
					boxShadow: "0 1px 3px rgba(34,44,31,0.12)", // Lighter shadow for papers
				},
			},
		},
	},
});

export default sageTheme;
