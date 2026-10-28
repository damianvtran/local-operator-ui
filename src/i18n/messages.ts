/**
 * `t()` — the typed translation entry point — and the catalogue runtime.
 *
 * THE KEY MAP IS GENERATED (`./keys.gen.ts`, RFC §2.4): `MessageParams` gives
 * every bundled message id its parameter shape, and `t` is declared as the TWO
 * OVERLOADS the RFC's spike proved — one for keys that carry parameters, one
 * for keys that are complete on their own — so all four negative cases fail
 * `tsc`:
 *
 *     t("ui.x.unknown")                  // not a key           -> error
 *     t("ui.x.count", { count: "nope" }) // wrong parameter type -> error
 *     t("ui.x.count")                    // missing parameters   -> error
 *     t("ui.x.plain", { count: 1 })      // params on a bare key -> error
 *
 * DO NOT rewrite the pair as one conditional-tuple signature
 * (`(...args: Params extends undefined ? [] : [p: Params])`): §2.4 says "do
 * not invent a conditional-tuple variant" because its spike measured that
 * variant ACCEPTING a missing params object. What
 * `scripts/i18n/typed-keys.test.mjs` pins is the SHIPPED shape rejecting all
 * four cases — a round-1 review (R1-4) measured the swap rejecting all four
 * as re-tried here as well, so do not claim this suite fails the swap; the
 * shape's authority is §2.4's spike alone.
 *
 * RESOLUTION (RFC §2.1, §2.5). The bundled en catalogue is the fallback for
 * every lookup. `registerCatalogue` layers a locale's messages on top of it —
 * the served `wire.*` slice fetches
 * `GET /v1/i18n/catalogues/{locale}/{namespace}` and registers the maps here,
 * keyed by locale — and the ACTIVE locale comes from `./locale` (the backend's
 * resolved tag once the capabilities answer arrives, the device before that).
 * An unresolvable message degrades to the KEY itself, and a message that fails
 * to format degrades the same way: this is a render path, so it never throws
 * (RFC §2.6's additive contract; a missing or malformed message is what the
 * catalogue checks and the string scanner are for, not a user-visible crash).
 *
 * THE ACTIVE TAG IS NOT THE LOOKUP KEY. The store deliberately keeps the
 * device's tag verbatim (`fr-FR`, `ur-PK` — `./locale`), and no catalogue is
 * named that, so every lookup first canonicalises it through
 * `./catalogue-locale` and only a catalogue spelling (`fr`, `ur`) can answer.
 * The tag the caller supplied is still tried first against the REGISTERED
 * maps, because that seam is keyed by whatever the server served: that is the
 * `wire.*` contract, and it is also why synthetic fixture tags
 * (`scripts/i18n/absent-locale.mjs`) keep resolving.
 */

import { IntlMessageFormat } from "intl-messageformat";

import { resolveCatalogueLocale } from "./catalogue-locale";
import {
	type MessageKey,
	type MessageParams,
	type WithParams,
	type WithoutParams,
	bundledCatalogues,
	bundledEnglish,
} from "./keys.gen";
import { DEFAULT_LOCALE, currentLocale } from "./locale";

export type { MessageKey, MessageParams, WithParams, WithoutParams };

/*
 * Registered messages, per locale. Served catalogues merge in namespace by
 * namespace (two fetches for one locale must not replace each other), so the
 * inner record is mutated on register and the outer map is the registry.
 */
const registered = new Map<string, Record<string, string>>();

/**
 * Register messages for `locale` — the served-catalogue seam (RFC §2.1).
 *
 * Additive: merging a second namespace into an already-registered locale keeps
 * the first. Lookups that miss here fall through to the bundled en map, so a
 * partially served locale degrades per-key, never per-screen.
 */
export function registerCatalogue(
	locale: string,
	messages: Record<string, string>,
): void {
	const existing = registered.get(locale);
	if (existing) Object.assign(existing, messages);
	else registered.set(locale, { ...messages });
}

/** Drop everything registered; bundled en remains. Tests reset with this. */
export function clearRegisteredCatalogues(): void {
	registered.clear();
}

function messageFor(
	key: string,
	locale: string,
	catalogue: string,
): string | undefined {
	/*
	 * PER-KEY EN FALLBACK (French activation bug). Order: a served catalogue
	 * registered under the tag the caller supplied (the `wire.*` seam, keyed by
	 * the server's own spelling), then a served catalogue under the canonical
	 * catalogue tag, then the client's own bundle for that tag (generated from
	 * `catalogues/<catalogue>/`), then the English source. A locale that is
	 * missing a key therefore renders the English string — never a raw key,
	 * never a blank — which is the RFC §2.5 fallback and the reason a partially
	 * translated locale degrades per key rather than per screen.
	 *
	 * `catalogue` is the tag `resolveCatalogueLocale` chose for `locale`; the
	 * caller resolves it once so this function and `sourceTagFor` cannot
	 * disagree about which catalogue was consulted.
	 *
	 * The TAGGED locale is passed so the formatter runs with the target locale's
	 * plural/date rules once a message is found — but an EN-FALLBACK message must
	 * format with ENGLISH rules, or a `{count, plural, one {…}}` English string
	 * could pluralise by French rules. `translate()` below picks the formatting
	 * tag from which catalogue actually answered.
	 */
	const served = registered.get(locale)?.[key];
	if (served !== undefined) return served;
	const servedCatalogue = registered.get(catalogue)?.[key];
	if (servedCatalogue !== undefined) return servedCatalogue;
	const bundled = bundledCatalogues[catalogue]?.[key];
	if (bundled !== undefined) return bundled;
	return bundledEnglish[key];
}

/**
 * The locale whose RULES should format `key` in `locale`: the target locale when
 * its own catalogue answered (served or bundled), English when the lookup fell
 * through to the English source. Returns the catalogue tag alongside the message
 * so `translate()` never formats an English string with French plural rules.
 *
 * It walks the SAME chain as `messageFor` and takes the same resolved
 * `catalogue`, so the tag it reports is the one that actually answered.
 */
function sourceTagFor(key: string, locale: string, catalogue: string): string {
	if (registered.get(locale)?.[key] !== undefined) return locale;
	if (registered.get(catalogue)?.[key] !== undefined) return catalogue;
	if (bundledCatalogues[catalogue]?.[key] !== undefined) return catalogue;
	return DEFAULT_LOCALE;
}

/*
 * Parsed messages, cached per (locale, message). Construction is the expensive
 * half of `IntlMessageFormat` (it parses the ICU source); a UI render loop asks
 * for the same handful of messages over and over, and the parse result depends
 * only on these two strings.
 */
const formats = new Map<string, IntlMessageFormat>();

function formatterFor(locale: string, message: string): IntlMessageFormat {
	const cacheKey = `${locale}\u0000${message}`;
	let format = formats.get(cacheKey);
	if (format === undefined) {
		format = new IntlMessageFormat(message, locale);
		formats.set(cacheKey, format);
	}
	return format;
}

/**
 * Render `key` in `locale` (default: the active locale).
 *
 * The two degradations named in the module docstring both land on the key:
 * a message missing from every catalogue, and a message that fails to format
 * (a malformed served catalogue — the build-time checks are where that is
 * caught).
 */
export function translate(
	key: string,
	params: Record<string, unknown> = {},
	locale: string = currentLocale(),
): string {
	const catalogue = resolveCatalogueLocale(locale);
	const message = messageFor(key, locale, catalogue);
	if (message === undefined) return key;
	/*
	 * Format with the tag that actually ANSWERED (see `sourceTagFor`): a French
	 * message formats as `fr`, an English fallback as `en`. Falling back on the
	 * message without switching the tag is the mixed-language bug this avoids.
	 */
	const tag = sourceTagFor(key, locale, catalogue);
	try {
		const rendered = formatterFor(tag, message).format(params);
		return typeof rendered === "string" ? rendered : String(rendered);
	} catch {
		return key;
	}
}

// The two-overload declaration — RFC §2.4's proven shape; see the docstring.
export function t<K extends WithParams>(
	key: K,
	params: MessageParams[K],
): string;
export function t<K extends WithoutParams>(key: K): string;
/*
 * The implementation signature is deliberately WIDER than either overload
 * (`string`, not `MessageKey`) and invisible to callers: overload resolution
 * only ever consults the two declarations above, and a generic key (`K extends
 * …`) is not assignable to the narrow `MessageKey` alias from inside the
 * compatibility check the compiler runs on THIS signature (TS2394). Widening
 * it changes nothing a caller can type; the four negative cases are still
 * rejected by the overloads, which is what scripts/i18n/typed-keys.test.mjs
 * compiles.
 */
export function t(key: string, params?: unknown): string {
	return translate(key, (params ?? {}) as Record<string, unknown>);
}
