import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Tokyo Night theme
 *
 * A dark theme inspired by the popular Tokyo Night VSCode theme
 * with deep blue-purple hues and vibrant accent colors
 */
const tokyoNightTheme = createTheme({
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
			main: "#7AA2F7", // Bright blue
			dark: "#5D7CD9",
			light: "#9EBCFF",
			contrastText: "#1A1B26",
		},
		secondary: {
			main: "#BB9AF7", // Purple
			dark: "#9D7CD9",
			light: "#D4BBFF",
			contrastText: "#1A1B26",
		},
		background: {
			default: "#1A1B26", // Dark blue-black
			paper: "#24283B", // Slightly lighter blue-black
		},
		text: {
			primary: "#C0CAF5", // Light blue-white
			secondary: "#A9B1D6", // Slightly darker blue-white
		},
		caption: "rgba(192, 202, 245, 0.8)",
		sidebar: {
			background: "#1A1B26", // Main navigation sidebar
			secondaryBackground: "#24283B", // Secondary sidebars (chat/agents)
			border: "rgba(86, 95, 137, 0.3)",
			itemHover: "rgba(86, 95, 137, 0.2)",
			itemActive: "rgba(122, 162, 247, 0.15)",
			itemActiveHover: "rgba(122, 162, 247, 0.25)",
			itemText: "rgba(192, 202, 245, 0.85)",
			itemActiveText: "#7AA2F7",
			toggleButton: {
				background: "rgba(86, 95, 137, 0.2)",
				border: "rgba(86, 95, 137, 0.3)",
				hoverBackground: "rgba(122, 162, 247, 0.15)",
				hoverBorder: "rgba(122, 162, 247, 0.3)",
			},
		},
		tooltip: {
			background: "#1F2335",
			border: "rgba(86, 95, 137, 0.3)",
			text: "#C0CAF5",
		},
		userMessage: {
			background: "rgba(122, 162, 247, 0.15)",
			border: "rgba(122, 162, 247, 0.3)",
			shadow: "0 4px 12px rgba(122, 162, 247, 0.2)",
		},
		messagesView: {
			background: "rgba(26, 27, 38, 0.3)", // Dark background for messages view
		},
		inputField: {
			background: "rgba(26, 27, 38, 0.9)",
			hoverBackground: "rgba(36, 40, 59, 0.9)",
			focusBackground: "#2A2F45",
			border: "rgba(86, 95, 137, 0.3)",
		},
		actionHighlight: {
			done: {
				background: "rgba(158, 206, 106, 0.15)", // Success color with opacity (green)
				border: "rgba(158, 206, 106, 0.5)", // Success color with opacity
			},
			ask: {
				background: "rgba(122, 162, 247, 0.15)", // Info color with opacity (blue)
				border: "rgba(122, 162, 247, 0.5)", // Info color with opacity
			},
		},
		icon: {
			background: "rgba(187, 154, 247, 0.2)", // Secondary color with opacity
			text: "#BB9AF7", // Secondary color
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
				"linear-gradient(90deg, rgba(192,202,245,0.95), rgba(169,177,214,0.85))",
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 30px rgba(122,162,247,0.1)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(26,27,38,0.8)",
					backdropFilter: "blur(10px)",
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
						background: "rgba(86,95,137,0.15)",
						backdropFilter: "blur(4px)",
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(192,202,245,0.85)",
					marginRight: 8,
					"&:hover": {
						background: "rgba(86,95,137,0.15)",
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: {
						color: "rgba(192,202,245,0.85)",
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 12,
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(86,95,137,0.15)",
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
					backgroundColor: "#24283B",
					borderRadius: 12,
					border: "1px solid rgba(86, 95, 137, 0.3)",
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
	},
});

export default tokyoNightTheme;
