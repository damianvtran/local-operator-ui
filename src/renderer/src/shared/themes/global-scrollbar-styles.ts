import type { Theme } from "@mui/material/styles";

/**
 * Global scrollbar styles.
 *
 * The thumb is `borderControl` — the role floored at 3:1 on every ground —
 * because a scrollbar thumb is a control the user has to find and grab, not a
 * decorative rule. It used to be a mode-switched `rgba(255,255,255,0.1)` /
 * `rgba(0,0,0,0.2)`, which measured about 1.1:1 in dark themes: the thumb was
 * there, and it was invisible until you already knew where it was.
 *
 * The track stays transparent so the scrollbar takes the colour of whichever
 * ground it is over, rather than cutting a strip of a fifth colour through it.
 */
export const createGlobalScrollbarStyles = (theme: Theme) => ({
	"*::-webkit-scrollbar": {
		width: "8px",
		height: "8px",
	},
	"*::-webkit-scrollbar-thumb": {
		backgroundColor: theme.palette.roles.borderControl,
		borderRadius: "4px",
	},
	"*::-webkit-scrollbar-track": {
		backgroundColor: "transparent",
	},
	"*::-webkit-scrollbar-corner": {
		backgroundColor: "transparent",
	},
});
