/**
 * The document root's `dir` and `lang`, kept in step with the active locale.
 *
 * WHY A HOOK AND NOT A ONE-SHOT WRITE AT BOOT: the locale changes at runtime in
 * two product paths — the capabilities answer replaces the device locale after
 * the first backend read, and a language written from another surface arrives on
 * the desktop feed — and language is also changed from Settings without a reload.
 * The root attributes have to follow every one of those, so they are derived from
 * the same external store the rest of the interface reads (`./use-locale`) and
 * written from an effect keyed on it. Mounted once, in `App`, like the window
 * chrome and the locale writer beside it: one document, one writer.
 *
 * WHY `useLayoutEffect`: direction changes layout, not paint. Committing it after
 * the browser has painted would show one frame of LTR Urdu between the store
 * change and the attribute, so it is written before paint.
 */

import { useLayoutEffect } from "react";

import {
	type TextDirection,
	resolveLanguage,
	textDirectionFor,
} from "../../../../i18n/direction";
import { useI18nLocale } from "./use-locale";

/**
 * Write the resolved direction and language onto a document root.
 *
 * Exported so the behaviour is assertable against a plain element without
 * mounting React; the hook below is the only production caller.
 */
export function applyDocumentDirection(root: Element, locale: string): void {
	const { lang, dir } = resolveLanguage(locale);
	root.setAttribute("dir", dir);
	root.setAttribute("lang", lang);
}

/** The active writing direction, re-rendering the caller when it changes. */
export function useTextDirection(): TextDirection {
	return textDirectionFor(useI18nLocale());
}

/** Keep `<html dir lang>` on the active locale. Renders nothing. */
export function useDocumentDirection(): void {
	const locale = useI18nLocale();
	useLayoutEffect(() => {
		applyDocumentDirection(document.documentElement, locale);
	}, [locale]);
}
