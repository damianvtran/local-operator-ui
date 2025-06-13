import { EditorView } from "@codemirror/view";
import type { Theme } from "@mui/material";

export const getSearchTheme = (theme: Theme) =>
	EditorView.theme(
		{
			".cm-panel.cm-search": {
				gap: "8px",
				padding: "8px",
				borderRadius: theme.shape.borderRadius * 1.5,
				backgroundColor: theme.palette.background.default,
				boxShadow: theme.shadows[3],
				border: `1px solid ${theme.palette.divider}`,
			},
			".cm-search .cm-textfield": {
				fontSize: "0.875rem",
				padding: "8px 12px",
				backgroundColor: theme.palette.background.paper,
				borderRadius: "8px",
				border: `1px solid ${theme.palette.divider}`,
				color: theme.palette.text.primary,
				"&:focus": {
					borderColor: theme.palette.primary.main,
					outline: "none",
				},
			},
			".cm-search-results": {
				fontSize: "0.85rem",
				color: theme.palette.text.secondary,
				padding: "0 8px",
				userSelect: "none",
			},
			"button.cm-button": {
				padding: "6px 10px",
				border: `1px solid ${theme.palette.divider}`,
				borderRadius: "8px",
				backgroundColor: "transparent",
				backgroundImage: "none",
				cursor: "pointer",
				color: theme.palette.text.secondary,
				fontSize: "0.7rem",
				"&:hover": {
					backgroundColor: theme.palette.action.hover,
					borderColor: theme.palette.primary.main,
				},
			},
			".cm-search label": {
				gap: "8px",
				fontSize: "0.85rem",
				color: theme.palette.text.secondary,
				cursor: "pointer",
			},
			".cm-search input[type='checkbox']": {
				appearance: "none",
				width: "16px",
				height: "16px",
				transform: "translateY(50%)",
				border: `1px solid ${theme.palette.divider}`,
				borderRadius: "4px",
				position: "relative",
				cursor: "pointer",
				"&:checked": {
					backgroundColor: theme.palette.background.default,
					borderColor: theme.palette.primary.main,
				},
				"&:checked::before": {
					content: "'✓'",
					position: "absolute",
					color: theme.palette.primary.main,
					backgroundColor: "transparent",
					top: "50%",
					left: "50%",
					transform: "translate(-50%, -50%)",
					fontSize: "12px",
				},
			},
		},
		{ dark: theme.palette.mode === "dark" },
	);
