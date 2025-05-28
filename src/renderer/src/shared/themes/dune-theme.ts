import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Dune theme
 *
 * A dark orange theme inspired by the desert landscapes of Arrakis
 */
const duneTheme = createTheme({
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
			main: "#FF8C38", // Vibrant orange
			dark: "#E67016", // Darker orange
			light: "#FFA75C", // Lighter orange
			contrastText: "#ffffff",
		},
		secondary: {
			main: "#D9621E", // Burnt orange
			dark: "#B84A0A", // Deep burnt orange
			light: "#F17A34", // Lighter burnt orange
			contrastText: "#ffffff",
		},
		background: {
			default: "#0F0D0B", // Very dark off-black with slight warmth
			paper: "#1A1714", // Dark brown-black
		},
		text: {
			primary: "#F9FAFB",
			secondary: "#BFB3A7", // Warm gray with orange tint
		},
		caption: "rgba(255, 255, 255, 0.8)",
		sidebar: {
			background: "#0F0D0B", // Main navigation sidebar
			secondaryBackground: "#1A1714", // Secondary sidebars (chat/agents)
			border: "rgba(255, 165, 0, 0.08)", // Orange-tinted border
			itemHover: "rgba(255, 165, 0, 0.07)", // Orange-tinted hover
			itemActive: "rgba(255, 140, 56, 0.15)", // Primary orange with opacity
			itemActiveHover: "rgba(255, 140, 56, 0.25)", // Primary orange with higher opacity
			itemText: "rgba(255, 255, 255, 0.85)",
			itemActiveText: "#FF8C38", // Primary orange
			toggleButton: {
				background: "rgba(255, 255, 255, 0.05)",
				border: "rgba(255, 165, 0, 0.1)", // Orange-tinted border
				hoverBackground: "rgba(255, 140, 56, 0.1)", // Primary orange with opacity
				hoverBorder: "rgba(255, 140, 56, 0.3)", // Primary orange with opacity
			},
		},
		tooltip: {
			background: "#261E17", // Dark brown
			border: "rgba(255, 165, 0, 0.1)", // Orange-tinted border
			text: "#FFFFFF",
		},
		userMessage: {
			background: "rgba(255, 140, 56, 0.15)", // Primary orange with opacity
			border: "rgba(255, 140, 56, 0.3)", // Primary orange with opacity
			shadow: "0 4px 12px rgba(255, 140, 56, 0.2)", // Primary orange with opacity
		},
		messagesView: {
			background: "rgba(15, 13, 11, 0.2)", // Dark background for messages view
		},
		inputField: {
			background: "rgba(15, 13, 11, 0.9)", // Very dark off-black with slight warmth
			hoverBackground: "rgba(26, 23, 20, 0.9)", // Dark brown-black
			focusBackground: "#261E17", // Darker brown
			border: "rgba(255, 165, 0, 0.1)", // Orange-tinted border
		},
		actionHighlight: {
			done: {
				background: "rgba(255, 140, 56, 0.1)", // Primary orange with opacity
				border: "rgba(255, 140, 56, 0.5)", // Primary orange with opacity
			},
			ask: {
				background: "rgba(217, 98, 30, 0.1)", // Secondary orange with opacity
				border: "rgba(217, 98, 30, 0.5)", // Secondary orange with opacity
			},
		},
		icon: {
			background: "rgba(217, 98, 30, 0.2)", // Secondary orange with opacity
			text: "#FF8C38", // Primary orange
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
					background: "rgba(15,13,11,0.8)",
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
						background: "rgba(255,165,0,0.05)",
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
						background: "rgba(255,165,0,0.05)",
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
							background: "rgba(255,165,0,0.05)",
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
					backgroundColor: "#1A1714",
					borderRadius: 12,
					border: "1px solid rgba(255, 165, 0, 0.1)",
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

export default duneTheme;
