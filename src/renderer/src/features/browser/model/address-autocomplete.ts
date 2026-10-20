import type { AddressHistoryEntry } from "../../../../../shared/browser-address-history";

/**
 * The address field's local completion model.
 *
 * WHY THE RANKING LIVES IN THE RENDERER: the query never crosses IPC per
 * keystroke. Main answers one bounded snapshot of URLs it already has, and this
 * module decides what the field shows — so typing cost stays local and no
 * suggestion service (local or remote) sees a prefix of what the user types.
 *
 * WHAT "COMPLETION" MEANS HERE, precisely: the field's REAL value becomes
 * `rawText + suffix`, and the suffix is selected. It is not a grey overlay: the
 * user can accept it with Right, type over it, or delete it. `targetUrl` is kept
 * beside the display text because a scheme-less completion may display
 * `example.com/a` while navigating the exact canonical `https://example.com/a` —
 * typing alone must never silently upgrade or downgrade the scheme.
 *
 * NO INVENTED ORDER: every candidate comes from a live tab's Chromium history or
 * its restore row. There is no frequency table, no "common sites" list and no
 * timestamp; `distanceFromCurrent` is history-stack distance, which the source
 * actually has.
 */

export type AddressIntent = "empty" | "url" | "search" | "blocked";

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

export interface AddressSuggestions {
	inline: InlineCompletion | null;
	/** Alternatives for the list, at most five, excluding the inline candidate. */
	candidates: AddressCandidate[];
	intent: AddressIntent;
}

/** The most alternatives the in-flow list ever shows. */
export const MAX_ADDRESS_ALTERNATIVES = 5;

const SCHEME_WITH_SLASHES = /^([a-z][a-z0-9+.-]*):\/\//i;
const BARE_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HAS_WHITESPACE = /\s/;
const LEADING_DIGITS = /^\d+/;
const LEADING_DOUBLE_SLASH = /^\/\//;
const URL_BOUNDARY = /[/?#]/;
const CONTROL_CHARS = /[\p{Cc}]/u;

function foldAscii(value: string): string {
	return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * What kind of input this is.
 *
 * The five rows the proposal settles, in code: whitespace or a leading `?` is
 * search intent (this app has no search provider, so the list only offers local
 * matches); a fragment alone is not a host prefix; an explicit non-HTTP scheme is
 * blocked rather than suggested; a bare `host:port` without `//` is still a URL,
 * because `host:8080` is an authority with a port rather than a scheme; and an
 * unparseable slashless string is treated as search, not rewritten.
 */
export function addressIntent(raw: string): AddressIntent {
	if (raw.length === 0) return "empty";
	if (raw !== raw.trim()) return "search";
	if (HAS_WHITESPACE.test(raw)) return "search";
	if (raw.startsWith("?") || raw.startsWith("#")) return "search";
	const withSlashes = SCHEME_WITH_SLASHES.exec(raw);
	if (withSlashes) {
		const scheme = foldAscii(withSlashes[1]);
		return scheme === "http" || scheme === "https" ? "url" : "blocked";
	}
	const bare = BARE_SCHEME.exec(raw);
	if (bare) {
		const scheme = foldAscii(bare[1]);
		if (scheme === "http" || scheme === "https") return "url";
		const after = raw.slice(bare[0].length);
		// `host:8080` and `localhost:3000/a` are authorities, not schemes. A port
		// beyond 65535 is the case the proposal asks to refuse rather than complete.
		if (after.length > 0 && LEADING_DIGITS.test(after)) {
			try {
				new URL(`https://${raw}`);
				return "url";
			} catch {
				return "blocked";
			}
		}
		return "blocked";
	}
	try {
		new URL(`https://${raw}`);
		return "url";
	} catch {
		return "search";
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
	if (a.rank !== b.rank) return a.rank - b.rank;
	if (a.activeTab !== b.activeTab) return a.activeTab ? -1 : 1;
	if (a.distanceFromCurrent !== b.distanceFromCurrent)
		return a.distanceFromCurrent - b.distanceFromCurrent;
	if (a.sourceTabId !== b.sourceTabId) return a.sourceTabId - b.sourceTabId;
	if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
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
): AddressSuggestions {
	const intent = addressIntent(raw);
	if (intent === "blocked") {
		return { inline: null, candidates: [], intent };
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
	const candidates = ranked
		.filter((candidate) => candidate.url !== inline?.targetUrl)
		.slice(0, MAX_ADDRESS_ALTERNATIVES);
	return { inline, candidates, intent };
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

/** A URL a candidate row or the inline suggestion will navigate. */
export function candidateTarget(
	suggestions: AddressSuggestions,
	activeIndex: number,
): string | null {
	if (activeIndex >= 0) {
		return suggestions.candidates[activeIndex]?.url ?? null;
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
