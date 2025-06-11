import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { Theme } from "@mui/material";

export const getCodeMirrorTheme = (theme: Theme): Extension => {
	const colors = {
		background: theme.palette.background.paper,
		foreground: theme.palette.text.primary,
		selection: theme.palette.action.selected,
		comment: theme.palette.text.secondary,
		keyword: theme.palette.secondary.main,
		operator: theme.palette.text.secondary,
		string: theme.palette.primary.main,
		number: "#ae81ff", // Monokai purple
		regexp: "#e6db74", // Monokai yellow
		className: "#a6e22e", // Monokai green
		variableName: theme.palette.text.primary,
		base: theme.palette.text.primary,
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
				caretColor: theme.palette.primary.main,
				fontFamily: fontFamily,
			},
			".cm-content *": {
				fontFamily: `${fontFamily} !important`,
			},
			"&.cm-focused .cm-cursor": {
				borderLeftColor: theme.palette.primary.main,
			},
			"&.cm-focused .cm-selectionBackground, ::selection": {
				backgroundColor: colors.selection,
			},
			".cm-gutters": {
				backgroundColor: colors.background,
				color: theme.palette.text.disabled,
				border: "none",
				fontFamily: fontFamily,
			},
			".cm-line": {
				fontFamily: fontFamily,
			},
		},
		{ dark: theme.palette.mode === "dark" },
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
		{ tag: t.invalid, color: theme.palette.error.main },
	]);

	return [editorTheme, syntaxHighlighting(highlightStyle)];
};
