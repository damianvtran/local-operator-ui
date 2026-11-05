/**
 * Which URLs this module will consider, and the key two spellings of the same
 * page share.
 *
 * THE POINT OF THE KEY. A message can carry the same article twice with different
 * tracking parameters - the copy from a newsletter, the copy from a share sheet -
 * and the cache must see one page, not two, or the second card costs a second
 * fetch and a second pair of artifacts. Normalisation is deliberately CONSERVATIVE:
 * it lowercases what DNS is case-insensitive about (scheme, host), removes what
 * names nothing on the server (fragment, default port, tracking parameters) and
 * sorts the query. It does NOT drop a query it does not recognise, does not
 * canonicalise the path, and does not unwrap redirectors: two URLs that differ in
 * a parameter nobody listed stay distinct, because collapsing them would serve one
 * page's card under another page's link.
 *
 * WHAT IT DOES NOT DECIDE. Whether the host is reachable or safe: that is
 * `ssrf.ts`, and it must happen on EVERY hop of a redirect rather than once on the
 * input, so it cannot live here.
 */

/** Every tracking parameter this module treats as noise. Prefix forms are
 * matched by `TRACKING_PREFIXES`, exact names by the set below. */
const TRACKING_PREFIXES = ["utm_"] as const;
const TRACKING_PARAMS = new Set([
	"fbclid",
	"gclid",
	"dclid",
	"gbraid",
	"wbraid",
	"msclkid",
	"twclid",
	"igshid",
	"yclid",
	"mc_cid",
	"mc_eid",
	"_hsenc",
	"_hsmi",
	"hsctatracking",
	"vero_id",
	"oly_anon_id",
	"oly_enc_id",
	"__s",
	"ref_src",
	"ref_url",
	"spm",
	"scm",
]);

/** A URL longer than this is not a link a person pasted into a message; it is a
 * payload. Refused before parsing so no regular expression here sees it. */
const MAX_URL_LENGTH = 4096;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the check IS for control characters.
const NON_ASCII_HOST = /[^\x00-\x7f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the check IS for control characters.
const CONTROL_OR_SPACE = /[\x00-\x20\x7f]/;

/** Why a URL was refused. `unsupported-scheme` and `blocked-host` are the two
 * shapes the UI distinguishes; the rest of the module maps the address family in
 * `ssrf.ts` to `local-or-private`. */
export type LinkUrlRefusal = "unsupported-scheme" | "blocked-host";

export type NormalisedLinkUrl =
	| { ok: true; url: URL; key: string }
	| { ok: false; reason: LinkUrlRefusal };

/** Whether a query parameter is tracking noise the key drops. */
export function isTrackingParam(name: string): boolean {
	const lower = name.toLowerCase();
	if (TRACKING_PARAMS.has(lower)) return true;
	return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function refusal(reason: LinkUrlRefusal): NormalisedLinkUrl {
	return { ok: false, reason };
}

/**
 * Parse and normalise a link into a fetchable URL plus its cache key.
 *
 * The refusals are all decided from the URL's own text - no DNS, no network - so
 * this is safe to call on the renderer's say-so, and `resolve` does, before it
 * spends anything.
 */
export function normaliseLinkUrl(raw: string): NormalisedLinkUrl {
	if (typeof raw !== "string") return refusal("unsupported-scheme");
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
		return refusal("unsupported-scheme");
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return refusal("unsupported-scheme");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return refusal("unsupported-scheme");
	}
	// Credentials in the URL are both a leak (they survive into `href`, into error
	// text a library writes, into a Referer) and an authentication surface this
	// module has no business carrying. Refused rather than stripped: a URL that
	// carried a password is one the user did not mean to paste.
	if (url.username !== "" || url.password !== "") {
		return refusal("blocked-host");
	}
	const host = url.hostname;
	if (host === "") return refusal("blocked-host");
	/*
	 * The URL parser punycodes an internationalised host for us, so a host that
	 * still holds a non-ASCII character after parsing is one the IDNA mapping did
	 * not accept (the WHATWG parser leaves some forms alone rather than failing).
	 * `dns.lookup` would then receive a name no resolver can answer, so this is a
	 * refusal rather than a lookup: the shape is wrong, not the address.
	 */
	if (NON_ASCII_HOST.test(host) || CONTROL_OR_SPACE.test(host)) {
		return refusal("blocked-host");
	}
	return { ok: true, url, key: cacheKeyFor(url) };
}

/**
 * The normalised URL as a stable string: lowercase scheme and host, no default
 * port, no fragment, tracking query parameters dropped, remaining parameters
 * sorted by name (then by value, so a repeated parameter has one order too).
 *
 * The PATH is kept verbatim, including its case and its percent-encoding: a path
 * is case-sensitive on most servers and re-encoding it is a request for a
 * different resource.
 *
 * THE PARAMETERS ARE RE-ENCODED, NOT CONCATENATED. `URLSearchParams` hands back
 * DECODED names and values, so joining them with `&` and `=` would let a value
 * containing an encoded separator impersonate extra parameters: `?a=x%26b%3D1`
 * and `?a=x&b=1` would produce one key, and the second URL would be served the
 * first one's card. Serialising the sorted, filtered pairs re-encodes `&`, `=`
 * and `+` inside a value, so two different queries stay two keys.
 */
export function cacheKeyFor(url: URL): string {
	const scheme = url.protocol.toLowerCase();
	const host = url.hostname.toLowerCase();
	const defaultPort = scheme === "https:" ? "443" : "80";
	const port =
		url.port === "" || url.port === defaultPort ? "" : `:${url.port}`;
	const path = url.pathname === "" ? "/" : url.pathname;
	const params = [...url.searchParams.entries()]
		.filter(([name]) => !isTrackingParam(name))
		.sort(([aName, aValue], [bName, bValue]) =>
			aName === bName
				? aValue < bValue
					? -1
					: aValue > bValue
						? 1
						: 0
				: aName < bName
					? -1
					: 1,
		);
	const search = params.length
		? `?${new URLSearchParams(params).toString()}`
		: "";
	return `${scheme}//${host}${port}${path}${search}`;
}

/**
 * The bare host a DNS lookup should receive.
 *
 * An IPv6 literal keeps its brackets in `URL.hostname` (`[::1]`), which is not a
 * name any resolver accepts; an IPv4 literal is passed through unchanged and
 * `dns.lookup` answers it with itself, which is exactly the address this module
 * then classifies.
 */
export function lookupHostFor(hostname: string): string {
	if (hostname.startsWith("[") && hostname.endsWith("]")) {
		return hostname.slice(1, -1);
	}
	return hostname;
}
