import type { Theme } from "@mui/material/styles";

/**
 * Global scrollbar styles utility
 * 
 * Provides consistent scrollbar styling across all themes
 */
export const createGlobalScrollbarStyles = (theme: Theme) => ({
	"*::-webkit-scrollbar": {
		width: "8px",
		height: "8px",
	},
	"*::-webkit-scrollbar-thumb": {
		backgroundColor: (theme.palette.mode === "dark" 
				? "rgba(255, 255, 255, 0.1)" 
				: "rgba(0, 0, 0, 0.2)"),
		borderRadius: "4px",
	},
	"*::-webkit-scrollbar-track": {
		backgroundColor: "transparent",
	},
	"*::-webkit-scrollbar-corner": {
		backgroundColor: "transparent",
	},
});

/**
 * Default scrollbar configuration for themes that don't have it defined
 */
export const getDefaultScrollbarConfig = (mode: "light" | "dark") => ({
	width: "8px",
	height: "8px",
	thumb: {
		backgroundColor: mode === "dark" 
			? "rgba(255, 255, 255, 0.1)" 
			: "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
	},
	track: {
		backgroundColor: "transparent",
	},
});
