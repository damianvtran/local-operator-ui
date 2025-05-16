import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Neon theme
 *
 * A Tron-inspired theme with high saturation colors and a dark background.
 */
const neonTheme = createTheme({
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
			main: "#00EFFF", // Bright Cyan
			dark: "#00B8D9",
			light: "#66F7FF",
			contrastText: "#000000",
		},
		secondary: {
			main: "#E600E6", // Bright Magenta
			dark: "#B300B3",
			light: "#FF66FF",
			contrastText: "#ffffff",
		},
		background: {
			default: "#080C18", // Dark Desaturated Blue
			paper: "#0D1220", // Slightly Lighter Dark Blue
		},
		text: {
			primary: "#E0E0E0", // Light Grey
			secondary: "#A0A0B0", // Medium Grey
		},
		caption: "rgba(224, 224, 224, 0.8)", // Light Grey with Alpha
		sidebar: {
			background: "#080C18", // Main navigation sidebar
			secondaryBackground: "#0D1220", // Secondary sidebars (chat/agents)
			border: "rgba(0, 239, 255, 0.15)", // Primary color with alpha
			itemHover: "rgba(0, 239, 255, 0.1)",
			itemActive: "rgba(0, 239, 255, 0.2)",
			itemActiveHover: "rgba(0, 239, 255, 0.25)",
			itemText: "rgba(224, 224, 224, 0.85)",
			itemActiveText: "#00EFFF", // Primary color
			toggleButton: {
				background: "rgba(0, 239, 255, 0.08)",
				border: "rgba(0, 239, 255, 0.2)",
				hoverBackground: "rgba(0, 239, 255, 0.15)",
				hoverBorder: "rgba(0, 239, 255, 0.4)",
			},
		},
		tooltip: {
			background: "#101828", // Darker blue-grey
			border: "rgba(0, 239, 255, 0.2)",
			text: "#E0E0E0",
		},
		userMessage: {
			background: "rgba(0, 239, 255, 0.1)", // Primary color with alpha
			border: "rgba(0, 239, 255, 0.3)",
			shadow: "0 4px 12px rgba(0, 239, 255, 0.15)",
		},
		messagesView: {
			background: "rgba(8, 12, 24, 0.5)", // Dark background for messages view
		},
		inputField: {
			background: "rgba(8, 12, 24, 0.9)",
			hoverBackground: "rgba(13, 18, 32, 0.9)",
			focusBackground: "#101828", // Darker blue-grey
			border: "rgba(0, 239, 255, 0.2)",
		},
		actionHighlight: {
			done: {
				background: "rgba(0, 239, 255, 0.1)", // Primary color with opacity
				border: "rgba(0, 239, 255, 0.4)",
			},
			ask: {
				background: "rgba(230, 0, 230, 0.1)", // Secondary color with opacity
				border: "rgba(230, 0, 230, 0.4)",
			},
		},
		icon: {
			background: "rgba(0, 239, 255, 0.15)", // Primary color with opacity
			text: "#00EFFF", // Primary color
		},
	},
	typography: {
		fontFamily:
			"'Roboto Mono', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace", // Monospaced font for Tron feel
		fontSize: 16,
		h1: { fontWeight: 700, textShadow: "0 0 5px #00EFFF" }, // Added text shadow
		h2: { fontWeight: 700, textShadow: "0 0 4px #00EFFF" }, // Added text shadow
		h3: {
			fontWeight: 700,
			fontSize: "3rem",
			textShadow: "0 0 3px #00EFFF", // Added text shadow
			"@media (max-width:600px)": {
				fontSize: "2.7rem",
			},
		},
		gradientTitle: {
			fontSize: "1.4rem",
			fontWeight: 500,
			letterSpacing: "0.03em",
			background:
				"linear-gradient(90deg, #00EFFF, #B0E0FF)", // Cyan to light blue gradient
			WebkitBackgroundClip: "text",
			WebkitTextFillColor: "transparent",
			textShadow: "0 0 10px rgba(0, 239, 255, 0.3)",
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(8, 12, 24, 0.85)", // Dark blue with alpha
					backdropFilter: "blur(12px)", // Stronger blur
					boxShadow: "0 2px 10px rgba(0, 239, 255, 0.2)", // Neon glow shadow
				},
			},
		},
		MuiListItemButton: {
			styleOverrides: {
				root: ({ theme }) => ({
					borderRadius: 8,
					transition: "all 0.2s ease-in-out",
					paddingTop: 12,
					paddingBottom: 12,
					border: "1px solid transparent",
					"&:hover": {
						background: "rgba(0, 239, 255, 0.08)",
						borderColor: "rgba(0, 239, 255, 0.2)",
						backdropFilter: "blur(4px)",
					},
					"&.Mui-selected": {
						background: "rgba(0, 239, 255, 0.15)",
						borderColor: "rgba(0, 239, 255, 0.4)",
						boxShadow: `0 0 8px ${theme.palette.primary.main}33`,
					},
				}),
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "rgba(224, 224, 224, 0.9)",
					marginRight: 8,
					transition: "all 0.2s ease-in-out",
					"&:hover": {
						background: "rgba(0, 239, 255, 0.1)",
						color: "#00EFFF", // Primary color on hover
						textShadow: "0 0 5px #00EFFF",
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: ({ theme }) => ({
						color: "rgba(224, 224, 224, 0.9)",
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 8,
						border: "1px solid rgba(0, 239, 255, 0.2)",
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(0, 239, 255, 0.1)",
							borderColor: "rgba(0, 239, 255, 0.5)",
							color: theme.palette.primary.main,
							boxShadow: `0 0 8px ${theme.palette.primary.main}55`,
							backdropFilter: "blur(4px)",
						},
					}),
				},
			],
			styleOverrides: {
				root: {
					textTransform: "none",
					borderRadius: 8,
					fontWeight: 600, // Bolder font
					padding: "8px 16px",
					letterSpacing: "0.05em", // Wider letter spacing
					transition: "all 0.2s ease-in-out",
				},
				containedPrimary: ({ theme }) => ({
					boxShadow: `0 0 10px ${theme.palette.primary.main}77`,
					border: `1px solid ${theme.palette.primary.dark}`,
					"&:hover": {
						boxShadow: `0 0 15px ${theme.palette.primary.main}AA`,
						backgroundColor: theme.palette.primary.dark,
					},
				}),
				containedSecondary: ({ theme }) => ({
					boxShadow: `0 0 10px ${theme.palette.secondary.main}77`,
					border: `1px solid ${theme.palette.secondary.dark}`,
					"&:hover": {
						boxShadow: `0 0 15px ${theme.palette.secondary.main}AA`,
						backgroundColor: theme.palette.secondary.dark,
					},
				}),
				outlinedPrimary: ({ theme }) => ({
					borderColor: theme.palette.primary.main,
					color: theme.palette.primary.main,
					"&:hover": {
						backgroundColor: "rgba(0, 239, 255, 0.1)",
						borderColor: theme.palette.primary.light,
						boxShadow: `0 0 8px ${theme.palette.primary.main}55`,
					},
				}),
			},
		},
		MuiCard: {
			styleOverrides: {
				root: () => ({
					backgroundColor: "rgba(13, 18, 32, 0.85)", // Slightly lighter dark blue with alpha
					borderRadius: 12,
					border: "1px solid rgba(0, 239, 255, 0.25)", // Primary color border
					backdropFilter: "blur(10px)",
					boxShadow: "0 4px 15px rgba(0, 239, 255, 0.1)", // Neon glow
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

export default neonTheme;
