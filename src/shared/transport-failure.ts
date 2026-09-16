/**
 * Transport failures, classified once for both processes.
 *
 * WHY this lives in `shared/`. Two very different surfaces decide what to do
 * with the same failure - MAIN decides whether to retry a feed fetch and
 * whether the failure is worth a message at all, and the RENDERER decides what
 * sentence a person reads - and both were guessing from a substring list of
 * their own. `update-service.ts` filtered on ENOTFOUND/ETIMEDOUT/ECONNREFUSED
 * and missed every Chromium spelling, while `toast-manager.ts` carried
 * `net::ERR_CONNECTION_REFUSED` in a table of verbatim strings and nothing
 * else, so the family arrived at the user as a raw machine string. One module
 * both processes read is what stops the two answers from drifting apart
 * again.
 *
 * WHAT "transient" MEANS HERE, and what it does not. Transient is "this
 * machine could not reach the network this instant": a Wi-Fi roam, a wake, a
 * resolver blip - a failure whose next attempt, seconds later, is expected to
 * work. It is NOT a server that answered (a 404, a 5xx, a refused credential),
 * and NOT a certificate or TLS verdict: `net::ERR_SSL_PROTOCOL_ERROR` and the
 * `net::ERR_CERT_*` family say the peer is wrong or the trust chain is, which
 * no amount of retrying fixes, so they are deliberately absent from the lists
 * below.
 *
 * WHERE THE LIST COMES FROM. The operator's own
 * `~/Library/Application Support/Local Operator/logs/update-service.log` holds
 * 90 such failures over four days, every one of them followed by a check five
 * minutes later that succeeded: `net::ERR_CONNECTION_RESET` (36),
 * `net::ERR_TIMED_OUT` (24), `net::ERR_CONNECTION_REFUSED` (14),
 * `net::ERR_NETWORK_CHANGED` (8), `net::ERR_INTERNET_DISCONNECTED` (8), plus a
 * `getaddrinfo ENOTFOUND pypi.org` at the same instant. Each of those was
 * reported to the user as the alert reading `net::ERR_INTERNET_DISCONNECTED`,
 * over a chat screen, on a machine with continuous internet. The codes below
 * are that list plus the neighbours a resolver or a proxy produces the same
 * way, and the errno forms Node's own `getaddrinfo`/socket errors carry.
 */

/**
 * Chromium's `net::ERR_*` spellings, as `net.request` reports them.
 *
 * Electron's updater fetches its feed through the `net` module
 * (`node_modules/electron-updater/out/electronHttpExecutor.js`), so a failed
 * feed fetch surfaces one of these - the family is not decoration, it is the
 * exact vocabulary of the failure the user saw.
 */
export const CHROMIUM_TRANSPORT_CODES = [
	"ERR_INTERNET_DISCONNECTED",
	"ERR_NETWORK_CHANGED",
	"ERR_NAME_NOT_RESOLVED",
	"ERR_TIMED_OUT",
	"ERR_CONNECTION_RESET",
	"ERR_CONNECTION_REFUSED",
	"ERR_CONNECTION_CLOSED",
	"ERR_CONNECTION_FAILED",
	"ERR_CONNECTION_TIMED_OUT",
	"ERR_ADDRESS_UNREACHABLE",
	"ERR_NETWORK_IO_SUSPENDED",
	"ERR_PROXY_CONNECTION_FAILED",
] as const;

/**
 * The errno forms: what a Node socket or resolver says instead.
 *
 * `getaddrinfo ENOTFOUND pypi.org` is in the log beside the Chromium failures,
 * at the same instant, from the backend update path.
 */
export const NODE_ERRNO_CODES = [
	"ENOTFOUND",
	"EAI_AGAIN",
	"ETIMEDOUT",
	"ECONNRESET",
	"ECONNREFUSED",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENETDOWN",
	"ENETRESET",
	"ECONNABORTED",
	"EPIPE",
] as const;

/**
 * What a `fetch` says when the transport failed, engine by engine.
 *
 * These are SENTENCES rather than codes, and that changes how they are matched:
 * a code is machine vocabulary wherever it appears, while "Failed to fetch" can
 * legitimately be part of prose someone wrote - `Failed to fetch conversation
 * messages` is a sentence, and rewriting it would lose what it says. So an
 * engine phrase counts only when it forms a whole CLAUSE of the message: at the
 * start or after a separator, and at the end or before one. That is the same
 * judgement the toast table made by requiring an exact match, generalised to
 * the case the table could not cover - `Failed to post comment: Failed to
 * fetch`, where the authored prefix is worth keeping and the fragment is not
 * worth showing.
 */
export const ENGINE_TRANSPORT_FAILURES = [
	"Failed to fetch",
	"Load failed",
	"NetworkError when attempting to fetch resource.",
] as const;

const CHROMIUM_SET: ReadonlySet<string> = new Set(CHROMIUM_TRANSPORT_CODES);

/*
 * The two prefix shapes `stripErrorPrefixes` removes, at module scope: a
 * literal inside the function is rebuilt on every call, which is the cost the
 * top-level-regex rule exists to remove.
 */
/*
 * What separates one clause of a message from the next, for `isClause`: a
 * colon, a dash (either one), or a line break. Hoisted because a literal inside
 * the function is rebuilt on every classification.
 */
const CLAUSE_END = /[:\-\u2014\n]$/;
const CLAUSE_START = /^[:\n]/;

const LEADING_ERROR_PREFIXES = /^(?:\s*Error:\s*)+/;
const EMBEDDED_ERROR_PREFIX = /:\s+Error:\s+/g;

/*
 * Both spellings, because both reach the app: `net::ERR_X` is what Electron's
 * `net` module reports, while a bare `ERR_X` is what Chromium's network stack
 * leaves in a string that travelled through a page or a wrapped message - and
 * the toast table already carried `ERR_CONNECTION_REFUSED` on its own, which
 * is one of these having arrived in the wrong register once before.
 */
const CHROMIUM_CODE_PATTERN = /\b(?:net::)?(ERR_[A-Z0-9_]+)\b/g;

/*
 * The errno forms are matched as tokens (`ENOTFOUND` must not be found inside a
 * longer identifier), and their patterns are built ONCE at module scope: a
 * `RegExp` constructed per call is rebuilt on every classification, which is
 * the same cost the top-level-regex lint rule exists to remove.
 */
const NODE_ERRNO_PATTERNS: readonly { code: string; pattern: RegExp }[] =
	NODE_ERRNO_CODES.map((code) => ({
		code,
		pattern: new RegExp(`\\b${code}\\b`),
	}));

/**
 * One transient transport failure, located inside a larger message.
 *
 * The offsets index the STRIPPED message (`stripErrorPrefixes`), which is what
 * both callers have in hand: a consumer that keeps the authored prefix and
 * replaces only the machine fragment needs to know which characters those are,
 * and re-finding them with a second regex of its own is how two spellings of
 * one rule start to drift.
 */
export interface TransportFragment {
	/** The code in its canonical spelling, e.g. `net::ERR_NETWORK_CHANGED`. */
	code: string;
	/** Start offset within the stripped message. */
	start: number;
	/** End offset (exclusive) within the stripped message. */
	end: number;
	/**
	 * Whether this fragment stands as its own clause of the message.
	 *
	 * This is what tells a consumer whether the text around it is AUTHORED or
	 * machine wrapping, and the two want opposite treatment:
	 *
	 * - `Error downloading update: net::ERR_TIMED_OUT` - the code is the final
	 *   clause, so the sentence replaces the CODE and the prefix survives. The
	 *   prefix is the app's own account of what it was doing, and dropping it
	 *   would lose which action failed.
	 * - `getaddrinfo ENOTFOUND pypi.org` - the token sits inside machine
	 *   vocabulary, so the sentence replaces the WHOLE message. Substituting only
	 *   the token leaves "getaddrinfo <sentence> pypi.org", which is not an
	 *   improvement on the code it replaced.
	 */
	clause: boolean;
}

/**
 * Whether an engine phrase at these offsets is a clause of the message rather
 * than part of a sentence somebody wrote.
 */
function isClause(message: string, start: number, length: number): boolean {
	const before = message.slice(0, start).trimEnd();
	const after = message.slice(start + length).trimStart();
	const beforeIsBoundary = before === "" || CLAUSE_END.test(before);
	const afterIsBoundary = after === "" || CLAUSE_START.test(after);
	return beforeIsBoundary && afterIsBoundary;
}

/**
 * The transient transport failure this message carries, or null.
 *
 * Matching is on the CODE rather than on the surrounding sentence, and that is
 * the property the real shapes need. The updater wraps this failure at least
 * twice in the wild: the operator's log holds
 *
 *     Cannot parse releases feed: Error: Unable to find latest version on
 *     GitHub (https://github.com/.../releases/latest), please ensure a
 *     production release exists: Error: net::ERR_NETWORK_CHANGED
 *
 * as one `err.message`, so a table of whole strings could not have caught it -
 * the code is the only part of that message that is stable.
 */
export function transientTransportFragment(
	input: unknown,
): TransportFragment | null {
	const message = messageOf(input);
	if (!message) return null;
	const cleaned = stripErrorPrefixes(message);

	for (const match of cleaned.matchAll(CHROMIUM_CODE_PATTERN)) {
		const code = match[1];
		if (!CHROMIUM_SET.has(code)) continue;
		const start = match.index ?? 0;
		const end = start + match[0].length;
		return {
			code: `net::${code}`,
			start,
			end,
			clause: isClause(cleaned, start, end - start),
		};
	}

	/*
	 * The surrounding text is free to be anything
	 * (`getaddrinfo ENOTFOUND pypi.org`).
	 */
	for (const { code, pattern } of NODE_ERRNO_PATTERNS) {
		const match = pattern.exec(cleaned);
		if (match) {
			const start = match.index;
			const end = start + match[0].length;
			return {
				code,
				start,
				end,
				clause: isClause(cleaned, start, end - start),
			};
		}
	}

	for (const phrase of ENGINE_TRANSPORT_FAILURES) {
		const start = cleaned.indexOf(phrase);
		if (start === -1) continue;
		// An engine phrase is only a match AS a clause, so this is true by
		// construction here rather than merely likely.
		if (!isClause(cleaned, start, phrase.length)) continue;
		return {
			code: phrase,
			start,
			end: start + phrase.length,
			clause: true,
		};
	}

	return null;
}

/**
 * The code this failure carries, or null.
 *
 * Returns the code in its canonical spelling (`net::ERR_NETWORK_CHANGED`,
 * `ENOTFOUND`), which is what a machine-voice line may show.
 */
export function transientTransportCode(input: unknown): string | null {
	return transientTransportFragment(input)?.code ?? null;
}

/**
 * Whether this failure is a transient transport one - see the module header
 * for what that excludes and why.
 */
export function isTransientTransportFailure(input: unknown): boolean {
	return transientTransportCode(input) !== null;
}

/**
 * The message, whether the caller held an Error or the string itself.
 *
 * An `Error` whose `message` is empty falls back to its `name`, so a
 * `DOMException`-shaped failure is not read as "no failure at all".
 */
function messageOf(input: unknown): string {
	if (typeof input === "string") return input;
	if (input instanceof Error) return input.message || input.name || "";
	if (input && typeof input === "object" && "message" in input) {
		const message = (input as { message?: unknown }).message;
		return typeof message === "string" ? message : "";
	}
	return "";
}

/**
 * Strip the nested `Error: ` prefixes a wrapped message carries.
 *
 * WHY this is not cosmetic. Every producer that concatenates an inner failure
 * into its own text brings the inner error's `toString()` with it - the log
 * line `Update error: Error: Cannot parse releases feed: Error: Unable to
 * find latest version on GitHub (...): Error: net::ERR_NETWORK_CHANGED` is a
 * single message with three of them - and the doubled `Error: Error:` shape is
 * the same defect one level up (electron-updater's own logger prints
 * `Error: <stack>`, whose first line already reads `Error: <message>`). A
 * person reading that has to parse a nesting they did not ask about; the codes
 * and the prose underneath are the part that means something.
 *
 * Only a LEADING run of prefixes and the `X: Error: Y` concatenation are
 * removed. `"Parse Error: unexpected token"` is untouched, because a prefix
 * followed by a space and no colon is prose someone wrote on purpose, and
 * rewriting prose is a worse defect than an ugly machine line.
 */
export function stripErrorPrefixes(message: string): string {
	return message
		.replace(LEADING_ERROR_PREFIXES, "")
		.replace(EMBEDDED_ERROR_PREFIX, ": ");
}
