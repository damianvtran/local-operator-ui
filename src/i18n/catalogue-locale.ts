/**
 * Which bundled catalogue answers a locale tag — the canonicalisation step the
 * copy runtime applies BEFORE a lookup.
 *
 * WHY THIS EXISTS (device-tag bug). The locale store keeps the device's tag
 * verbatim (`./locale`: `navigator.language` is `fr-FR`, `es-MX`, `ur-PK`), and
 * `t()` used to key its catalogue maps with exactly that string. No bundle is
 * ever named `fr-FR` — the catalogues are `src/i18n/catalogues/<locale>/` with
 * the programme's own spellings (`i18n/languages.json`) — so every key missed
 * and fell through to the English source: a French, Spanish, Russian, Hindi,
 * Urdu or Vietnamese device rendered English until a backend answered. Nothing
 * logged it, because a per-key English fallback is the correct behaviour for a
 * locale that genuinely lacks a translation.
 *
 * THE RULE MIRRORS THE BACKEND'S `normalise_locale`
 * (`local_operator/i18n/resolve.py`), which is the single owner of this
 * vocabulary (§2.5): the tag is trimmed, its encoding/modifier suffixes
 * (`.UTF-8`, `@euro`) dropped and `_` read as `-`; an exact catalogue tag wins
 * (case-insensitively — `FR` and `zh-cn` are the same tag), otherwise the
 * primary language subtag is matched (`fr-CA` -> `fr`, `es-MX` -> `es`,
 * `ur-PK` -> `ur`); anything with no catalogue falls back to `en`. Matching
 * against the GENERATED `bundledCatalogues` keys rather than a hand list means
 * a new locale directory is still one edit in one place: the generator adds the
 * key and this rule picks it up.
 *
 * CHINESE IS THE ONE BRANCH THAT CANNOT BE PRIMARY-SUBTAG ONLY. `zh` is a
 * macrolanguage whose script decides the copy: `zh-CN`, `zh-Hans` and `zh-SG`
 * are Simplified and map to the `zh-CN` bundle; `zh-TW`, `zh-Hant`, `zh-HK` and
 * `zh-MO` are Traditional, and this client ships no Traditional catalogue, so
 * they resolve to ENGLISH rather than to Simplified. Showing Simplified copy as
 * if it were Traditional is worse than showing the source locale — the same
 * judgement `./direction` makes about `lang` ("rewriting `zh-TW` to `zh-CN`
 * would claim a script the user did not choose"). `zh-HK`/`zh-MO` are the one
 * deliberate difference from the core: `normalise_locale` maps them through its
 * literal `zh` rule to Simplified and notes the question is open ("the wave
 * review revisits them"). Until it does, this bootstrap prefers English for a
 * script it cannot serve. Once the backend answers, its resolved `language`
 * wins outright (`./locale`), so this rule never overrides a negotiated answer.
 *
 * WHAT THIS IS NOT. It does not decide eligibility (the backend's shipped set
 * does) and it does not rewrite the ACTIVE tag: `document.documentElement.lang`
 * and text direction keep reading the caller's own tag (`./direction`), and a
 * region still formats through Intl with its region. It answers one question —
 * which catalogue can hold this tag's copy. A tag carrying an extension or
 * private-use sequence (`fr-x-source-fallback`, `en-u-ca-buddhist`) answers
 * NONE: a singleton subtag says the tag's content is not plain base-language
 * copy, and this client implements no extension, so the source locale is the
 * honest answer — never a guess at the base language.
 */

import { bundledCatalogues } from "./keys.gen";
import { DEFAULT_LOCALE } from "./locale";

/**
 * The catalogue tags this client carries, lower-cased for exact matching.
 * `bundledCatalogues` is generated from the present `catalogues/<locale>/`
 * directories, so `en` is always a member.
 */
const byLoweredTag = new Map(
	Object.keys(bundledCatalogues).map((tag) => [tag.toLowerCase(), tag]),
);

/** The macro-language whose script, not region alone, chooses the catalogue. */
const CHINESE_PRIMARY = "zh";

/** The Simplified catalogue the Chinese branch maps to unless script says otherwise. */
const CHINESE_SIMPLIFIED = "zh-CN";

/**
 * Subtags that mark Traditional script: the script itself and the three regions
 * that write it (`zh-TW`, `zh-HK`, `zh-MO`). See the docstring for why these
 * resolve to English rather than to the Simplified catalogue.
 */
const TRADITIONAL_SUBTAGS = new Set(["hant", "tw", "hk", "mo"]);

/**
 * The catalogue locale for `tag`, or `en` when this client carries none.
 *
 * Pure and total: it never throws and always names a tag present in
 * `bundledCatalogues`, which is what lets the render path use it inline.
 */
export function resolveCatalogueLocale(tag: string): string {
	/*
	 * The same cleanup the backend's normaliser performs: `en_US.UTF-8` and
	 * `fr_CA@euro` are POSIX spellings of tags this function also receives from
	 * `setLocale` fixtures, and a trailing empty subtag (`fr-`) is not a match
	 * for anything.
	 */
	const cleaned = tag
		.trim()
		.split(".", 1)[0]
		.split("@", 1)[0]
		.replace(/_/g, "-");
	const parts = cleaned.split("-").filter((part) => part !== "");
	const primary = parts[0]?.toLowerCase();
	if (primary === undefined || primary === "") return DEFAULT_LOCALE;

	/*
	 * A single-character subtag is BCP-47's singleton: it starts an extension
	 * (`-u-ca-buddhist`, `-t-…`) or the private-use sequence (`-x-…`). Such a tag
	 * is not a plain request for the base language's copy — the extension can
	 * change content this client does not implement — so it resolves to the
	 * source locale. This is also the premise of the fixture tags the suites use
	 * to prove the per-key fallback (`fr-x-source-fallback` in
	 * `features/settings/settings-i18n.test.mjs`, ABSENT_LOCALE in
	 * `scripts/i18n/absent-locale.mjs`): a tag with no catalogue must keep
	 * falling back to English, or those suites are silently asserting French.
	 */
	if (parts.slice(1).some((part) => part.length === 1)) return DEFAULT_LOCALE;

	const exact = byLoweredTag.get(cleaned.toLowerCase());
	if (exact !== undefined) return exact;

	if (primary === CHINESE_PRIMARY) {
		const modifiers = new Set(parts.slice(1).map((part) => part.toLowerCase()));
		for (const subtag of TRADITIONAL_SUBTAGS) {
			if (modifiers.has(subtag)) return DEFAULT_LOCALE;
		}
		// Through the map, not as a bare literal: this function's contract is a tag
		// `bundledCatalogues` carries, so a tree without the Simplified directory
		// degrades to the source locale instead of naming a catalogue that is gone.
		return byLoweredTag.get(CHINESE_SIMPLIFIED.toLowerCase()) ?? DEFAULT_LOCALE;
	}

	/*
	 * Primary-subtag match, the same shape `setting-control.tsx`'s
	 * `languageIdentifierFor` uses to name a served tag: `fr-CA` reads French
	 * copy. It is not a region preference — the catalogues are per language.
	 */
	for (const [lowered, catalogueTag] of byLoweredTag) {
		if (lowered.split("-")[0] === primary) return catalogueTag;
	}
	return DEFAULT_LOCALE;
}
