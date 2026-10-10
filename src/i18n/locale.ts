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

/** Where the current locale came from. Diagnostics and tests read it. */
export type LocaleSource = "backend" | "device" | "default";

export type LocaleState = {
	/** A BCP-47 tag: the backend's resolved tag, or the device's own. */
	locale: string;
	source: LocaleSource;
};

/** The feature key gating the served-catalogue contract (RFC §2.1). */
export const I18N_FEATURE = "i18n";

/** The source locale, and where a locale that nothing can answer lands. */
export const DEFAULT_LOCALE = "en";

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
 * The locale a `GET /v1/capabilities` answer resolves to, ignoring the store.
 *
 * Exported for tests, which assert the truth table directly: an answer with
 * `features.i18n` and a non-empty `language` is the backend source; anything
 * else (no answer, an older backend without the feature, a blank tag) falls
 * back to the device.
 */
export function resolveLocale(
	capabilities?: LocaleCapabilities | null,
): LocaleState {
	const language = capabilities?.language;
	if (
		i18nFeatureEnabled(capabilities?.features) &&
		typeof language === "string" &&
		language.trim() !== ""
	) {
		return { locale: language, source: "backend" };
	}
	const device = deviceLanguage();
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
): void {
	setState(resolveLocale(capabilities));
}

/**
 * Pin the locale directly.
 *
 * For tests and fixtures (the harness-side equivalent of the backend's
 * `LOP_LANG`), and the seam a future in-app language override would write
 * through; the mechanism itself never calls it.
 */
export function setLocale(locale: string): void {
	setState({ locale, source: "device" });
}
