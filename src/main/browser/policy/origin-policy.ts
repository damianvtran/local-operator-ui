/**
 * URL safety, loopback rules and the registrable-domain grant scope.
 *
 * LOCAL PORT of `extension/src/origin-policy.ts` in
 * `damianvtran/local-operator` at `d383e6bfe`. See `scroll-expressions.ts`'s
 * header for the vendoring plan (design 12.2); this is the labelled local
 * implementation until the lop-side `extension/src/driver/` move lands, and
 * `access-queue.ts`/`access-flow.ts` beside it are the same kind of port.
 *
 * TODO(vendoring): replace with the vendored copy. The one difference to carry
 * across when it lands is `configurePslRules` below (see its own note).
 *
 * TWO DELIBERATE DIFFERENCES from the module this is ported from, both stated
 * so a reviewer can check them rather than infer them:
 *
 * 1. The PSL data is INJECTED rather than imported. The original imports a
 *    157 KB generated `psl.gen.ts`. Copying that generated blob into this repo
 *    by hand would create a generated artifact with no generator and no CI
 *    check — exactly what the vendoring mechanism exists to prevent. Instead
 *    the rules arrive through `configurePslRules()`, called once at host start,
 *    and the failure mode when they are absent is explicitly CLOSED: no domain
 *    option is offered and a stored `domain` grant is not matched, so the only
 *    consequence is that the broader-than-exact scope is unavailable. Exact
 *    origin grants, loopback host grants and one-shot grants are unaffected.
 *    See `host.ts` for where the rules are resolved and what is logged.
 * 2. The legacy `hostGrants` (extension 0.1.4-0.1.7 loopback all-ports, keyed by
 *    [protocol, hostname]) shape is NOT ported. This store has no legacy
 *    records to read — it is new in this host — and the scope names are kept
 *    identical so the vocabulary a reviewer compares is the same. Carrying an
 *    unused migration path would be a second grant model with no data behind
 *    it.
 */

export type StoredVerdict = "allow" | "deny";

/** A broad grant from a consent-bar "all pages on this domain" / "this
 * loopback host" choice.
 *
 * `domain`: key is the bare lowercase ASCII registrable domain
 * (`gominerva.com`); covers every subdomain, both schemes, any port.
 * `host`: key is a literal loopback hostname (`localhost`, `127.0.0.1`,
 * `[::1]`); covers any port on both schemes. Loopback has no registrable
 * domain, so it gets its own scope rather than a fake one. */
export interface SiteGrant {
	scope: "domain" | "host";
	createdAt: number;
}

/** The durable broad-grant store, versioned so a record written by a newer
 * build prompts again here rather than being misread; unknown versions fail
 * closed. */
export interface SiteGrantsState {
	version: 1;
	grants: Record<string, SiteGrant>;
}

/** The scope a stored grant admitted a URL under, in lookup order. */
export type GrantScope = "origin" | "domain" | "host";

/** What the consent surface may offer as a broad option for a URL, computed
 * where the URL is known and carried to whoever renders it: the chooser never
 * runs the suffix list itself, so an entry without it simply has no domain
 * option. */
export interface BroadGrant {
	scope: SiteGrant["scope"];
	key: string;
}

let pslRules: Set<string> | null = null;

/**
 * Install the public-suffix rules, once, before any approval is read.
 *
 * `null` (no rules available) is a supported state and not an error: it removes
 * the `domain` option and leaves every exact-origin decision untouched, which is
 * the fail-closed direction. See the header for why the data is injected.
 */
export function configurePslRules(rules: string | null): void {
	pslRules = rules ? new Set(rules.split("\n")) : null;
}

/** Whether the `domain` scope can be evaluated at all. Surfaced by `status` so
 * "why is there no 'all pages on this domain' option" has an answer. */
export function domainScopeAvailable(): boolean {
	return pslRules !== null;
}

/** The authority at the start of a URL literal, for the loopback rule below.
 * Module scope: the linter's top-level-regex rule. */
const RAW_AUTHORITY = /^https?:\/\/([^/?#]+)/i;

/** A dotted-quad IPv4 literal. */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

export function safeHttpUrl(raw: unknown): URL {
	if (typeof raw !== "string") throw new Error("URL is required");
	const parsed = new URL(raw);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("only http:// and https:// can be opened");
	}
	if (parsed.hostname === "127.0.0.1") {
		const authority = raw.match(RAW_AUTHORITY)?.[1] ?? "";
		const rawHost = authority.startsWith("[")
			? authority.slice(0, authority.indexOf("]") + 1)
			: authority.split(":", 1)[0];
		if (rawHost !== "127.0.0.1") {
			throw new Error("IPv4 loopback must use 127.0.0.1 exactly");
		}
	}
	return parsed;
}

/** Deliberately literal, not a DNS or subnet test. Names that happen to resolve
 * to loopback, shorthand IPv4, mapped IPv6, and localhost subdomains do not
 * earn the broader grant. URL parsing lowercases localhost and preserves IPv6
 * brackets; a trailing dot remains distinct and therefore fails closed. */
export function isLoopbackHost(url: URL): boolean {
	return (
		url.hostname === "localhost" ||
		url.hostname === "127.0.0.1" ||
		url.hostname === "[::1]"
	);
}

export function displayAuthority(url: URL): string {
	return url.host;
}

// ---- Registrable domain (Public Suffix List) ---------------------------------

function rules(): Set<string> {
	// No lazy parse: `configurePslRules` already built the set, and an empty
	// fallback here would silently behave like "every host is a public suffix".
	return pslRules ?? new Set<string>();
}

function isIpLiteral(hostname: string): boolean {
	return hostname.startsWith("[") || IPV4_LITERAL.test(hostname);
}

/**
 * The registrable domain (eTLD+1) of a URL's hostname, or null.
 *
 * The algorithm is the original's, unchanged: best matching rule wins, `*.`
 * wildcard and `!` exception included, with the implicit `*` rule as the
 * default; the public suffix is that rule (minus its first label for an
 * exception) and the registrable domain is the suffix plus one more label.
 *
 * Returns null, meaning NO domain option, for: IP literals (v4 dotted quad or
 * bracketed v6), a trailing-dot hostname, a single-label hostname, a hostname
 * that IS a public suffix (`co.uk`, `github.io`, `com`) — a grant keyed on any
 * of those would cover an unbounded set of unrelated sites — and, in this port,
 * every host when no PSL rules were configured at all.
 * `URL.hostname` is already lowercase punycode, so no normalisation here.
 */
export function registrableDomain(url: URL): string | null {
	const hostname = url.hostname;
	if (!hostname || hostname.endsWith(".") || isIpLiteral(hostname)) return null;
	const labels = hostname.split(".");
	if (labels.length < 2 || labels.some((label) => !label)) return null;
	const table = rules();
	if (table.size === 0) return null;
	let suffixLabels = 1;
	for (let index = labels.length - 1; index >= 0; index -= 1) {
		const candidate = labels.slice(index).join(".");
		const matched = labels.length - index;
		if (table.has(`!${candidate}`)) {
			suffixLabels = matched - 1;
			break;
		}
		if (table.has(candidate)) suffixLabels = Math.max(suffixLabels, matched);
		if (index > 0 && table.has(`*.${candidate}`)) {
			suffixLabels = Math.max(suffixLabels, matched + 1);
		}
	}
	if (labels.length <= suffixLabels) return null;
	return labels.slice(labels.length - suffixLabels - 1).join(".");
}

/** The broad grant the consent surface may offer for a URL: loopback gets a
 * host grant (any port, both schemes), everything else its registrable domain.
 * Null means only the exact-site and once options are offerable. */
export function broadGrantFor(url: URL): BroadGrant | null {
	if (isLoopbackHost(url)) return { scope: "host", key: url.hostname };
	const domain = registrableDomain(url);
	return domain ? { scope: "domain", key: domain } : null;
}

export function validSiteGrantSchema(value: unknown): value is SiteGrantsState {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		(value as { version?: unknown }).version === 1 &&
		!!(value as { grants?: unknown }).grants &&
		typeof (value as { grants?: unknown }).grants === "object" &&
		!Array.isArray((value as { grants?: unknown }).grants)
	);
}

function siteGrantScope(
	grant: SiteGrant | undefined,
	scope: SiteGrant["scope"],
): boolean {
	return grant?.scope === scope && typeof grant.createdAt === "number";
}

/**
 * Lookup order: exact origin, then a loopback host grant, then the registrable
 * domain. An unknown `siteGrants` version hides every site grant, so a record
 * written by a newer build prompts again here rather than being misread (fail
 * closed). `origins[x] === "deny"` is typed but is not an allow — a deny is
 * enforced by its own lookup in `approvals.ts`, not by this function.
 */
export function matchingGrantScope(
	origins: Record<string, StoredVerdict>,
	url: URL,
	siteGrants?: unknown,
): GrantScope | null {
	if (origins[url.origin] === "allow") return "origin";
	if (validSiteGrantSchema(siteGrants)) {
		if (isLoopbackHost(url)) {
			if (siteGrantScope(siteGrants.grants[url.hostname], "host"))
				return "host";
		} else {
			const domain = registrableDomain(url);
			if (domain && siteGrantScope(siteGrants.grants[domain], "domain")) {
				return "domain";
			}
		}
	}
	return null;
}

export function storedOriginAllowed(
	origins: Record<string, StoredVerdict>,
	url: URL,
	siteGrants?: unknown,
): boolean {
	return matchingGrantScope(origins, url, siteGrants) !== null;
}
