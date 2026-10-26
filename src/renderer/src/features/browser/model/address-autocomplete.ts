import type { AddressHistoryEntry } from "../../../../../shared/browser-address-history";

/**
 * The address field's local completion model.
 *
 * WHY THE RANKING IS SPLIT: the query crosses IPC only after a 120 ms debounce,
 * and main answers the top N from its indexed history store plus the bounded
 * live-tab window. This module still decides what the field SHOWS — the display
 * spelling, the target URL and the inline suffix — because those depend on
 * exactly what the user typed, while a visit-count ranking needs the table the
 * renderer no longer holds.
 *
 * WHAT "COMPLETION" MEANS HERE, precisely: the field's REAL value becomes
 * `rawText + suffix`, and the suffix is selected. It is not a grey overlay: the
 * user can accept it with Right, type over it, or delete it. `targetUrl` is kept
 * beside the display text because a scheme-less completion may display
 * `example.com/a` while navigating the exact canonical `https://example.com/a` —
 * typing alone must never silently upgrade or downgrade the scheme.
 *
 * TWO SOURCES, ONE LIST: `source: "history"` rows come ranked from main's
 * persistent store (recency and frequency, see `history-store.ts`), and
 * `source: "tab"` rows come from a live tab's Chromium history or its restore
 * row. History rows keep main's order; tab rows are ranked here, where the
 * stack distance is available.
 *
 * THE SEARCH ROW: when the text would be searched, the unified list's first row
 * is the DuckDuckGo search. It is part of `rows` rather than a separate banner so
 * the visible row, `aria-activedescendant` and the row Enter commits are always
 * the same index.
 */

export type AddressIntent = "empty" | "url" | "search" | "blocked";

/** The one search destination. Encoded once, here, so no other module can
 * invent a second spelling. */
export const ADDRESS_SEARCH_URL_PREFIX = "https://duckduckgo.com/?q=";

export function searchUrl(query: string): string {
	return `${ADDRESS_SEARCH_URL_PREFIX}${encodeURIComponent(query.trim())}`;
}

export interface AddressCandidate extends AddressHistoryEntry {
	/** The text a user sees for this candidate: scheme-less when the query had no
	 * scheme, full canonical when it did. Always ends in the exact destination. */
	displayText: string;
	/** 0 host prefix, 1 path prefix, 2 title-only. */
	rank: number;
	/** True when `displayText` starts with the raw query byte-for-byte. */
	prefixExact: boolean;
}

export interface InlineCompletion {
	/** What the field shows: `rawText + suffix`. */
	text: string;
	suffix: string;
	/** The exact canonical destination Enter/Right will use. */
	targetUrl: string;
	/** The raw text this completion was generated for. */
	raw: string;
}

/** The first row when the text would be searched. */
export interface AddressSearchRow {
	kind: "search";
	/** The text the user typed, trimmed. The UI wraps it in the localized row
	 * copy; the model owns no user-facing strings. */
	query: string;
	/** The DuckDuckGo destination Enter will navigate. */
	targetUrl: string;
}

/**
 * The text the user typed, offered back as a destination ("Open <address>").
 *
 * WHY IT EXISTS: a URL-shaped input with no history match used to produce an
 * EMPTY list (URL intent has no search row), so a brand-new address - the
 * ordinary case on a fresh profile or a new tab - got a "no matching pages"
 * notice and nothing to press. The row is the typed value itself, so the
 * highlighted default for URL intent is exactly what Enter has always done:
 * navigate the trimmed text. It is NOT offered next to history candidates (the
 * reported case was "no history"; a typed row above real matches would push
 * the matches down and fight the inline completion for the same Enter).
 */
export interface AddressTypedRow {
	kind: "typed";
	/** The text the user typed, trimmed. The UI wraps it in the localized row
	 * copy; the model owns no user-facing strings. */
	address: string;
	/** What Enter navigates: the trimmed text, byte for byte. Scheme handling (an
	 * HTTPS upgrade of a bare host, a refused scheme) stays with the host's own
	 * navigation path, exactly as for a typed Enter before this row existed. */
	targetUrl: string;
}

export interface AddressCandidateRow {
	kind: "candidate";
	candidate: AddressCandidate;
}

/**
 * One row of the unified list.
 *
 * ORDER, and it is the product decision: the typed-address row (URL intent
 * with no match at all) or the search row (search intent), history matches by
 * score, then open-tab matches. A URL-intent input with no match is
 * [typed address, search row]. There are deliberately no
 * section-heading rows: the native overlay protocol S4b owns has uniform row
 * heights and a row count, so a heading row would be a row the user can select
 * and a height the child cannot paint in its own model.
 */
export type AddressRow =
	| AddressSearchRow
	| AddressTypedRow
	| AddressCandidateRow;

export interface AddressSuggestions {
	inline: InlineCompletion | null;
	/** Candidate rows, in display order, excluding the search row. */
	candidates: AddressCandidate[];
	/** The unified list: at most five rows, the search row included. */
	rows: AddressRow[];
	/** The search row: first for search intent, second (after the typed row) for a
	 * URL-shaped input with no match at all, null otherwise. */
	search: AddressSearchRow | null;
	/** The typed-address row, only for URL intent with no history/tab match. */
	typed: AddressTypedRow | null;
	intent: AddressIntent;
}

/** The most rows the in-flow list ever shows. The search row counts against it,
 * because the native child paints at most `ADDRESS_LIST_ROWS_MAX` rows. */
export const MAX_ADDRESS_ROWS = 5;
/** The most candidate rows when there is no search row. Kept as the contract's
 * historical name; it is `MAX_ADDRESS_ROWS` for a list with no search row. */
export const MAX_ADDRESS_ALTERNATIVES = MAX_ADDRESS_ROWS;

const SCHEME_WITH_SLASHES = /^([a-z][a-z0-9+.-]*):\/\//i;
const BARE_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HAS_WHITESPACE = /\s/;
const LEADING_DOUBLE_SLASH = /^\/\//;
const URL_BOUNDARY = /[/?#]/;
const FILE_SCHEME_TYPED = /^file:/i;
const CONTROL_CHARS = /[\p{Cc}]/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_HOST = /^[0-9a-f:.%]+$/i;
const TLD = /^[a-z]{2,63}$/i;
const PUNYCODE_TLD = /^xn--[a-z0-9-]+$/i;
const PORT_TAIL = /^\d+(?:[/?#]|$)/;
/** Schemes that are never a destination: they execute, embed or address the
 * browser itself. `about:` is refused as a typed destination too — the host
 * treats `about:` as "not a load" and the address field must not dress it up as
 * a location. */
const BLOCKED_SCHEMES = new Set([
	"javascript",
	"data",
	"about",
	"blob",
	"vbscript",
]);

function foldAscii(value: string): string {
	return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** A dotted quad with every octet in range. `1.2` is not one, which is the
 * whole point: it is a version-looking string, not an address. */
function isIpv4(host: string): boolean {
	const match = IPV4.exec(host);
	if (!match) return false;
	return match.slice(1).every((part) => Number(part) <= 255);
}

/** Localhost by name, with any port handled by the caller. */
function isLocalhost(host: string): boolean {
	const folded = foldAscii(host);
	return folded === "localhost" || folded.endsWith(".localhost");
}

/** Bracketed IPv6, including a zone id. The brackets are the URL grammar's own
 * marker for "this colon is not a port". */
function isIpv6(host: string): boolean {
	return host.includes(":") && IPV6_HOST.test(host);
}

/**
 * Whether a host has the shape of a public DNS name.
 *
 * THE RULE THAT MAKES `github` A SEARCH: a single label with no dot is a word,
 * not a host — intranet hosts exist, but a suggestion field that treats every
 * word as a URL cannot offer a search at all. A final label that is numeric is
 * a version or a decimal (`1.2`), not a TLD; only a real TLD-shaped label (or a
 * punycode one) clears the bar.
 */
function isDnsHostname(host: string): boolean {
	if (host.length === 0 || host.length > 253) return false;
	const labels = host.split(".");
	if (labels.length < 2) return false;
	if (!labels.every((label) => DNS_LABEL.test(label))) return false;
	const tld = labels[labels.length - 1];
	return TLD.test(tld) || PUNYCODE_TLD.test(tld);
}

interface AuthorityShape {
	host: string;
	/** `null` when there is no port; a number when the text has one (even an
	 * out-of-range one, so the caller can call it blocked rather than search). */
	port: number | null;
	credentials: boolean;
}

/** Split the text before the first path/query/fragment byte into host and port.
 * Returns null for text that cannot be an authority at all. */
function authorityShape(raw: string): AuthorityShape | null {
	const boundary = raw.search(URL_BOUNDARY);
	const authority = boundary < 0 ? raw : raw.slice(0, boundary);
	if (authority.length === 0) return null;
	if (authority.includes("@")) {
		return { host: "", port: null, credentials: true };
	}
	if (authority.startsWith("[")) {
		const close = authority.indexOf("]");
		if (close < 0) return null;
		const host = authority.slice(1, close);
		const tail = authority.slice(close + 1);
		if (tail.length === 0) return { host, port: null, credentials: false };
		if (!tail.startsWith(":")) return null;
		return { host, port: Number(tail.slice(1)), credentials: false };
	}
	const firstColon = authority.indexOf(":");
	if (firstColon < 0) {
		return { host: authority, port: null, credentials: false };
	}
	if (authority.indexOf(":", firstColon + 1) >= 0) return null;
	return {
		host: authority.slice(0, firstColon),
		port: Number(authority.slice(firstColon + 1)),
		credentials: false,
	};
}

/**
 * What kind of input this is — THE single URL heuristic.
 *
 * The decision table the operator settled, in code order:
 *   navigate: `example.com`, `example.com/path?q=1`, `https://example.com`,
 *             `http://example.com`, `file:///tmp/a.txt`, `localhost:3000`,
 *             `127.0.0.1:8080`, `192.168.1.1`
 *   search:   `foo bar`, `what is a vpn`, `how to cook rice`, `github`,
 *             `1.2`
 *   blocked:  `javascript:`, `data:`, `about:` (and any other unknown scheme)
 *
 * `file://` IS URL INTENT and must never be searched: a user who pastes a file
 * URL is naming a file, and turning it into a web search would silently send
 * the path to DuckDuckGo. It is NOT a navigation permission: the host's
 * `permittedScheme` still refuses non-HTTP(S) typed navigation, and that
 * security boundary is deliberately untouched.
 *
 * Anything with whitespace, an untrimmed edge, or a leading `?`/`#` is search:
 * those are sentence punctuation, not URL bytes.
 */
export function addressIntent(raw: string): AddressIntent {
	if (raw.length === 0) return "empty";
	if (raw !== raw.trim()) return "search";
	if (HAS_WHITESPACE.test(raw)) return "search";
	if (raw.startsWith("?") || raw.startsWith("#")) return "search";
	const withSlashes = SCHEME_WITH_SLASHES.exec(raw);
	if (withSlashes) {
		const scheme = foldAscii(withSlashes[1]);
		if (scheme === "http" || scheme === "https" || scheme === "file")
			return "url";
		return "blocked";
	}
	const bare = BARE_SCHEME.exec(raw);
	if (bare) {
		const scheme = foldAscii(bare[1]);
		if (BLOCKED_SCHEMES.has(scheme)) return "blocked";
		if (scheme === "http" || scheme === "https" || scheme === "file")
			return "url";
		// `host:port` wears the same shape as a scheme. An all-digit tail is a
		// port; a dotted prefix is a hostname (`example.com:8080/a`) because a real
		// scheme cannot contain a dot. Anything else (`foo:bar`) is an unknown
		// scheme and stays blocked.
		const tail = raw.slice(bare[0].length);
		if (!PORT_TAIL.test(tail) && !scheme.includes(".")) return "blocked";
	}
	const shape = authorityShape(raw);
	if (!shape || shape.credentials) return "search";
	if (shape.port !== null) {
		if (
			!Number.isSafeInteger(shape.port) ||
			shape.port < 1 ||
			shape.port > 65535
		)
			return "blocked";
	}
	if (isLocalhost(shape.host) || isIpv4(shape.host) || isIpv6(shape.host))
		return "url";
	// A single label WITH a port is a host, not a word: prose does not carry
	// `:8080`, so `intranet:8080` is an intranet address.
	if (shape.port !== null && shape.host.length > 0 && !shape.host.includes("."))
		return "url";
	// A single label is a WORD (`github`), but a single label followed by a path,
	// query or fragment byte is a site path (`intranet/wiki`): prose does not
	// carry `/` without a space, and a page whose host has no dot is exactly the
	// case the user is retyping. This is URL intent only — `permittedScheme` in
	// the host still has the final say on what may actually be navigated.
	if (!shape.host.includes(".") && URL_BOUNDARY.test(raw)) return "url";
	if (!isDnsHostname(shape.host)) return "search";
	try {
		new URL(`https://${raw}`);
		return "url";
	} catch {
		// Host-shaped but unparseable: an invalid port or a rejected authority is
		// a malformed URL, not a phrase. Blocked is the honest answer.
		return "blocked";
	}
}

interface QueryShape {
	scheme: "http" | "https" | null;
	authority: string;
	rest: string;
}

function queryShape(raw: string): QueryShape {
	let body = raw;
	let scheme: "http" | "https" | null = null;
	const withSlashes = SCHEME_WITH_SLASHES.exec(raw);
	if (withSlashes) {
		scheme = foldAscii(withSlashes[1]) as "http" | "https";
		body = raw.slice(withSlashes[0].length);
	} else {
		const bare = BARE_SCHEME.exec(raw);
		if (bare) {
			const candidate = foldAscii(bare[1]);
			if (candidate === "http" || candidate === "https") {
				scheme = candidate;
				body = raw.slice(bare[0].length).replace(LEADING_DOUBLE_SLASH, "");
			}
		}
	}
	const boundary = body.search(URL_BOUNDARY);
	return boundary < 0
		? { scheme, authority: body, rest: "" }
		: {
				scheme,
				authority: body.slice(0, boundary),
				rest: body.slice(boundary),
			};
}

interface DisplayForms {
	/** Scheme-less spelling: `host + path + query + fragment`. */
	bare: string;
	/** The same text with `www.` dropped from the host, when it had one. */
	bareWithoutWww: string;
	/** Full canonical spelling, including the scheme and `//`. */
	full: string;
}

function displayForms(url: URL): DisplayForms {
	const tail = `${url.pathname}${url.search}${url.hash}`;
	const bare = `${url.host}${tail}`;
	const bareWithoutWww = url.hostname.startsWith("www.")
		? `${url.host.slice(4)}${tail}`
		: bare;
	return { bare, bareWithoutWww, full: `${url.protocol}//${url.host}${tail}` };
}

/**
 * One candidate from one history entry, or null when it does not match the query.
 *
 * MATCHING, and the order the ranks encode: an exact byte prefix of a display
 * form is the strongest (host prefix before path prefix), a case-folded host
 * match is list-only (the canonical URL cannot preserve the case the user typed),
 * and a title substring is the weakest. Title-only matches can never inline.
 */
function matchEntry(
	entry: AddressHistoryEntry,
	shape: QueryShape,
	raw: string,
	intent: AddressIntent,
): Omit<AddressCandidate, keyof AddressHistoryEntry> | null {
	let url: URL;
	try {
		url = new URL(entry.url);
	} catch {
		return null;
	}
	if (shape.scheme && url.protocol !== `${shape.scheme}:`) return null;
	const original = new URL(entry.url);
	const foldAuthority = foldAscii(shape.authority);
	const sameHost = (authority: string): boolean =>
		foldAscii(authority).startsWith(foldAuthority);
	const restMatches = (rest: string): boolean =>
		shape.rest.length === 0 || rest.startsWith(shape.rest);

	// A query with a port must keep it: `host:8080` and `host:3000` are distinct.
	const authorities: string[] = [
		`${original.hostname}${original.port ? `:${original.port}` : ""}`,
	];
	if (original.hostname.startsWith("www.")) {
		const stripped = original.hostname.slice(4);
		authorities.push(`${stripped}${original.port ? `:${original.port}` : ""}`);
	}

	let displayText: string | null = null;
	let rank: number | null = null;
	for (const authority of authorities) {
		if (!sameHost(authority)) continue;
		const tail = `${original.pathname}${original.search}${original.hash}`;
		if (!restMatches(tail)) continue;
		const schemePrefix = shape.scheme !== null ? `${url.protocol}//` : "";
		const text = `${schemePrefix}${authority}${tail}`;
		displayText = text;
		rank = shape.rest.length === 0 ? 0 : 1;
		if (raw.length > 0 && text.startsWith(raw)) break;
	}
	if (displayText === null || rank === null) {
		if (intent !== "url") return null;
		// Broader list matching: a title substring still offers a real destination.
		const title = foldAscii(entry.title);
		if (raw.length === 0 || !title.includes(foldAscii(raw))) return null;
		const schemePrefix = shape.scheme !== null ? `${url.protocol}//` : "";
		const canonicalAuthority = `${original.hostname}${
			original.port ? `:${original.port}` : ""
		}`;
		displayText = `${schemePrefix}${canonicalAuthority}${original.pathname}${original.search}${original.hash}`;
		rank = 2;
	}
	return {
		displayText,
		rank,
		prefixExact: raw.length > 0 && displayText.startsWith(raw),
	};
}

function compareCandidates(a: AddressCandidate, b: AddressCandidate): number {
	// HISTORY FIRST: main already ranked it by recency and frequency, and the
	// renderer has no basis to overrule a visit count it cannot see. Returning 0
	// inside the group keeps the input order (Array#sort is stable), which is
	// main's score order.
	if (a.source !== b.source) return a.source === "history" ? -1 : 1;
	if (a.source === "history") return 0;
	if (a.rank !== b.rank) return a.rank - b.rank;
	if (a.activeTab !== b.activeTab) return a.activeTab ? -1 : 1;
	const distance = (a.distanceFromCurrent ?? 0) - (b.distanceFromCurrent ?? 0);
	if (distance !== 0) return distance;
	const tab = (a.sourceTabId ?? 0) - (b.sourceTabId ?? 0);
	if (tab !== 0) return tab;
	const index = (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);
	if (index !== 0) return index;
	return a.url.localeCompare(b.url);
}

/**
 * Rank the snapshot for one query.
 *
 * EMPTY QUERY: current/nearby entries, not inferred popularity — the source has
 * no visit counts, so the ordering is the active tab first and then the nearest
 * history entries.
 */
export function suggestAddresses(
	entries: readonly AddressHistoryEntry[],
	raw: string,
	options: {
		/** True only when the field is actually showing `inline` as selected
		 * text. The inline target is dropped from the candidate rows in that case
		 * (showing the same destination twice is noise), but NOT when the suffix
		 * was suppressed — a paste or a deletion can leave the best prefix match
		 * with no visible completion, and filtering then makes the list claim
		 * there is no match while Enter commits the shorter, wrong host. */
		inlineShown?: boolean;
		/** False when the field is not being edited: the text is then the tab's
		 * live URL, not something typed, so there is nothing to offer back. */
		offerTyped?: boolean;
	} = {},
): AddressSuggestions {
	const inlineShown = options.inlineShown ?? true;
	const intent = addressIntent(raw);
	if (intent === "blocked") {
		return {
			inline: null,
			candidates: [],
			rows: [],
			search: null,
			typed: null,
			intent,
		};
	}
	const shape = queryShape(raw);
	const seen = new Set<string>();
	const ranked: AddressCandidate[] = [];
	for (const entry of entries) {
		if (seen.has(entry.url)) continue;
		if (!entry.url.startsWith("http://") && !entry.url.startsWith("https://"))
			continue;
		const match =
			intent === "empty"
				? {
						// The empty field offers every entry; active-tab proximity does the
						// ordering below.
						displayText: displayForms(new URL(entry.url)).bare,
						rank: 0,
						prefixExact: false,
					}
				: matchEntry(entry, shape, raw, intent);
		if (!match) continue;
		seen.add(entry.url);
		ranked.push({ ...entry, ...match });
	}
	ranked.sort(compareCandidates);

	let inline: InlineCompletion | null = null;
	if (intent === "url" && raw.length > 0) {
		const first = ranked.find(
			(candidate) =>
				candidate.prefixExact &&
				candidate.displayText.length > raw.length &&
				candidate.rank <= 1,
		);
		if (first) {
			inline = {
				raw,
				text: first.displayText,
				suffix: first.displayText.slice(raw.length),
				targetUrl: first.url,
			};
		}
	}
	// THE TYPED ROW: a URL-shaped input that matched NOTHING (no history entry and
	// no open tab - `ranked`, not `candidates`, because the inline target is
	// filtered out of `candidates` and would otherwise look like "no match" while
	// a completion is on screen). `file:` is URL intent so it is never searched,
	// and it is refused on Enter, so it is not offered as something to open.
	// `usableRawAddress` is the same gate Enter applies to the raw text, so the row
	// can never offer something the commit path would refuse (control characters).
	const typedAddress = usableRawAddress(raw);
	const typed: AddressTypedRow | null =
		(options.offerTyped ?? true) &&
		intent === "url" &&
		ranked.length === 0 &&
		typedAddress !== null &&
		!FILE_SCHEME_TYPED.test(typedAddress)
			? { kind: "typed", address: typedAddress, targetUrl: typedAddress }
			: null;
	// THE SEARCH ROW IS A ROW, not a banner: it takes the first slot for search
	// intent, which is also why the candidate cap is one lower when it is present.
	// Behind the typed row it is the "or search for it" alternative.
	const search: AddressSearchRow | null =
		(intent === "search" || typed !== null) && raw.trim().length > 0
			? {
					kind: "search",
					query: raw.trim(),
					targetUrl: searchUrl(raw),
				}
			: null;
	const candidates = ranked
		.filter(
			(candidate) => !(inlineShown && candidate.url === inline?.targetUrl),
		)
		.slice(0, search ? MAX_ADDRESS_ROWS - 1 : MAX_ADDRESS_ROWS);
	const rows: AddressRow[] = [
		...(typed ? [typed] : []),
		...(search ? [search] : []),
		...candidates.map(
			(candidate): AddressCandidateRow => ({ kind: "candidate", candidate }),
		),
	];
	return { inline, candidates, rows, search, typed, intent };
}

/**
 * Whether the current selection allows inline completion.
 *
 * The generated suffix is selected by this field, so the "eligible" selection is
 * either a collapsed caret after ordinary typing or exactly the suffix this field
 * produced. A mid-string caret, an arbitrary range, a paste, a deletion, undo/redo
 * or IME composition all suppress it until the next ordinary typing event.
 */
export function canInlineComplete(input: {
	raw: string;
	selectionStart: number | null;
	selectionEnd: number | null;
	composing: boolean;
	dismissedForText: string | null;
	completionText: string | null;
}): boolean {
	if (input.composing) return false;
	if (input.dismissedForText === input.raw) return false;
	if (input.selectionStart === null || input.selectionEnd === null)
		return false;
	if (input.completionText !== null) {
		return (
			input.selectionStart === input.raw.length &&
			input.selectionEnd === input.completionText.length
		);
	}
	return (
		input.selectionStart === input.raw.length &&
		input.selectionEnd === input.raw.length
	);
}

/** The completion for a fresh typed value, or null. */
export function inlineFor(
	suggestions: AddressSuggestions,
	eligible: boolean,
): InlineCompletion | null {
	if (!eligible) return null;
	return suggestions.inline;
}

/**
 * The URL a row — or, with no row selected, the inline suggestion — will
 * navigate. ONE function, so a search row, a candidate row and the inline
 * completion cannot disagree about what Enter means.
 */
export function rowTarget(
	suggestions: AddressSuggestions,
	activeIndex: number,
): string | null {
	if (activeIndex >= 0) {
		const row = suggestions.rows[activeIndex];
		if (!row) return null;
		if (row.kind === "search" || row.kind === "typed") return row.targetUrl;
		return row.candidate.url;
	}
	return suggestions.inline?.targetUrl ?? null;
}

/** The next active row after a Down (+1) or Up (-1), wrapping within the list.
 * `-1` means "no explicit row selected"; Down from it starts at the first row,
 * and Up goes to the last. */
export function moveActive(
	activeIndex: number,
	delta: 1 | -1,
	count: number,
): number {
	if (count === 0) return -1;
	if (activeIndex < 0) return delta === 1 ? 0 : count - 1;
	return (activeIndex + delta + count) % count;
}

/** Whether the selection is exactly the generated suffix this field produced. */
export function isGeneratedSuffixSelected(input: {
	raw: string;
	selectionStart: number | null;
	selectionEnd: number | null;
	completionText: string | null;
}): boolean {
	return (
		input.completionText !== null &&
		input.selectionStart === input.raw.length &&
		input.selectionEnd === input.completionText.length
	);
}

/** Whether raw text is safe to hand to the navigation path. Control characters
 * are never a typed address; the host's own URL parser is the second check. */
export function usableRawAddress(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed || CONTROL_CHARS.test(trimmed)) return null;
	return trimmed;
}
