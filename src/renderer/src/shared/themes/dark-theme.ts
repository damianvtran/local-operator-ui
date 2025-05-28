import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Local Operator Dark theme
 *
 * The default dark theme for the application
 */
const darkTheme = createTheme({
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
			main: "#38C96A",
			dark: "#16B34A",
			light: "#68D88E",
			contrastText: "#ffffff",
		},
		secondary: {
			main: "#26BC85",
			dark: "#0AA26D",
			light: "#52CF9D",
			contrastText: "#ffffff",
		},
		background: {
			default: "#0A0A0A",
			paper: "#141414",
		},
		text: {
			primary: "#F9FAFB",
			secondary: "#9CA3AF",
		},
		caption: "rgba(255, 255, 255, 0.8)",
		sidebar: {
			background: "#0A0A0A", // Main navigation sidebar
			secondaryBackground: "#141414", // Secondary sidebars (chat/agents)
			border: "rgba(255, 255, 255, 0.08)",
			itemHover: "rgba(255, 255, 255, 0.07)",
			itemActive: "rgba(56, 201, 106, 0.1)",
			itemActiveHover: "rgba(56, 201, 106, 0.15)",
			itemText: "rgba(255, 255, 255, 0.85)",
			itemActiveText: "#38C96A",
			toggleButton: {
				background: "rgba(255, 255, 255, 0.05)",
				border: "rgba(255, 255, 255, 0.1)",
				hoverBackground: "rgba(56, 201, 106, 0.1)",
				hoverBorder: "rgba(56, 201, 106, 0.3)",
			},
		},
		tooltip: {
			background: "#1E1E1E",
			border: "rgba(255, 255, 255, 0.1)",
			text: "#FFFFFF",
		},
		userMessage: {
			background: "rgba(66, 133, 244, 0.15)",
			border: "rgba(66, 133, 244, 0.3)",
			shadow: "0 4px 12px rgba(66, 133, 244, 0.2)",
		},
		messagesView: {
			background: "rgba(0, 0, 0, 0.2)", // Dark background for messages view
		},
		inputField: {
			background: "rgba(10, 10, 10, 0.9)",
			hoverBackground: "rgba(20, 20, 20, 0.9)",
			focusBackground: "#1E1E1E",
			border: "rgba(255, 255, 255, 0.1)",
		},
		actionHighlight: {
			done: {
				background: "rgba(56, 201, 106, 0.1)", // Success color with opacity
				border: "rgba(56, 201, 106, 0.5)", // Success color with opacity
			},
			ask: {
				background: "rgba(66, 133, 244, 0.1)", // Info color with opacity
				border: "rgba(66, 133, 244, 0.5)", // Info color with opacity
			},
		},
		icon: {
			background: "rgba(38, 188, 133, 0.2)", // Secondary color with opacity
			text: "#38C96A", // Secondary color
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
				"linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85))",
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 30px rgba(255,255,255,0.1)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(10,10,10,0.8)",
				},
			},
		},
		MuiListItemButton: {
			styleOverrides: {
				root: {
					borderRadius: 12, // roughly 1.5 spacing units assuming an 8px baseline
					transition: "all 0.2s ease-in-out",
					paddingTop: 12,
					paddingBottom: 12,
					"&:hover": {
						background: "rgba(255,255,255,0.05)",
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(255,255,255,0.85)",
					marginRight: 8,
					"&:hover": {
						background: "rgba(255,255,255,0.05)",
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: {
						color: "rgba(255,255,255,0.85)",
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 12,
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(255,255,255,0.05)",
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
					backgroundColor: "#141414",
					borderRadius: 12,
					border: "1px solid rgba(255, 255, 255, 0.1)",
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
					backgroundImage: "none",
				},
			},
		},
	},
});

export default darkTheme;
