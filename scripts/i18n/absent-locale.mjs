/**
 * The one synthetic locale for "this key is ABSENT", shared by every test that
 * asserts the runtime's per-key English fallback.
 *
 * WHY THIS EXISTS. A fallback assertion has a premise: the locale selected does
 * not carry the key. Pinning that premise to a REAL tag (`fr`, `es`, `ru`) makes
 * the assertion self-expiring — the day that locale's tranche ships the key,
 * "falls back to English" becomes false and a correct translation fails the
 * suite. That happened five times in one night: `browser-file-transfer-row`,
 * `mesh-tab`, `provider-grid-pin`, `es-activation` and `ru-activation` each
 * tripped when a tranche landed, and each was repaired by hand. `ABSENT_LOCALE`
 * is not a tag any catalogue can ship (shipped locales are the directories under
 * `src/i18n/catalogues/`), so the premise stays true for every future tranche
 * (vi, hi, zh-CN, ur, ...) and the assertion keeps testing the fallback
 * CONTRACT rather than translation progress.
 *
 * WHAT IT IS NOT. It does not mock the fallback. `fixture` carries only the keys
 * a test needs to see translated; every other key still goes through the shipped
 * runtime's real lookup and must land on the English source. A test that wants
 * to prove a tag with NO catalogue still falls back passes an empty fixture.
 */

/** Deliberately not an assigned language tag: ISO 639-1 has no `xx`, and the
 * private-use mechanisms live elsewhere (the `x-` singleton subtag and the
 * `qaa`-`qtz` range), so no catalogue this repository ships can claim it - a
 * shipped tag is a directory under `src/i18n/catalogues/`. */
export const ABSENT_LOCALE = "xx-absent-probe";

/**
 * Register `fixture` under `ABSENT_LOCALE`, switch the active locale to it, and
 * return a function that restores the locale that was active before the call.
 *
 * `i18n` is passed in rather than imported so this module stays dependency-free
 * and works from both shapes the suite has: the `scripts/i18n/*` tests import
 * the real `src/i18n` modules, while feature harnesses (`mesh-tab`,
 * `provider-grid-pin`, `browser-file-transfer-row`) receive the same three
 * functions from an in-memory esbuild bundle. Both expose `currentLocale`,
 * `setLocale` and `registerCatalogue`.
 *
 * Switching the locale can drive React state in a mounted harness, and this
 * module must not import React: call sites that render wrap the call in `act`
 * themselves.
 *
 * IT DOES NOT UNREGISTER ON RESTORE. The runtime has no per-tag removal -
 * `clearRegisteredCatalogues` drops EVERY locale's registered catalogue, which
 * would also discard a harness's own fixtures - so `restore` only switches the
 * locale back; the fixture stays registered under `ABSENT_LOCALE` for the rest
 * of the process. That is inert for the partial fixtures these call sites pass
 * (they carry only the keys a test names, and `es`/`ru`/`hi`/`vi`/`zh-CN` pass
 * an empty one), but two call sites in one process that register DIFFERENT
 * fixtures under the tag will merge, because `registerCatalogue` assigns into
 * the existing entry. A call site that needs a clean store clears it itself
 * with `clearRegisteredCatalogues()` in its cleanup, as the feature harnesses
 * already do.
 */
export function withAbsentLocale(i18n, fixture = {}) {
	const previous = i18n.currentLocale();
	i18n.registerCatalogue(ABSENT_LOCALE, fixture);
	i18n.setLocale(ABSENT_LOCALE);
	return () => i18n.setLocale(previous);
}
