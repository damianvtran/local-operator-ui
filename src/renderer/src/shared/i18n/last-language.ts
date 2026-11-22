/**
 * The renderer's cache of the language the BACKEND last confirmed.
 *
 * WHY IT EXISTS (fr census, row 2). Before `GET /v1/capabilities` answers -
 * the server is down, still booting, or the app opened offline - the locale
 * store falls back to the device language. A French reader on an English OS
 * therefore saw the offline error, its Retry and the whole shell in English at
 * exactly the moment the app was explaining a failure. Keeping the backend's
 * last answer locally lets the boot render in the language they chose.
 *
 * WHAT IT IS NOT: a preference. Nothing here lets the UI choose a language.
 * The value is written ONLY from a capabilities answer the backend resolved
 * (`useI18nLocaleSync`), read ONLY at boot, and replaced by the store the
 * moment this launch's backend answers (`applyRememberedLanguage` refuses to
 * override a `backend` state). The backend `language` setting stays the one
 * owner (docs/I18N.md); a choice made while the app was closed (TUI, config
 * edit) shows after the first answer, as before.
 *
 * WHY localStorage. It hydrates synchronously, so the tag is in the store
 * before the first frame - the same reason the theme preferences publish from
 * it at module scope in `main.tsx`. Every renderer window of the app shares
 * one origin, so the mini view reads the main window's last answer too.
 */

import {
	applyRememberedLanguage,
	isLanguageTag,
} from "../../../../i18n/locale";

/** The storage key. Namespaced so it cannot collide with a feature's store. */
export const LAST_BACKEND_LANGUAGE_KEY = "lop.i18n.lastBackendLanguage";

/** The slice of `Storage` used here, so tests pass a plain object. */
export type LanguageStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The page's localStorage, or null where there is none (a node test host) or
 * where reading it throws (a sandboxed/opaque origin). Either way the boot
 * degrades to the device locale, never to an exception at import.
 */
function pageStorage(): LanguageStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** The last backend-confirmed tag, or undefined if absent or malformed. */
export function readLastBackendLanguage(
	storage: LanguageStorage | null = pageStorage(),
): string | undefined {
	try {
		const value = storage?.getItem(LAST_BACKEND_LANGUAGE_KEY);
		return isLanguageTag(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Record a tag the backend just resolved. Skips an unchanged value (the
 * capabilities query re-polls) and swallows a full/blocked store: losing the
 * cache only costs the next offline boot its language, never the session.
 */
export function rememberBackendLanguage(
	tag: string,
	storage: LanguageStorage | null = pageStorage(),
): void {
	if (!isLanguageTag(tag)) return;
	try {
		if (storage?.getItem(LAST_BACKEND_LANGUAGE_KEY) === tag) return;
		storage?.setItem(LAST_BACKEND_LANGUAGE_KEY, tag);
	} catch {
		// Quota or a blocked store: see above.
	}
}

/**
 * Boot step for a renderer entry: put the remembered tag in the store before
 * the first render. Returns whether a tag was applied (diagnostics, tests).
 */
export function restoreLastBackendLanguage(
	storage: LanguageStorage | null = pageStorage(),
): boolean {
	const tag = readLastBackendLanguage(storage);
	return tag === undefined ? false : applyRememberedLanguage(tag);
}
