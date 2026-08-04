import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * CodeMirror's find/replace panel, dressed in the theme's roles.
 *
 * The panel floats over the editor, so it takes `elevated` and the one overlay
 * shadow; its text field is a control, so its sole boundary is `borderControl`
 * — the role floored at 3:1 on every ground — rather than the hairline that
 * used to bound it at roughly 1.25:1 on the light themes.
 *
 * The roles arrive as `var(--color-*)` rather than as resolved values, because
 * `EditorView.theme` compiles to real CSS and the browser resolves the
 * variables at paint. So the panel follows a theme swap on its own and the
 * extensions below are built once at import, with no React involvement.
 */
const searchSpec = {
	".cm-panel.cm-search": {
		gap: "8px",
		padding: "8px",
		borderRadius: "10px",
		backgroundColor: "var(--color-elevated)",
		boxShadow: "var(--shadow-overlay)",
		border: "1px solid var(--color-hairline)",
	},
	".cm-search .cm-textfield": {
		fontSize: "0.8125rem",
		padding: "8px 12px",
		backgroundColor: "var(--color-surface)",
		borderRadius: "6px",
		border: "1px solid var(--color-control)",
		color: "var(--color-ink)",
		"&:focus": {
			borderColor: "var(--color-accent)",
			/* The focus ring is an outline everywhere else in the app; this
			   panel lives inside the editor's scroll container, which is
			   exactly where a box-shadow ring would be clipped away. */
			outline: "2px solid var(--color-accent)",
			outlineOffset: "2px",
		},
	},
	".cm-search-results": {
		fontSize: "0.75rem",
		color: "var(--color-ink-muted)",
		padding: "0 8px",
		userSelect: "none",
	},
	"button.cm-button": {
		padding: "6px 10px",
		border: "1px solid var(--color-control)",
		borderRadius: "6px",
		backgroundColor: "transparent",
		backgroundImage: "none",
		cursor: "pointer",
		color: "var(--color-ink-muted)",
		fontSize: "0.75rem",
		"&:hover": {
			backgroundColor: "var(--color-accent-wash)",
			borderColor: "var(--color-accent)",
			color: "var(--color-ink)",
		},
	},
	".cm-search label": {
		gap: "8px",
		fontSize: "0.75rem",
		color: "var(--color-ink-muted)",
		cursor: "pointer",
	},
	".cm-search input[type='checkbox']": {
		appearance: "none",
		width: "16px",
		height: "16px",
		transform: "translateY(50%)",
		border: "1px solid var(--color-control)",
		borderRadius: "4px",
		position: "relative",
		cursor: "pointer",
		"&:checked": {
			backgroundColor: "var(--color-accent-wash)",
			borderColor: "var(--color-accent)",
		},
		"&:checked::before": {
			content: "'\\2713'",
			position: "absolute",
			color: "var(--color-accent)",
			backgroundColor: "transparent",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			fontSize: "12px",
		},
	},
};

/*
 * Two finished extensions rather than one built per call: the `dark` flag picks
 * a class rather than a value, so it is the one input that cannot be a CSS
 * variable, and it still selects CodeMirror's own light/dark values for the
 * parts of the panel this spec does not name (`.cm-searchMatch` and the
 * `.cm-panels` wrapper). Being a boolean, it has exactly two builds.
 */
const variants: Record<"light" | "dark", Extension> = {
	light: EditorView.theme(searchSpec, { dark: false }),
	dark: EditorView.theme(searchSpec, { dark: true }),
};

/**
 * The find/replace panel theme for the active palette.
 *
 * @param isDark Whether the active palette is a dark one. Resolve it from the
 *   theme registry (`getTheme(themeName).theme.palette.mode`), which is the
 *   same field `applyThemeToDocument` publishes as the document `dark` class.
 */
export const getSearchTheme = (isDark: boolean): Extension =>
	isDark ? variants.dark : variants.light;
