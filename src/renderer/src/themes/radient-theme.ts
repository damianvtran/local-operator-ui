/**
 * Radient theme configuration
 *
 * Palette colors:
 * - Light: #bdf0fd
 * - Medium: #91b7e9
 * - Dark: #282d47
 * - Background: #10151c
 */

import { createTheme } from "@mui/material/styles";

export const radientTheme = createTheme({
	palette: {
		mode: "dark",
		primary: {
			light: "#bdf0fd",
			main: "#91b7e9",
			dark: "#282d47",
			contrastText: "#ffffff",
		},
		background: {
			default: "#10151c",
			paper: "#10151c",
		},
		text: {
			primary: "#ffffff",
			secondary: "#bdf0fd",
		},
	},
});
