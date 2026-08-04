import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Theme } from "@mui/material";

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
 */
export const getCodeMirrorTheme = (theme: Theme): Extension => {
	const roles = theme.palette.roles;
	const colors = {
		/* `sunken` rather than `surface`: the role contract names code grounds as
		   the recessed step, and a recessed editor reads as a well in the panel
		   rather than as another card stacked on it. */
		background: roles.sunken,
		foreground: roles.ink,
		selection: roles.accentWash,
		comment: roles.inkDim,
		keyword: roles.accent,
		operator: roles.inkMuted,
		string: roles.success,
		number: roles.warning,
		regexp: roles.danger,
		className: roles.info,
		variableName: roles.ink,
		base: roles.ink,
	};

	const fontFamily = "'Geist Mono', 'Roboto Mono', monospace";

	const editorTheme = EditorView.theme(
		{
			"&": {
				color: colors.foreground,
				backgroundColor: colors.background,
				fontFamily: fontFamily,
				fontSize: theme.typography.pxToRem(11),
				letterSpacing: "0.05em",
			},
			".cm-content": {
				caretColor: roles.accent,
				fontFamily: fontFamily,
			},
			".cm-content *": {
				fontFamily: `${fontFamily} !important`,
			},
			"&.cm-focused .cm-cursor": {
				borderLeftColor: roles.accent,
			},
			"&.cm-focused .cm-selectionBackground, ::selection": {
				backgroundColor: colors.selection,
			},
			".cm-gutters": {
				backgroundColor: colors.background,
				/* `inkDim`, not `inkDisabled`: line numbers are read, and
				   `inkDisabled` is the one role exempt from the contrast floors. */
				color: roles.inkDim,
				border: "none",
				fontFamily: fontFamily,
			},
			".cm-line": {
				fontFamily: fontFamily,
			},
		},
		{ dark: roles.mode === "dark" },
	);

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
		{ tag: t.invalid, color: roles.danger },
	]);

	return [editorTheme, syntaxHighlighting(highlightStyle)];
};
