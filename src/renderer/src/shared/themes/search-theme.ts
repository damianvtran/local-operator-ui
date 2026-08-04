import { EditorView } from "@codemirror/view";
import type { Theme } from "@mui/material";

/**
 * CodeMirror's find/replace panel, dressed in the theme's roles.
 *
 * The panel floats over the editor, so it takes `elevated` and the one overlay
 * shadow; its text field is a control, so its sole boundary is `borderControl`
 * — the role floored at 3:1 on every ground — rather than the hairline that
 * used to bound it at roughly 1.25:1 on the light themes.
 */
export const getSearchTheme = (theme: Theme) => {
	const roles = theme.palette.roles;

	return EditorView.theme(
		{
			".cm-panel.cm-search": {
				gap: "8px",
				padding: "8px",
				borderRadius: "10px",
				backgroundColor: roles.elevated,
				boxShadow: roles.overlayShadow,
				border: `1px solid ${roles.hairline}`,
			},
			".cm-search .cm-textfield": {
				fontSize: "0.8125rem",
				padding: "8px 12px",
				backgroundColor: roles.surface,
				borderRadius: "6px",
				border: `1px solid ${roles.borderControl}`,
				color: roles.ink,
				"&:focus": {
					borderColor: roles.accent,
					/* The focus ring is an outline everywhere else in the app; this
					   panel lives inside the editor's scroll container, which is
					   exactly where a box-shadow ring would be clipped away. */
					outline: `2px solid ${roles.accent}`,
					outlineOffset: "2px",
				},
			},
			".cm-search-results": {
				fontSize: "0.75rem",
				color: roles.inkMuted,
				padding: "0 8px",
				userSelect: "none",
			},
			"button.cm-button": {
				padding: "6px 10px",
				border: `1px solid ${roles.borderControl}`,
				borderRadius: "6px",
				backgroundColor: "transparent",
				backgroundImage: "none",
				cursor: "pointer",
				color: roles.inkMuted,
				fontSize: "0.75rem",
				"&:hover": {
					backgroundColor: roles.accentWash,
					borderColor: roles.accent,
					color: roles.ink,
				},
			},
			".cm-search label": {
				gap: "8px",
				fontSize: "0.75rem",
				color: roles.inkMuted,
				cursor: "pointer",
			},
			".cm-search input[type='checkbox']": {
				appearance: "none",
				width: "16px",
				height: "16px",
				transform: "translateY(50%)",
				border: `1px solid ${roles.borderControl}`,
				borderRadius: "4px",
				position: "relative",
				cursor: "pointer",
				"&:checked": {
					backgroundColor: roles.accentWash,
					borderColor: roles.accent,
				},
				"&:checked::before": {
					content: "'\\2713'",
					position: "absolute",
					color: roles.accent,
					backgroundColor: "transparent",
					top: "50%",
					left: "50%",
					transform: "translate(-50%, -50%)",
					fontSize: "12px",
				},
			},
		},
		{ dark: roles.mode === "dark" },
	);
};
