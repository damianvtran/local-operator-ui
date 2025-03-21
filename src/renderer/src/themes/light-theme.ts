import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Local Operator Light theme
 *
 * Light mode theme for the application
 */
const lightTheme = createTheme({
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
			main: "#2BA458", // Slightly darker green for better contrast on light backgrounds
			dark: "#16843A",
			light: "#68D88E",
			contrastText: "#ffffff",
		},
		secondary: {
			main: "#1A9E6E", // Slightly darker secondary green
			dark: "#0A8258",
			light: "#52CF9D",
			contrastText: "#ffffff",
		},
		background: {
			default: "#F9FAFB", // Light background
			paper: "#FFFFFF", // White paper background
		},
		text: {
			primary: "#111827", // Dark text for light mode
			secondary: "#4B5563", // Medium gray for secondary text
		},
		caption: "rgba(0, 0, 0, 0.7)", // Dark caption text
		sidebar: {
			background: "#E8EEF2", // Darker blue-gray for main navigation
			secondaryBackground: "#F0F4F8", // Light blue-gray for secondary sidebars
			border: "rgba(0, 0, 0, 0.08)",
			itemHover: "rgba(0, 0, 0, 0.05)",
			itemActive: "rgba(42, 164, 88, 0.12)",
			itemActiveHover: "rgba(42, 164, 88, 0.18)",
			itemText: "rgba(0, 0, 0, 0.75)",
			itemActiveText: "#2BA458",
			toggleButton: {
				background: "rgba(0, 0, 0, 0.04)",
				border: "rgba(0, 0, 0, 0.1)",
				hoverBackground: "rgba(42, 164, 88, 0.1)",
				hoverBorder: "rgba(42, 164, 88, 0.3)",
			},
		},
		tooltip: {
			background: "#FFFFFF",
			border: "rgba(0, 0, 0, 0.1)",
			text: "#111827",
		},
		userMessage: {
			background: "rgba(66, 133, 244, 0.12)",
			border: "rgba(66, 133, 244, 0.25)",
			shadow: "0 4px 12px rgba(66, 133, 244, 0.15)",
		},
		messagesView: {
			background: "rgba(54, 81, 124, 0.12)", // Light bluish background for messages view
		},
		inputField: {
			background: "rgba(240, 240, 240, 0.7)",
			hoverBackground: "rgba(245, 245, 245, 0.9)",
			focusBackground: "#FFFFFF",
			border: "rgba(0, 0, 0, 0.1)",
		},
		actionHighlight: {
			done: {
				background: "rgba(43, 164, 88, 0.05)", // Success color with opacity
				border: "rgba(43, 164, 88, 0.5)", // Success color with opacity
			},
			ask: {
				background: "rgba(66, 133, 244, 0.05)", // Info color with opacity
				border: "rgba(66, 133, 244, 0.5)", // Info color with opacity
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
			background: "linear-gradient(90deg, rgba(0,0,0,0.95), rgba(0,0,0,0.85))", // Inverted gradient
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 30px rgba(0,0,0,0.1)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(255,255,255,0.8)", // Light app bar
					backdropFilter: "blur(10px)",
					boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
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
						background: "rgba(0,0,0,0.05)", // Light hover effect
						backdropFilter: "blur(4px)",
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(0,0,0,0.7)", // Dark icon color
					marginRight: 8,
					"&:hover": {
						background: "rgba(0,0,0,0.05)", // Light hover effect
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: {
						color: "rgba(0,0,0,0.7)", // Dark text
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 12,
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(0,0,0,0.05)", // Light hover effect
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
					border: "1px solid rgba(0, 0, 0, 0.1)", // Light border
					boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)", // Subtle shadow
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
					boxShadow: "0 1px 3px rgba(0,0,0,0.1)", // Lighter shadow for papers
				},
			},
		},
	},
});

export default lightTheme;
