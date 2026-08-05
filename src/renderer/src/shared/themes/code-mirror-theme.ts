import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * The editor's syntax colours, taken from the theme's roles.
 *
 * Every hue here is an authored, contrast-checked role rather than a literal.
 * This used to hardcode three Monokai values — a purple, a yellow and a green
 * — so every theme's editor was partly Monokai, and on the two light themes
 * those three landed at roughly 2:1 on the editor ground.
 *
 * Five hues is the whole budget: the semantic four plus the accent. Anything
 * finer would need colours no palette authors, and inventing them per theme is
 * what this port removed.
 *
 * The roles arrive as `var(--color-*)` rather than as resolved values, because
 * `EditorView.theme` and `HighlightStyle.define` both compile to real CSS and
 * the browser resolves the variables at paint. So the editor follows a theme
 * swap on its own, the extensions below are built once at import, and nothing
 * here has to be re-run — or even observed — by React.
 */
const colors = {
	/* `sunken` rather than `surface`: the role contract names code grounds as
	   the recessed step, and a recessed editor reads as a well in the panel
	   rather than as another card stacked on it. */
	background: "var(--color-sunken)",
	foreground: "var(--color-ink)",
	selection: "var(--color-accent-wash)",
	comment: "var(--color-ink-dim)",
	keyword: "var(--color-accent)",
	operator: "var(--color-ink-muted)",
	string: "var(--color-success)",
	number: "var(--color-warning)",
	regexp: "var(--color-danger)",
	className: "var(--color-info)",
	variableName: "var(--color-ink)",
	base: "var(--color-ink)",
} as const;

/*
 * The app's mono stack, read from the token rather than restated.
 *
 * This used to hardcode "'Geist Mono', 'Roboto Mono', monospace", which is a
 * second source of truth for the one decision that makes machine voice read as
 * machine voice. It had already drifted from `--font-mono` in index.css, so
 * the editor and the surrounding trace could resolve different faces - and the
 * whole reason `--font-mono` was corrected was that mono was splitting across
 * two faces. A CSS variable works here because CodeMirror emits real
 * stylesheets, not canvas text.
 */
const fontFamily = "var(--font-mono)";

/**
 * The editor chrome. Shared by both variants below, so the light and dark
 * builds differ only in the flag CodeMirror keys its own base theme off.
 *
 * `0.6875rem` is the 11px this used to compute through `pxToRem`; the app root
 * is 16px, and the editor sits one step below the 13px/12px mono ramp on
 * purpose — a file view is scanned in bulk, not read a line at a time.
 */
const editorSpec = {
	"&": {
		color: colors.foreground,
		backgroundColor: colors.background,
		fontFamily: fontFamily,
		fontSize: "0.6875rem",
		letterSpacing: "0.05em",
	},
	".cm-content": {
		caretColor: "var(--color-accent)",
		fontFamily: fontFamily,
	},
	".cm-content *": {
		fontFamily: `${fontFamily} !important`,
	},
	/*
	 * The editor's focus ring, drawn on the root rather than the content.
	 *
	 * CodeMirror's own base theme sets `.cm-content { outline: none }` and
	 * `.cm-editor.cm-focused { outline: 1px dotted #212121 }`. Both ship from
	 * node_modules, so the app's contrast gate cannot see either of them, and
	 * that hardcoded near-black measures 1.02:1 on dracula and 1.03:1 on
	 * monokai - on nine of the twelve palettes it is under 1.30:1, which is to
	 * say invisible. The content rule also lands at two-class specificity once
	 * CodeMirror prefixes it with the generated theme class, so the app's
	 * unlayered `html :focus-visible` at (0,1,1) loses to it.
	 *
	 * Styling `&.cm-focused` puts the ring on the editor root at
	 * `.cm-editor.<generated>.cm-focused`, which beats CodeMirror's own
	 * two-class default and matches how every other composite control in this
	 * app works: the frame draws the ring, the field inside stays quiet.
	 *
	 * The offset is NEGATIVE, and that is the whole point of this rule working.
	 * The editor sits flush inside a `relative h-full grow overflow-auto`
	 * container in `code-editor.tsx`, and an outline is ink overflow: a scroll
	 * container clips it at the padding box exactly as it clips an outset
	 * shadow. At `+2px` the ring's outer edge lands 4px outside the clip box
	 * and is cut on the left, top and right - leaving only a bottom sliver on a
	 * short document, which reads as a stray border rather than as focus.
	 * Drawing it inset puts the whole ring inside the clip.
	 *
	 * This is the second time that clipping rule has caught this codebase; the
	 * first was a comment in `styles/index.css` asserting the opposite, which
	 * was corrected one commit before this ring was written. Believing the
	 * wrong version for an hour is what produced the +2px.
	 */
	"&.cm-focused": {
		outline: "2px solid var(--color-accent)",
		outlineOffset: "-2px",
	},
	"&.cm-focused .cm-cursor": {
		borderLeftColor: "var(--color-accent)",
	},
	"&.cm-focused .cm-selectionBackground, ::selection": {
		backgroundColor: colors.selection,
	},
	".cm-gutters": {
		backgroundColor: colors.background,
		/* `inkDim`, not `inkDisabled`: line numbers are read, and
		   `inkDisabled` is the one role exempt from the contrast floors. */
		color: "var(--color-ink-dim)",
		border: "none",
		fontFamily: fontFamily,
	},
	".cm-line": {
		fontFamily: fontFamily,
	},
};

const highlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: colors.keyword },
	{
		tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
		color: colors.base,
	},
	{
		tag: [t.function(t.variableName), t.labelName],
		color: colors.foreground,
	},
	{
		tag: [t.color, t.constant(t.name), t.standard(t.name)],
		color: colors.foreground,
	},
	{ tag: [t.definition(t.name), t.separator], color: colors.foreground },
	{
		tag: [
			t.typeName,
			t.className,
			t.number,
			t.changed,
			t.annotation,
			t.modifier,
			t.self,
			t.namespace,
		],
		color: colors.className,
	},
	{
		tag: [
			t.operator,
			t.operatorKeyword,
			t.url,
			t.escape,
			t.regexp,
			t.link,
			t.special(t.string),
		],
		color: colors.regexp,
	},
	{ tag: [t.meta, t.comment], color: colors.comment },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.strikethrough, textDecoration: "line-through" },
	{ tag: t.link, color: colors.comment, textDecoration: "underline" },
	{ tag: t.heading, fontWeight: "bold", color: colors.foreground },
	{
		tag: [t.atom, t.bool, t.special(t.variableName)],
		color: colors.foreground,
	},
	{
		tag: [t.processingInstruction, t.string, t.inserted],
		color: colors.string,
	},
	{ tag: t.invalid, color: colors.regexp },
]);

/*
 * Two finished extensions rather than one built per call.
 *
 * The `dark` flag is not cosmetic and could not be dropped: it feeds
 * `EditorView.darkTheme`, which is what selects CodeMirror's *own* built-in
 * light/dark values for `.cm-activeLine`, `.cm-specialChar`, the unfocused
 * `.cm-selectionBackground`, `.cm-tooltip` (the completion popup) and
 * `.cm-searchMatch` — all of them live here, since `basicSetup` is on. It is
 * also the one input that cannot be a CSS variable, because it picks a class
 * rather than a value. Since it is a boolean there are exactly two possible
 * builds, so both are made once and handed out by lookup: callers get a stable
 * extension identity and no `useMemo`.
 */
const variants: Record<"light" | "dark", Extension> = {
	light: [
		EditorView.theme(editorSpec, { dark: false }),
		syntaxHighlighting(highlightStyle),
	],
	dark: [
		EditorView.theme(editorSpec, { dark: true }),
		syntaxHighlighting(highlightStyle),
	],
};

/**
 * The editor theme for the active palette.
 *
 * @param isDark Whether the active palette is a dark one. Resolve it from the
 *   theme registry (`getTheme(themeName).theme.palette.mode`), which is the
 *   same field `applyThemeToDocument` publishes as the document `dark` class.
 */
export const getCodeMirrorTheme = (isDark: boolean): Extension =>
	isDark ? variants.dark : variants.light;
