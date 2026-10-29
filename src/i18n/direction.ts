/**
 * Text direction and document language, read from the language manifest.
 *
 * WHY THE MANIFEST AND NOT A CODE CHECK (`locale === "ur"`): `i18n/languages.json`
 * is the programme's single list of the languages the product ships or intends to
 * ship, and each entry already carries its `dir`. A hardcoded RTL list here would
 * be a second copy of that fact, and the failure it hides is silent: a future
 * Arabic, Hebrew or Persian catalogue would translate the copy and keep laying the
 * whole interface out left-to-right, because nobody remembered this file. Reading
 * the manifest means adding a locale is still one edit in one place.
 *
 * TAGS ARRIVE UN-NORMALISED. Before a backend answer the locale store keeps the
 * device's own tag verbatim (`en-US`, `ur-PK`, `fr-CA` — see `./locale`), so the
 * lookup is exact match first and then a primary-subtag match used ONLY to pick
 * the direction. Direction is a property of the language, not the region, so
 * `ur-PK` is RTL while `zh-TW` is LTR — but `lang` keeps the tag the caller
 * supplied: rewriting `zh-TW` to `zh-CN` would claim a script the user did not
 * choose, and a bare `zh` on a Traditional Chinese device is not Simplified.
 * An unshipped tag falls back to LTR rather than to a guess, which is also the
 * DOM's own default; an RTL language becomes supported by adding its manifest
 * entry, never by extending a code list here.
 */

import manifest from "../../i18n/languages.json";

export type TextDirection = "ltr" | "rtl";

/** The subset of a manifest entry this module reads. */
type ManifestLanguage = {
	code: string;
	dir: string;
};

const languages = manifest.languages as readonly ManifestLanguage[];

export type LanguageResolution = {
	/**
	 * The manifest's canonical code when the tag matches an entry, else the tag
	 * itself: an unshipped device tag (`en-US`) is still a valid BCP-47 `lang`.
	 */
	lang: string;
	dir: TextDirection;
};

/**
 * Resolve a locale tag to the `lang`/`dir` pair the document root should carry.
 *
 * The empty tag is the one case that cannot be a valid `lang` attribute, so it
 * takes the source locale rather than rendering `lang=""` (which a screen reader
 * would read in the wrong voice).
 */
export function resolveLanguage(tag: string): LanguageResolution {
	const trimmed = tag.trim();
	if (trimmed === "") return { lang: "en", dir: "ltr" };

	const lower = trimmed.toLowerCase();
	const exact = languages.find(
		(language) => language.code.toLowerCase() === lower,
	);
	const primary = lower.split("-")[0];
	const matched =
		exact ??
		languages.find(
			(language) => language.code.split("-")[0].toLowerCase() === primary,
		);

	return {
		/*
		 * The exact entry's code is canonical (`zh-CN` stays `zh-CN`). A
		 * primary-subtag match answers DIRECTION only and leaves the caller's tag
		 * alone (`ur-PK` stays `ur-PK`, `zh-TW` stays `zh-TW`).
		 */
		lang: exact?.code ?? trimmed,
		dir: matched?.dir === "rtl" ? "rtl" : "ltr",
	};
}

/** The writing direction for a locale tag. */
export function textDirectionFor(tag: string): TextDirection {
	return resolveLanguage(tag).dir;
}
