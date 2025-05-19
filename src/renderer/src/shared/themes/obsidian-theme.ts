import { createTheme } from "@mui/material/styles";
// Import the centralized theme interfaces
import "./theme-interfaces";

/**
 * Obsidian theme
 *
 * A high-contrast black and white theme inspired by Shadcn UI.
 */
const obsidianTheme = createTheme({
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
			// Accent color - typically white or light grey in monochrome
			main: "#FAFAFA", // Very light grey / off-white
			dark: "#E0E0E0", // Slightly darker for pressed states
			light: "#FFFFFF", // Pure white for hover states or highlights
			contrastText: "#09090B", // Text on primary elements
		},
		secondary: {
			// Secondary accent - a mid-grey
			main: "#A1A1AA", // Shadcn zinc-500
			dark: "#71717A", // Shadcn zinc-600
			light: "#D4D4D8", // Shadcn zinc-400
			contrastText: "#09090B", // Text on secondary elements
		},
		background: {
			default: "#09090B", // Shadcn zinc-950 (very dark grey, near black)
			paper: "#18181B", // Shadcn zinc-900 (slightly lighter for cards/surfaces)
		},
		text: {
			primary: "#FAFAFA", // Shadcn zinc-50 (off-white)
			secondary: "#A1A1AA", // Shadcn zinc-500 (grey for secondary text)
		},
		caption: "rgba(250, 250, 250, 0.7)", // Off-white with alpha
		sidebar: {
			background: "#09090B", // Main navigation sidebar
			secondaryBackground: "#18181B", // Secondary sidebars (chat/agents)
			border: "rgba(250, 250, 250, 0.12)", // Light border (zinc-50 alpha)
			itemHover: "rgba(250, 250, 250, 0.08)",
			itemActive: "rgba(250, 250, 250, 0.15)", // Active item background
			itemActiveHover: "rgba(250, 250, 250, 0.2)",
			itemText: "#A1A1AA", // Grey for normal items
			itemActiveText: "#FAFAFA", // White for active items
			toggleButton: {
				background: "rgba(250, 250, 250, 0.05)",
				border: "rgba(250, 250, 250, 0.15)",
				hoverBackground: "rgba(250, 250, 250, 0.1)",
				hoverBorder: "rgba(250, 250, 250, 0.3)",
			},
		},
		tooltip: {
			background: "#27272A", // Shadcn zinc-800
			border: "rgba(250, 250, 250, 0.15)",
			text: "#FAFAFA",
		},
		userMessage: {
			background: "rgba(250, 250, 250, 0.07)", // Subtle light background
			border: "rgba(250, 250, 250, 0.2)",
			shadow: "0 2px 8px rgba(250, 250, 250, 0.05)",
		},
		messagesView: {
			background: "#030711", // Even darker for message view (near black)
		},
		inputField: {
			background: "#18181B", // zinc-900
			hoverBackground: "#27272A", // zinc-800
			focusBackground: "#27272A", // zinc-800
			border: "rgba(250, 250, 250, 0.2)", // zinc-500
		},
		actionHighlight: {
			done: {
				background: "rgba(250, 250, 250, 0.1)", // Light grey highlight
				border: "rgba(250, 250, 250, 0.3)",
			},
			ask: {
				background: "rgba(161, 161, 170, 0.15)", // Mid-grey highlight (secondary based)
				border: "rgba(161, 161, 170, 0.4)",
			},
		},
		icon: {
			background: "rgba(250, 250, 250, 0.1)",
			text: "#FAFAFA",
		},
	},
	typography: {
		fontFamily:
			"system-ui, Inter, -apple-system, BlinkMacSystemFont, sans-serif", // Standard system/Inter font
		fontSize: 16,
		h1: { fontWeight: 700 },
		h2: { fontWeight: 700 },
		h3: {
			fontWeight: 700,
			fontSize: "3rem",
			"@media (max-width:600px)": {
				fontSize: "2.7rem",
			},
		},
		gradientTitle: {
			// Less emphasis on gradient for monochrome
			fontSize: "1.4rem",
			fontWeight: 600,
			letterSpacing: "0.01em",
			color: "#FAFAFA", // Solid off-white
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: "rgba(9, 9, 11, 0.85)", // zinc-950 with alpha
					backdropFilter: "blur(8px)",
					boxShadow: "0 1px 0 rgba(250, 250, 250, 0.08)", // Subtle bottom border
				},
			},
		},
		MuiListItemButton: {
			styleOverrides: {
				root: ({ theme }) => ({
					borderRadius: 8,
					transition:
						"background-color 0.2s ease-in-out, border-color 0.2s ease-in-out",
					paddingTop: 12,
					paddingBottom: 12,
					border: "1px solid transparent",
					"&:hover": {
						background: "rgba(250, 250, 250, 0.05)", // Subtle hover
						borderColor: "rgba(250, 250, 250, 0.1)",
					},
					"&.Mui-selected": {
						background: "rgba(250, 250, 250, 0.08)",
						borderColor: "rgba(250, 250, 250, 0.2)",
						color: theme.palette.text.primary, // Ensure text is primary on selected
					},
				}),
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "#A1A1AA", // zinc-500
					marginRight: 8,
					transition:
						"background-color 0.2s ease-in-out, color 0.2s ease-in-out",
					"&:hover": {
						background: "rgba(250, 250, 250, 0.08)",
						color: "#FAFAFA", // zinc-50
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: "nav" },
					style: ({ theme }) => ({
						color: theme.palette.text.secondary, // zinc-500
						margin: "0 4px",
						padding: "8px 16px",
						borderRadius: 8,
						border: "1px solid rgba(250, 250, 250, 0.15)", // zinc-50 alpha
						transition: "all 0.2s ease-in-out",
						"&:hover": {
							background: "rgba(250, 250, 250, 0.05)",
							borderColor: "rgba(250, 250, 250, 0.3)",
							color: theme.palette.text.primary, // zinc-50
						},
					}),
				},
			],
			styleOverrides: {
				root: {
					textTransform: "none",
					borderRadius: 6, // Shadcn default
					fontWeight: 500,
					padding: "8px 16px",
					transition: "all 0.2s ease-in-out",
				},
				containedPrimary: ({ theme }) => ({
					backgroundColor: theme.palette.primary.main, // off-white
					color: theme.palette.primary.contrastText, // black
					boxShadow: "none",
					"&:hover": {
						backgroundColor: theme.palette.primary.dark, // slightly darker off-white
						boxShadow: "none",
					},
				}),
				containedSecondary: ({ theme }) => ({
					backgroundColor: theme.palette.secondary.main, // mid-grey
					color: theme.palette.secondary.contrastText, // black
					boxShadow: "none",
					"&:hover": {
						backgroundColor: theme.palette.secondary.dark, // darker mid-grey
						boxShadow: "none",
					},
				}),
				outlinedPrimary: ({ theme }) => ({
					borderColor: "rgba(250, 250, 250, 0.3)", // Light border
					color: theme.palette.text.primary,
					"&:hover": {
						backgroundColor: "rgba(250, 250, 250, 0.05)",
						borderColor: "rgba(250, 250, 250, 0.5)",
					},
				}),
			},
		},
		MuiCard: {
			styleOverrides: {
				root: {
					backgroundColor: "#18181B", // zinc-900
					borderRadius: 8, // Shadcn often uses 0.5rem
					border: "1px solid rgba(250, 250, 250, 0.12)", // zinc-50 alpha border
					boxShadow: "none", // Shadcn cards usually don't have shadow by default
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

export default obsidianTheme;
