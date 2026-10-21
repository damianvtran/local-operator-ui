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
 */

import { IntlMessageFormat } from "intl-messageformat";

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

/**
 * Replace everything registered for `locale` with `messages`.
 *
 * The per-locale bundle is a WHOLE: one payload carrying every eager
 * namespace, keyed by `content_sha256`. When that identity changes the served
 * map is the complete truth for the locale, so merging would keep identities
 * a newer backend removed (and they would render stale text until restart).
 * Additive `registerCatalogue` remains for partial contributions.
 */
export function replaceCatalogue(
	locale: string,
	messages: Record<string, string>,
): void {
	registered.set(locale, { ...messages });
}

/** Drop everything registered; bundled en remains. Tests reset with this. */
export function clearRegisteredCatalogues(): void {
	registered.clear();
}

function messageFor(key: string, locale: string): string | undefined {
	/*
	 * PER-KEY EN FALLBACK (French activation bug). Order: served catalogue for
	 * this locale (the `wire.*` seam), then the client's own bundle for this
	 * locale (generated from `catalogues/<locale>/`), then the English source.
	 * A locale that is missing a key therefore renders the English string — never
	 * a raw key, never a blank — which is the RFC §2.5 fallback and the reason a
	 * partially translated locale degrades per key rather than per screen.
	 *
	 * The TAGGED locale is passed so the formatter runs with the target locale's
	 * plural/date rules once a message is found — but an EN-FALLBACK message must
	 * format with ENGLISH rules, or a `{count, plural, one {…}}` English string
	 * could pluralise by French rules. `translate()` below picks the formatting
	 * tag from which catalogue actually answered.
	 */
	const served = registered.get(locale)?.[key];
	if (served !== undefined) return served;
	const bundled = bundledCatalogues[locale]?.[key];
	if (bundled !== undefined) return bundled;
	return bundledEnglish[key];
}

/**
 * The locale whose RULES should format `key` in `locale`: the target locale when
 * its own catalogue answered (served or bundled), English when the lookup fell
 * through to the English source. Returns the catalogue tag alongside the message
 * so `translate()` never formats an English string with French plural rules.
 */
function sourceTagFor(key: string, locale: string): string {
	if (registered.get(locale)?.[key] !== undefined) return locale;
	if (bundledCatalogues[locale]?.[key] !== undefined) return locale;
	return DEFAULT_LOCALE;
}

/*
 * Parsed messages and their argument kinds, cached per (locale, message).
 * Construction is the expensive half of `IntlMessageFormat` (it parses the ICU
 * source), and the AST walk that finds plural/number arguments is paid once
 * with it — the previous shape re-walked `getAst()` on every `t()` call, which
 * measured 262 -> 702 ns (2.7x) for the same sentence. A UI render loop asks
 * for the same handful of messages over and over, and both halves depend only
 * on these two strings, so they are cached together.
 */
type ParsedMessage = {
	format: IntlMessageFormat;
	/** ICU arguments and the STRICTEST kind each is used as. */
	arguments: Map<string, IcuArgumentKind>;
};

const formats = new Map<string, ParsedMessage>();

function parsedMessageFor(locale: string, message: string): ParsedMessage {
	const cacheKey = `${locale}\u0000${message}`;
	let parsed = formats.get(cacheKey);
	if (parsed === undefined) {
		const format = new IntlMessageFormat(message, locale);
		const argumentsInMessage = new Map<string, IcuArgumentKind>();
		collectIcuArguments(format.getAst(), argumentsInMessage);
		parsed = { format, arguments: argumentsInMessage };
		formats.set(cacheKey, parsed);
	}
	return parsed;
}

/**
 * The outcome of one catalogue render, with the two failures KEPT APART.
 *
 * `translate()`'s degradation rule (below) is right for a screen that has
 * nothing else to show: an absent or broken message reads as its key. A
 * backend-originated envelope cannot use that collapse. The design
 * (`docs/design/backend-originated-strings.md` §6, "Failure and compatibility
 * contract") distinguishes the two on purpose:
 *
 * - `unknown` — an identity this runtime has never heard of (a newer backend).
 *   The caller falls back to the envelope's own `text`, which is the sentence
 *   an older client is guaranteed to receive.
 * - `malformed` — the identity IS known and its own message could not be
 *   formatted (missing/ill-typed params, a catalogue entry that is not plain
 *   text). §6 requires a client-owned generic error and an identity diagnostic
 *   here, NOT the English wire text: silently showing the fallback sentence
 *   would hide a real integration failure behind copy that looks normal.
 *
 * Encoding both as "returns the key" is what made the distinction unavailable
 * to the consuming adapter, so it is encoded here once rather than guessed
 * from a string comparison at the call site.
 */
export type MessageRender =
	| { status: "rendered"; text: string }
	| { status: "unknown" }
	| { status: "malformed" };
/**
 * The ICU argument kinds this runtime checks. Deliberately narrower than the
 * full AST vocabulary: only the kinds where a coerced value is WRONG copy.
 *
 * - `number` — plural/selectordinal and `{n, number}`. A string, boolean or
 *   `null` here does not throw in `IntlMessageFormat`; it COERCES, so
 *   `{count: "abc"}` renders "NaN éléments", `null` renders "0 élément" and
 *   `true` renders "1 élément". Those are fabricated sentences, which is the
 *   malformed-params branch's whole reason to exist (§6).
 * - `date` — `{d, date}` / `{t, time}`. Accepts a `Date` or a finite epoch
 *   number; an unparseable string formats as "Invalid Date" rather than
 *   throwing.
 * - `scalar` — a plain `{argument}` or `{g, select}`. Any JSON scalar is valid;
 *   `isFormatParam` rejects objects so `[object Object]` cannot reach the
 *   screen.
 */
type IcuArgumentKind = "scalar" | "number" | "date";

/*
 * `intl-messageformat` does not export its AST `TYPE` enum, so these are the
 * stable numeric values of the shipped parser (12.x): literal 0, argument 1,
 * number 2, date 3, time 4, select 5, plural (and selectordinal) 6, pound 7,
 * tag 8. Only the argument-bearing nodes are named; anything else contributes
 * no argument and is walked only for its children.
 */
const ICU_ARGUMENT = 1;
const ICU_NUMBER = 2;
const ICU_DATE = 3;
const ICU_TIME = 4;
const ICU_SELECT = 5;
const ICU_PLURAL = 6;
const ICU_TAG = 8;

/*
 * How strictly an argument's value is checked when ONE name appears more than
 * once in a message. A message may mix a plural and a bare interpolation of the
 * same argument ("{count, plural, ...} (value: {count})"). The bare use would
 * admit a string, but the plural requires a finite number, and letting the later
 * AST node overwrite the stricter earlier one made `{count: "abc"}` render a
 * fabricated "NaN elements (value: abc)" instead of taking the malformed-params
 * branch. Highest rank wins and is never downgraded: number > date > scalar.
 */
const ICU_KIND_RANK: Record<IcuArgumentKind, number> = {
	scalar: 0,
	date: 1,
	number: 2,
};

function rememberIcuArgument(
	into: Map<string, IcuArgumentKind>,
	name: string,
	kind: IcuArgumentKind,
): void {
	const previous = into.get(name);
	if (previous === undefined || ICU_KIND_RANK[kind] > ICU_KIND_RANK[previous]) {
		into.set(name, kind);
	}
}

function collectIcuArguments(
	nodes: readonly unknown[],
	into: Map<string, IcuArgumentKind>,
): void {
	for (const raw of nodes) {
		if (typeof raw !== "object" || raw === null) continue;
		const node = raw as {
			type?: unknown;
			value?: unknown;
			options?: Record<string, { value?: unknown }>;
			children?: unknown;
		};
		if (typeof node.value === "string") {
			if (node.type === ICU_NUMBER || node.type === ICU_PLURAL) {
				rememberIcuArgument(into, node.value, "number");
			} else if (node.type === ICU_DATE || node.type === ICU_TIME) {
				rememberIcuArgument(into, node.value, "date");
			} else if (node.type === ICU_ARGUMENT || node.type === ICU_SELECT) {
				rememberIcuArgument(into, node.value, "scalar");
			}
		}
		/*
		 * Plural/select options each carry a nested message; a type-8 tag carries
		 * children (rich text, which `renderMessage` already refuses). Walking them
		 * keeps the check correct for arguments nested inside a plural branch.
		 */
		if (node.options && typeof node.options === "object") {
			for (const option of Object.values(node.options)) {
				if (Array.isArray(option?.value)) {
					collectIcuArguments(option.value, into);
				}
			}
		}
		if (node.type === ICU_TAG && Array.isArray(node.children)) {
			collectIcuArguments(node.children, into);
		}
	}
}

/**
 * Whether ICU can receive this parameter value at all.
 *
 * Named JSON scalars are the transport contract (§3: "Params should remain
 * named JSON scalar values for ICU"). `IntlMessageFormat` does not throw on an
 * object — it strings it into the sentence — so without this guard a corrupt
 * envelope would paint `[object Object]` (or a list) where a word belongs.
 * `null` is accepted here because it is a JSON scalar; whether it is valid for
 * a particular argument is decided by `matchesIcuKind` (it is not valid for a
 * plural). A `Date` is accepted because the runtime is shared with `t()` call
 * sites that pass one to a `{when, date, short}` argument.
 */
function isFormatParam(value: unknown): boolean {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		(value instanceof Date && Number.isFinite(value.getTime()))
	);
}

/** Whether the supplied value has the type this ICU argument can format. */
function matchesIcuKind(
	value: unknown,
	kind: IcuArgumentKind | undefined,
): boolean {
	if (!isFormatParam(value)) return false;
	if (kind === "number") {
		return typeof value === "number" && Number.isFinite(value);
	}
	if (kind === "date") {
		return (
			value instanceof Date ||
			(typeof value === "number" && Number.isFinite(value))
		);
	}
	/* Scalar (or an argument the message does not carry): any format param. */
	return true;
}

/**
 * Render `key` in `locale` (default: the active locale), reporting WHY a
 * render did not happen. See `MessageRender` for the two distinct failures.
 */
export function renderMessage(
	key: string,
	params: Record<string, unknown> = {},
	locale: string = currentLocale(),
): MessageRender {
	const message = messageFor(key, locale);
	if (message === undefined) return { status: "unknown" };
	/*
	 * An EMPTY entry is a broken catalogue, not a valid message. Treat it as
	 * malformed so a bad registration cannot erase a refusal into a blank line
	 * (review round 1, MINOR-2).
	 */
	if (message.trim() === "") return { status: "malformed" };
	for (const value of Object.values(params)) {
		if (!isFormatParam(value)) return { status: "malformed" };
	}
	/*
	 * Format with the tag that actually ANSWERED (see `sourceTagFor`): a French
	 * message formats as `fr`, an English fallback as `en`. Falling back on the
	 * message without switching the tag is the mixed-language bug this avoids.
	 */
	const tag = sourceTagFor(key, locale);
	try {
		const parsed = parsedMessageFor(tag, message);
		/*
		 * ICU-TYPE, not JS-TYPE (review round 1, MAJOR-1): the formatter coerces a
		 * string/boolean/null in a plural or number slot instead of throwing, so
		 * `typeof` alone would let "NaN éléments" through as a normal message.
		 */
		const argumentsInMessage = parsed.arguments;
		for (const [name, kind] of argumentsInMessage) {
			if (!matchesIcuKind(params[name], kind)) {
				return { status: "malformed" };
			}
		}
		const rendered = parsed.format.format(params);
		/*
		 * Only a plain string is product copy. A rich-text message returns an
		 * array of parts that a text sink cannot paint; treating it as malformed
		 * routes it down the diagnostic path instead of `String(...)`-ing tags
		 * into the sentence.
		 */
		return typeof rendered === "string"
			? { status: "rendered", text: rendered }
			: { status: "malformed" };
	} catch {
		/*
		 * Missing ICU arguments throw (measured with intl-messageformat 12: a
		 * message with `{model}` and `params: {}` raises). See `MessageRender`
		 * for why that is not `unknown`.
		 */
		return { status: "malformed" };
	}
}

/**
 * Render `key` in `locale` (default: the active locale).
 *
 * The two degradations named in the module docstring both land on the key:
 * a message missing from every catalogue, and a message that fails to format
 * (a malformed served catalogue — the build-time checks are where that is
 * caught). Sites that must TELL those apart use `renderMessage`.
 */
export function translate(
	key: string,
	params: Record<string, unknown> = {},
	locale: string = currentLocale(),
): string {
	const rendered = renderMessage(key, params, locale);
	return rendered.status === "rendered" ? rendered.text : key;
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
