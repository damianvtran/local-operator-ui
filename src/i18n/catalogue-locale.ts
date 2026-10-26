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
 * macrolanguage whose script decides the copy, and an EXPLICIT script subtag
 * outranks the region: `zh-Hans` (and `zh`, `zh-CN`, `zh-SG` — no script subtag
 * and no Traditional region) maps to the `zh-CN` bundle, including inside a
 * Traditional region (`zh-Hans-HK`, `zh-Hans-TW`), because those tags ask for
 * Simplified copy. `zh-Hant` and the regions that write it (`zh-TW`, `zh-HK`,
 * `zh-MO`) resolve to ENGLISH: this client ships no Traditional catalogue, and
 * showing Simplified copy as if it were Traditional is worse than showing the
 * source locale — the same judgement `./direction` makes about `lang`
 * ("rewriting `zh-TW` to `zh-CN` would claim a script the user did not choose").
 * Any OTHER script subtag (`zh-Latn`, `zh-Bopo`) is Chinese in writing this
 * client carries no catalogue for, and a non-Mandarin extlang (`zh-yue`,
 * Cantonese) is not the same language as the Mandarin copy in `zh-CN`; both
 * resolve to English rather than being shown Simplified Han. `zh-HK`/`zh-MO`
 * are the one deliberate difference from the core: `normalise_locale` maps them
 * through its literal `zh` rule to Simplified and notes the question is open
 * ("the wave review revisits them"). Until it does, this bootstrap prefers
 * English for a script it cannot serve. Once the backend answers, its resolved
 * `language` wins outright (`./locale`), so this rule never overrides a
 * negotiated answer.
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

/** The script subtag naming Simplified Han — the writing the `zh-CN` bundle carries. */
const SIMPLIFIED_SCRIPT = "hans";

/**
 * The Mandarin extlang. It is the one Chinese variety whose copy the Simplified
 * catalogue serves; any other extlang after `zh` (`zh-yue`, Cantonese) names a
 * language this client does not carry.
 */
const MANDARIN_EXTLANG = "cmn";

/** BCP-47 script subtag: four ASCII letters (`hans`, `hant`, `latn`). */
const SCRIPT_SUBTAG = /^[a-z]{4}$/;

/** BCP-47 extlang subtag: three ASCII letters directly after the primary (`yue`). */
const EXTLANG_SUBTAG = /^[a-z]{3}$/;

/**
 * Regions that write Traditional by default (`zh-TW`, `zh-HK`, `zh-MO`). See the
 * docstring for why these resolve to English rather than to the Simplified
 * catalogue.
 */
const TRADITIONAL_REGIONS = new Set(["tw", "hk", "mo"]);

/**
 * The Simplified catalogue, read through the map rather than as a bare literal:
 * this function's contract is a tag `bundledCatalogues` carries, so a tree
 * without the Simplified directory degrades to the source locale instead of
 * naming a catalogue that is gone.
 */
function simplifiedCatalogue(): string {
	return byLoweredTag.get(CHINESE_SIMPLIFIED.toLowerCase()) ?? DEFAULT_LOCALE;
}

/**
 * The catalogue locale for `tag`, or `en` when this client carries none.
 *
 * Pure and total over strings: it never throws and always names a tag present in
 * `bundledCatalogues`, which is what lets the render path use it inline. A
 * non-string from an untyped `.mjs` harness resolves to the source locale
 * instead of throwing at `trim()`.
 */
export function resolveCatalogueLocale(tag: string): string {
	/*
	 * Untyped `.mjs` harnesses import this module directly, so a non-string is a
	 * runtime possibility even though typed callers cannot pass one.
	 */
	if (typeof tag !== "string") return DEFAULT_LOCALE;

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
		const subtags = parts.slice(1).map((part) => part.toLowerCase());
		/*
		 * An EXTLANG (three alphabetic letters directly after the primary) names a
		 * language variety, not a script: `zh-yue` is Cantonese, and Mandarin copy
		 * is the wrong language for it. `zh-cmn` is Mandarin, the same copy as `zh`,
		 * so it falls through to the script and region rules below.
		 */
		const extlang = subtags[0];
		if (
			extlang !== undefined &&
			EXTLANG_SUBTAG.test(extlang) &&
			extlang !== MANDARIN_EXTLANG
		) {
			return DEFAULT_LOCALE;
		}
		/*
		 * An explicit script outranks the region: `zh-Hans-HK` and `zh-Hans-TW` ask
		 * for Simplified copy inside a Traditional region. Any script other than
		 * `hans` — `hant` included — is writing this client carries no catalogue
		 * for, so it resolves to the source locale, never to Simplified Han.
		 */
		const script = subtags.find((subtag) => SCRIPT_SUBTAG.test(subtag));
		if (script !== undefined) {
			return script === SIMPLIFIED_SCRIPT
				? simplifiedCatalogue()
				: DEFAULT_LOCALE;
		}
		/*
		 * No script subtag: a Traditional-writing region still must not be shown
		 * Simplified copy, so it takes the source locale.
		 */
		for (const region of TRADITIONAL_REGIONS) {
			if (subtags.includes(region)) return DEFAULT_LOCALE;
		}
		return simplifiedCatalogue();
	}

	/*
	 * Primary-subtag match, the same shape `setting-control.tsx`'s
	 * `languageIdentifierFor` uses to name a served tag: `fr-CA` reads French
	 * copy. It is not a region preference — the catalogues are per language.
	 *
	 * The rule is stated, not inherited from directory order: the bare primary tag
	 * wins when the catalogue set carries one, otherwise the lexicographically
	 * first regional tag. `byLoweredTag` is in generator order, and no language
	 * carries two catalogues today; the day one does, the answer above must be a
	 * decision rather than whichever directory was walked first.
	 */
	const bare = byLoweredTag.get(primary);
	if (bare !== undefined) return bare;
	let regional: string | undefined;
	for (const [lowered, catalogueTag] of byLoweredTag) {
		if (lowered.split("-")[0] !== primary) continue;
		if (regional === undefined || catalogueTag < regional)
			regional = catalogueTag;
	}
	return regional ?? DEFAULT_LOCALE;
}
