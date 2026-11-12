/**
 * The account profile editor's timezone choices, as `SearchableSelect` options.
 *
 * Extracted from `account-profile-editor.tsx` so the locale rule can be tested
 * without mounting the editor (the editor's DOM test covers behaviour; this
 * module is pure `Intl`).
 *
 * WHY THE LOCALE IS A PARAMETER. The offset shown beside a zone (`GMT+1`,
 * `UTC+1`, `GMT +1`) is spelled by CLDR per locale, so it is UI text and must
 * follow the live locale: the editor previously pinned `en-US`, which left an
 * English `GMT` abbreviation in every other language (the i18n programme's
 * acceptance bar is no English anywhere once a language is chosen). The
 * caller passes `useI18nLocale()` and memoises on it, so a locale switch
 * rebuilds the list; this module never reads the store itself.
 *
 * WHY THE SEARCH TERMS KEEP EN-US. People type what they know ("EST",
 * "GMT+1") whatever language the UI is in, and those spellings are also what
 * every timezone reference they will have read uses. The keywords therefore
 * carry BOTH the live-locale spellings (what the reader sees on screen) and
 * the en-US ones (what they may type). All terms come from `Intl` itself, so
 * there is no table to keep current. A zone `Intl` cannot name simply has
 * fewer terms.
 */
import type { SearchableOption } from "@shared/components/ui/searchable-select";

const zoneName = (format: Intl.DateTimeFormat, at: Date) =>
	format.formatToParts(at).find((part) => part.type === "timeZoneName")?.value;

/** The en-US spellings are the search vocabulary regardless of the UI locale. */
const SEARCH_LOCALE = "en-US";

/**
 * Every IANA zone (plus `UTC`) as an option for `locale`.
 *
 * `now` is the instant the offset is evaluated at — "now" by default, which is
 * what a reader setting their zone today means (DST included); tests pass a
 * fixed instant so they do not depend on the season.
 */
export function timezoneOptions(
	locale: string,
	now: Date = new Date(),
): SearchableOption[] {
	return [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])].map(
		(zone) => {
			const spell = (tag: string, timeZoneName: "shortOffset" | "short") =>
				zoneName(
					new Intl.DateTimeFormat(tag, { timeZone: zone, timeZoneName }),
					now,
				);
			const offset = spell(locale, "shortOffset");
			const keywords = [
				...new Set(
					[
						offset,
						spell(locale, "short"),
						spell(SEARCH_LOCALE, "shortOffset"),
						spell(SEARCH_LOCALE, "short"),
					].filter((term): term is string => Boolean(term) && term !== zone),
				),
			];
			return {
				id: zone,
				name: zone.split("_").join(" "),
				description: offset,
				keywords,
			};
		},
	);
}
