import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Monokai theme
 *
 * A dark theme based on the popular Monokai color scheme
 */
const monokaiTheme = createTheme({
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
			main: "#A6E22E", // Monokai Green
			dark: "#8BC220",
			light: "#B6E94E",
			contrastText: "#272822",
		},
		secondary: {
			main: "#F92672", // Monokai Pink/Red
			dark: "#E01563",
			light: "#FA5286",
			contrastText: "#272822",
		},
		background: {
			default: "#272822", // Monokai background
			paper: "#2D2E27", // Slightly lighter background
		},
		text: {
			primary: "#F8F8F2", // Monokai foreground
			secondary: "#BFBFBF", // Lighter gray for secondary text
		},
		caption: "rgba(248, 248, 242, 0.8)",
		sidebar: {
			background: "#272822", // Monokai background for main navigation
			secondaryBackground: "#2D2E27", // Slightly lighter background for secondary sidebars
			border: "rgba(248, 248, 242, 0.08)",
			itemHover: "rgba(248, 248, 242, 0.07)",
			itemActive: "rgba(249, 38, 114, 0.15)",
			itemActiveHover: "rgba(249, 38, 114, 0.3)",
			itemText: "rgba(248, 248, 242, 0.85)",
			itemActiveText: "#F92672", // Monokai Pink/Red
			toggleButton: {
				background: "rgba(248, 248, 242, 0.05)",
				border: "rgba(248, 248, 242, 0.1)",
				hoverBackground: "rgba(166, 226, 46, 0.1)",
				hoverBorder: "rgba(166, 226, 46, 0.3)",
			},
		},
		tooltip: {
			background: "#3E3D32", // Slightly lighter than background
			border: "rgba(248, 248, 242, 0.1)",
			text: "#F8F8F2", // Monokai foreground
		},
		userMessage: {
			background: "rgba(102, 217, 239, 0.15)", // Monokai Blue with opacity
			border: "rgba(102, 217, 239, 0.3)",
			shadow: "0 4px 12px rgba(102, 217, 239, 0.2)",
		},
		messagesView: {
			background: "rgba(39, 40, 34, 0.7)", // Darker monokai background with opacity
		},
		inputField: {
			background: "rgba(45, 46, 39, 0.7)",
			hoverBackground: "rgba(62, 61, 50, 0.9)",
			focusBackground: "#3E3D32",
			border: "rgba(248, 248, 242, 0.1)",
		},
		actionHighlight: {
			done: {
				background: "rgba(166, 226, 46, 0.15)", // Monokai Green with opacity
				border: "rgba(166, 226, 46, 0.5)", // Monokai Green with opacity
			},
			ask: {
				background: "rgba(249, 38, 114, 0.15)", // Monokai Pink/Red with opacity
				border: "rgba(249, 38, 114, 0.5)", // Monokai Pink/Red with opacity
			},
		},
		icon: {
			background: "rgba(102, 217, 239, 0.15)", // Monokai Blue with opacity
			text: "#66D9EF", // Monokai Blue
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
				"linear-gradient(90deg, rgba(248,248,242,0.95), rgba(248,248,242,0.85))",
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 30px rgba(248,248,242,0.1)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(39,40,34,0.8)", // Monokai background with opacity
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
						background: "rgba(248,248,242,0.05)",
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(248,248,242,0.85)",
					marginRight: 8,
					"&:hover": {
						background: "rgba(248,248,242,0.05)",
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: {
						color: "rgba(248,248,242,0.85)",
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 12,
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(248,248,242,0.05)",
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
					backgroundColor: "#3E3D32", // Slightly lighter background
					borderRadius: 12,
					border: "1px solid rgba(248, 248, 242, 0.1)",
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

export default monokaiTheme;
