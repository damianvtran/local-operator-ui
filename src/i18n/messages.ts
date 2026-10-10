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
 * (`(...args: Params extends undefined ? [] : [p: Params])`): the same spike
 * measured that variant ACCEPTING a missing params object, which is why §2.4
 * says "do not invent a conditional-tuple variant". The four cases are pinned
 * by `scripts/i18n/typed-keys.test.mjs`, which compiles a fixture catalogue
 * through this very module.
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
 */

import { IntlMessageFormat } from "intl-messageformat";

import {
	type MessageKey,
	type MessageParams,
	type WithParams,
	type WithoutParams,
	bundledEnglish,
} from "./keys.gen";
import { currentLocale } from "./locale";

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

function messageFor(key: string, locale: string): string | undefined {
	return registered.get(locale)?.[key] ?? bundledEnglish[key];
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
	const message = messageFor(key, locale);
	if (message === undefined) return key;
	try {
		const rendered = formatterFor(locale, message).format(params);
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
