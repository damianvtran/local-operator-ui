import { createTheme } from "@mui/material/styles";
import "./theme-interfaces";

/**
 * Radient Theme
 *
 * A sleek dark theme with vibrant blue accents inspired by Radient branding.
 */
const radientTheme = createTheme({
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
			main: "#91b7e9", // Medium blue
			light: "#bdf0fd", // Light blue
			dark: "#282d47", // Dark blue
			contrastText: "#ffffff",
		},
		secondary: {
			main: "#bdf0fd", // Light blue accent
			light: "#d4f7ff",
			dark: "#7aaed1",
			contrastText: "#10151c",
		},
		background: {
			default: "#10151c", // Dark background
			paper: "#10151c",
		},
		text: {
			primary: "#ffffff",
			secondary: "#bdf0fd",
		},
		caption: "rgba(255, 255, 255, 0.7)",
		sidebar: {
			background: "#1a1f2f",
			secondaryBackground: "#282d47",
			border: "rgba(255, 255, 255, 0.12)",
			itemHover: "rgba(255, 255, 255, 0.08)",
			itemActive: "rgba(255, 255, 255, 0.15)",
			itemActiveHover: "rgba(255, 255, 255, 0.25)",
			itemText: "rgba(255, 255, 255, 0.85)",
			itemActiveText: "#bdf0fd",
			toggleButton: {
				background: "rgba(255, 255, 255, 0.1)",
				border: "rgba(255, 255, 255, 0.2)",
				hoverBackground: "rgba(255, 255, 255, 0.15)",
				hoverBorder: "rgba(255, 255, 255, 0.3)",
			},
		},
		tooltip: {
			background: "#1a1f2f",
			border: "rgba(255, 255, 255, 0.2)",
			text: "#ffffff",
		},
		userMessage: {
			background: "rgba(145, 183, 233, 0.15)",
			border: "rgba(145, 183, 233, 0.5)",
			shadow: "0 4px 12px rgba(145, 183, 233, 0.2)",
		},
		messagesView: {
			background: "rgba(16, 21, 28, 0.3)",
		},
		inputField: {
			background: "rgba(16, 21, 28, 0.9)",
			hoverBackground: "rgba(28, 33, 48, 0.9)",
			focusBackground: "#282d47",
			border: "rgba(255, 255, 255, 0.2)",
		},
		actionHighlight: {
			done: {
				background: "rgba(145, 183, 233, 0.15)",
				border: "rgba(145, 183, 233, 0.5)",
			},
			ask: {
				background: "rgba(189, 240, 253, 0.15)",
				border: "rgba(189, 240, 253, 0.5)",
			},
		},
		icon: {
			background: "rgba(189, 240, 253, 0.2)",
			text: "#bdf0fd",
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
				"linear-gradient(90deg, rgba(189,240,253,0.95), rgba(145,183,233,0.85))",
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 30px rgba(145,183,233,0.1)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(16,21,28,0.8)",
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
						background: "rgba(255,255,255,0.08)",
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
						background: "rgba(255,255,255,0.08)",
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
							background: "rgba(255,255,255,0.08)",
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
					backgroundColor: "#1a1f2f",
					borderRadius: 12,
					border: "1px solid rgba(255, 255, 255, 0.12)",
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

export default radientTheme;
