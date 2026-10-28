/**
 * Where the UI's locale comes from (RFC §2.5, §3.2).
 *
 * After a backend is reachable the renderer uses the RESOLVED language from
 * `GET /v1/capabilities` (`language`, gated on `features.i18n`); before one is
 * reachable it uses the device locale. Those are the RFC's two documented
 * sources for this surface (the third, `LOP_LANG`, is backend/exec-side).
 *
 * The backend's resolver already normalises a raw preference to a SHIPPED
 * locale tag (`fr-CA` -> `fr`, an unsupported preference -> `en`), so this
 * module trusts a non-empty `language` verbatim and does not re-filter: a
 * second copy of that rule would drift from the resolver that owns it
 * (`local_operator/i18n/resolve.py`).
 *
 * The device fallback returns `navigator.language` AS IT IS — deliberately
 * un-normalised. Every call site this mechanism replaces read exactly that
 * value, so a pre-connection render is byte-identical to the tree before the
 * mechanism existed; the swap to the backend's tag after the first answer is
 * the one move this module makes, and `en` is measured identical to the app's
 * `en-US` for every option set the migrated sites pass
 * (`scripts/i18n/format.test.mjs` pins that equivalence).
 *
 * A RAW TAG IS NOT A CATALOGUE TAG. Keeping the device's spelling costs nothing
 * where the tag is only data — `document.documentElement.lang` and text
 * direction want `fr-FR`/`ur-PK` (`./direction`), and Intl formatters read the
 * region — but no catalogue is named `fr-FR`, so the COPY runtime canonicalises
 * the tag before a lookup (`./catalogue-locale`). The store therefore answers
 * "which tag is active"; it does not answer "which catalogue holds it".
 *
 * This module is framework-free on purpose: the React binding lives in
 * `src/renderer/src/shared/i18n/use-locale.ts`, and the main process gets its
 * own catalogue later (RFC §3.2) without importing renderer code. It is also
 * `lib`-free of DOM types (`globalThis` is read through a narrow cast), so the
 * main-process tsconfig can include it when that slice lands.
 */

/** The capabilities fields this module reads; the wire type is a superset. */
export type LocaleCapabilities = {
	features?: Record<string, number> | null;
	language?: string | null;
};

/**
 * Where the current locale came from. Diagnostics and tests read it.
 *
 * `manual` is an explicit `setLocale` pin — tests and fixtures today, the
 * in-app language override this seam exists for tomorrow — so it stays a
 * source of its own rather than borrowing `device`'s name (round-1 review,
 * R1-5). Precedence between a manual pin and a later capabilities answer is
 * the override slice's decision; today a capabilities answer re-resolves the
 * store.
 */
export type LocaleSource = "backend" | "device" | "default" | "manual";

export type LocaleState = {
	/**
	 * A BCP-47 tag: the backend's resolved tag, or the device's own. The copy
	 * runtime canonicalises it before a catalogue lookup (`./catalogue-locale`),
	 * so this is not necessarily a catalogue spelling.
	 */
	locale: string;
	source: LocaleSource;
};

/** The feature key gating the served-catalogue contract (RFC §2.1). */
export const I18N_FEATURE = "i18n";

/** The source locale, and where a locale that nothing can answer lands. */
export const DEFAULT_LOCALE = "en";

/**
 * The backend registry key the language control edits (U1).
 *
 * The SAME setting every surface writes — `config.yml`, the TUI's `/settings`
 * and the desktop's row — and the one the capabilities chain above reads back
 * as `language`: one value, one owner, no per-surface override (the slice's
 * contract). The string mirrors the backend's own names for it —
 * `settings_io`'s `Setting(key="language")` and `i18n/resolve.py`'s
 * `CONFIG_KEY` — and exists here so the renderer never spells the key itself.
 */
export const LANGUAGE_SETTING_KEY = "language";

/**
 * The device's language tag, or `undefined` where there is no navigator.
 *
 * The cast keeps DOM types out of this module (see the docstring above): under
 * a main-process tsconfig there is no `navigator` to name, and under some test
 * hosts the read is a real runtime hole, not a typing one.
 */
function deviceLanguage(): string | undefined {
	const navigatorLike = (globalThis as { navigator?: { language?: unknown } })
		.navigator;
	const language = navigatorLike?.language;
	return typeof language === "string" && language.trim() !== ""
		? language
		: undefined;
}

/** Whether the backend advertises the i18n contract (RFC §2.1). */
function i18nFeatureEnabled(
	features: Record<string, number> | null | undefined,
): boolean {
	return (features?.[I18N_FEATURE] ?? 0) >= 1;
}

/**
 * Whether a string is a structurally plausible BCP-47 language tag.
 *
 * WHY THIS EXISTS AT ALL. `resolveLocale` trusts a backend's tag verbatim, and
 * that is right for the renderer: the backend's resolver normalises a raw
 * preference to a SHIPPED tag, so a second copy of its rules would drift. The
 * MAIN process has a second source the renderer never had - an install marker
 * on disk and Electron's own locale readings - and a value from either reaches
 * `Intl`/ICU formatters. A tag with a space, a slash or an empty string makes
 * those throw or fall back mid-render, and the marker is a file a user or a
 * stale version can write. So the STRUCTURE is checked here, once, while the
 * choice of tag (and its eligibility) stays with the resolver that owns it.
 *
 * Deliberately permissive: language (2-8 alpha), then subtags of 1-8
 * alphanumerics, which covers `en`, `fr-CA`, `zh-Hans-CN`, `es-419` and script
 * or region extensions without claiming to validate the registry.
 */
export function isLanguageTag(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.trim()) &&
		value === value.trim()
	);
}

/**
 * The locale a `GET /v1/capabilities` answer resolves to, ignoring the store.
 *
 * Exported for tests, which assert the truth table directly: an answer with
 * `features.i18n` and a non-empty `language` is the backend source; anything
 * else (no answer, an older backend without the feature, a blank tag) falls
 * back to the device.
 *
 * `deviceTag` is the MAIN process's explicit device reading. The renderer
 * passes none and keeps reading `navigator.language` as it is (the unnormalised
 * value every migrated call site used to read); main reads Electron's own
 * preferred-system-languages chain and hands the winner here, which is the one
 * difference the two processes are allowed to have about "the device".
 */
export function resolveLocale(
	capabilities?: LocaleCapabilities | null,
	deviceTag?: string,
): LocaleState {
	const language = capabilities?.language;
	if (
		i18nFeatureEnabled(capabilities?.features) &&
		typeof language === "string" &&
		language.trim() !== ""
	) {
		return { locale: language, source: "backend" };
	}
	const device = deviceTag !== undefined ? deviceTag : deviceLanguage();
	return device
		? { locale: device, source: "device" }
		: { locale: DEFAULT_LOCALE, source: "default" };
}

/*
 * The store. One module-level value, subscribers notified on CHANGE only (a
 * repeated identical answer — the capabilities query re-polls — must not wake
 * every consumer). `useSyncExternalStore` consumes exactly this shape, so the
 * React binding is three lines.
 */

let state: LocaleState = resolveLocale(undefined);

const listeners = new Set<() => void>();

/** The active locale tag. Formatters and `t()` default to this. */
export function currentLocale(): string {
	return state.locale;
}

/** The active locale and its source, for tests and diagnostics. */
export function currentLocaleState(): LocaleState {
	return state;
}

/** Subscribe to locale changes; returns the unsubscribe function. */
export function subscribeLocale(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function setState(next: LocaleState): void {
	if (next.locale === state.locale && next.source === state.source) return;
	state = next;
	for (const listener of [...listeners]) listener();
}

/**
 * Feed a capabilities answer (or its absence) into the store.
 *
 * The renderer binding calls this whenever the capabilities query produces
 * data; calling it with `null`/`undefined` re-resolves to the device — which
 * is also how tests reset the store between cases.
 */
export function applyCapabilities(
	capabilities?: LocaleCapabilities | null,
	deviceTag?: string,
): void {
	setState(resolveLocale(capabilities, deviceTag));
}

/**
 * Apply a language the BACKEND resolved, after structural validation.
 *
 * The eligibility question (`features.i18n`) belongs to the caller that read
 * the answer: this function is the write half, and it answers whether the value
 * was usable so a main-process caller can log/fall back rather than pinning an
 * untrusted tag into every formatter in the process. Source stays `backend`,
 * the existing source kind.
 */
export function applyBackendLanguage(tag: unknown): boolean {
	if (!isLanguageTag(tag)) return false;
	setState({ locale: tag, source: "backend" });
	return true;
}

/**
 * Apply a device tag the MAIN process read from Electron, after validation.
 *
 * Same split as `applyBackendLanguage`: the reading (preferred system languages
 * -> system locale -> app locale) is main-locale's, and this is the validated
 * write. Source stays `device`, the existing source kind.
 */
export function applyDeviceLocale(tag: unknown): boolean {
	if (!isLanguageTag(tag)) return false;
	setState({ locale: tag, source: "device" });
	return true;
}

/**
 * Pin the locale directly.
 *
 * For tests and fixtures (the harness-side equivalent of the backend's
 * `LOP_LANG`), and the seam a future in-app language override would write
 * through; the mechanism itself never calls it.
 */
export function setLocale(locale: string): void {
	setState({ locale, source: "manual" });
}
