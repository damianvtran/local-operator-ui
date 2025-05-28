import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Dracula theme
 *
 * A dark theme based on the popular Dracula color scheme
 */
const draculaTheme = createTheme({
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
			main: "#BD93F9", // Purple
			dark: "#9C71E0",
			light: "#D1AEFF",
			contrastText: "#282A36",
		},
		secondary: {
			main: "#FF79C6", // Pink
			dark: "#E056A1",
			light: "#FF9CD6",
			contrastText: "#282A36",
		},
		background: {
			default: "#282A36", // Dracula background
			paper: "#2F3146", // Slightly lighter background
		},
		text: {
			primary: "#F8F8F2", // Dracula foreground
			secondary: "#BFBFBF", // Lighter gray for secondary text
		},
		caption: "rgba(248, 248, 242, 0.8)",
		sidebar: {
			background: "#282A36", // Dracula background for main navigation
			secondaryBackground: "#2F3146", // Darker background for secondary sidebars
			border: "rgba(248, 248, 242, 0.08)",
			itemHover: "rgba(248, 248, 242, 0.07)",
			itemActive: "rgba(189, 147, 249, 0.2)",
			itemActiveHover: "rgba(189, 147, 249, 0.3)",
			itemText: "rgba(248, 248, 242, 0.85)",
			itemActiveText: "#FF79C6", // Purple
			toggleButton: {
				background: "rgba(248, 248, 242, 0.05)",
				border: "rgba(248, 248, 242, 0.1)",
				hoverBackground: "rgba(189, 147, 249, 0.1)",
				hoverBorder: "rgba(189, 147, 249, 0.3)",
			},
		},
		tooltip: {
			background: "#44475A", // Dracula current line
			border: "rgba(248, 248, 242, 0.1)",
			text: "#F8F8F2", // Dracula foreground
		},
		userMessage: {
			background: "rgba(139, 233, 253, 0.15)", // Cyan with opacity
			border: "rgba(139, 233, 253, 0.3)",
			shadow: "0 4px 12px rgba(139, 233, 253, 0.2)",
		},
		messagesView: {
			background: "rgba(40, 42, 54, 0.7)", // Darker dracula background with opacity
		},
		inputField: {
			background: "rgba(47, 49, 70, 0.7)",
			hoverBackground: "rgba(56, 58, 89, 0.9)",
			focusBackground: "#383A59",
			border: "rgba(248, 248, 242, 0.1)",
		},
		actionHighlight: {
			done: {
				background: "rgba(80, 250, 123, 0.15)", // Dracula green with opacity
				border: "rgba(80, 250, 123, 0.5)", // Dracula green with opacity
			},
			ask: {
				background: "rgba(255, 121, 198, 0.15)", // Dracula pink with opacity
				border: "rgba(255, 121, 198, 0.5)", // Dracula pink with opacity
			},
		},
		icon: {
			background: "rgba(139, 233, 253, 0.2)", // Dracula cyan with opacity
			text: "#8BE9FD", // Dracula cyan
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
					background: "rgba(40,42,54,0.8)", // Dracula background with opacity
					backdropFilter: "blur(10px)",
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
						backdropFilter: "blur(4px)",
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
					backgroundColor: "#383A59", // Slightly lighter background
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

export default draculaTheme;
