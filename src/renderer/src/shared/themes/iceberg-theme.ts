import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Iceberg theme
 *
 * A cool, blue-tinted theme based on the Iceberg color scheme
 */
const icebergTheme = createTheme({
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
			main: "#2d539e", // Main color from Iceberg
			dark: "#1e3a7d", // Darker shade - increased contrast
			light: "#4d73be", // Lighter shade
			contrastText: "#ffffff",
		},
		secondary: {
			main: "#33374c", // Text color from Iceberg
			dark: "#262a3f", // Darker shade
			light: "#5b5f74", // Lighter shade
			contrastText: "#ffffff",
		},
		background: {
			default: "#e8e9ec", // Background color from Iceberg
			paper: "#f3f4f7", // Slightly lighter for paper elements
		},
		text: {
			primary: "#262a3f", // Darker text color for better contrast
			secondary: "#5b5f74", // Darker sub color for better contrast
		},
		caption: "rgba(38, 42, 63, 0.8)", // Darker text color with opacity
		sidebar: {
			background: "#e8e9ec", // Main navigation sidebar
			secondaryBackground: "#f3f4f7", // Secondary sidebars (chat/agents)
			border: "rgba(38, 42, 63, 0.15)", // Increased contrast
			itemHover: "rgba(38, 42, 63, 0.1)", // Increased contrast
			itemActive: "rgba(45, 83, 158, 0.15)", // Increased contrast
			itemActiveHover: "rgba(45, 83, 158, 0.25)", // Increased contrast
			itemText: "rgba(38, 42, 63, 0.9)", // Increased contrast
			itemActiveText: "#1e3a7d", // Darker blue for better contrast
			toggleButton: {
				background: "rgba(38, 42, 63, 0.08)", // Increased contrast
				border: "rgba(38, 42, 63, 0.15)", // Increased contrast
				hoverBackground: "rgba(45, 83, 158, 0.15)", // Increased contrast
				hoverBorder: "rgba(45, 83, 158, 0.4)", // Increased contrast
			},
		},
		tooltip: {
			background: "#f3f4f7",
			border: "rgba(38, 42, 63, 0.15)", // Increased contrast
			text: "#262a3f", // Darker text for better contrast
		},
		userMessage: {
			background: "rgba(45, 83, 158, 0.15)",
			border: "rgba(45, 83, 158, 0.3)",
			shadow: "0 4px 12px rgba(45, 83, 158, 0.2)",
		},
		messagesView: {
			background: "rgba(232, 233, 236, 0.6)", // Background color with opacity
		},
		inputField: {
			background: "rgba(232, 233, 236, 0.9)",
			hoverBackground: "rgba(243, 244, 247, 0.9)",
			focusBackground: "#f3f4f7",
			border: "rgba(38, 42, 63, 0.15)", // Increased contrast
		},
		actionHighlight: {
			done: {
				background: "rgba(45, 83, 158, 0.15)", // Increased contrast
				border: "rgba(45, 83, 158, 0.5)", // Primary color with opacity
			},
			ask: {
				background: "rgba(204, 81, 122, 0.15)", // Increased contrast
				border: "rgba(204, 81, 122, 0.5)", // Error color with opacity
			},
		},
		icon: {
			background: "rgba(45, 83, 158, 0.2)", // Primary color with opacity
			text: "#1e3a7d", // Darker blue for better contrast
		},
		error: {
			main: "#cc517a", // Error color from Iceberg
			dark: "#b32d5e", // Darker error color for better contrast
			light: "#d67a99", // Lighter shade
			contrastText: "#ffffff",
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
				"linear-gradient(90deg, rgba(38,42,63,0.95), rgba(38,42,63,0.85))",
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 30px rgba(38,42,63,0.1)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(232,233,236,0.8)",
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
						background: "rgba(38,42,63,0.08)",
						backdropFilter: "blur(4px)",
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(38,42,63,0.9)",
					marginRight: 8,
					"&:hover": {
						background: "rgba(38,42,63,0.08)",
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: {
						color: "rgba(38,42,63,0.9)",
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 12,
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(38,42,63,0.08)",
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
					backgroundColor: "#f3f4f7",
					borderRadius: 12,
					border: "1px solid rgba(38, 42, 63, 0.15)",
				},
			},
		},
		MuiTypography: {
			styleOverrides: {
				root: {
					"&.MuiTypography-body2": {
						color: "#262a3f", // Ensure body2 text has good contrast
					},
				},
			},
		},
		MuiListItemText: {
			styleOverrides: {
				secondary: {
					color: "#5b5f74", // Ensure secondary text has good contrast
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

export default icebergTheme;
