/**
 * The supplement frame's mount URL (`lo-supplement:`), the ONE spelling the
 * renderer, the mount-permit table and the protocol handler must agree about
 * (turn-supplements memo §4.1, the P1 delivery decision).
 *
 * WHY THIS MODULE EXISTS. The frame's document used to be delivered as a
 * `data:text/html;base64,…` URL. In the built app that delivery is dead on
 * arrival: the renderer's own CSP (`src/renderer/index.html`) is inherited by
 * local-scheme child documents (the policy container of a `data:` frame comes
 * from its embedder), so the app's `script-src` blocks the vendored prelude and
 * EVERY frame falls back to `Couldn't render this graphic` (measured, UX round
 * 1, U1 — the blocked-script hash is the sha256 of `prelude.js`, byte-for-byte).
 * Storybook only ever rendered frames because Storybook carries no such CSP.
 *
 * THE REPLACEMENT is the memo's own fixed fallback ("Option 2's requirements
 * are fixed now", §4.1): frames are served from a dedicated `lo-supplement:`
 * scheme by the main process. A standard (non-local) scheme's document gets its
 * policy container from its own RESPONSE instead of inheriting the embedder's,
 * so the app's CSP no longer reaches the frame's inline scripts, and the frame
 * keeps `sandbox="allow-scripts"` — the origin stays opaque either way. The
 * bytes still come from the digest-addressed document family
 * (`/v1/desktop/sessions/{id}/supplements/{digest}/document`); main relays them
 * with its bearer, exactly as it relays every other media read, and never
 * crosses the token to the frame.
 *
 * THE URL IS CONTENT-ADDRESSED AND NOTHING ELSE: `lo-supplement://s/<session
 * id>/<digest>`, both ids exactly the shapes the media relay's schema admits
 * (`[a-f0-9]{12}` / `[a-f0-9]{32}`). There is no query, no fragment, no port,
 * no userinfo — `parseSupplementMountUrl` refuses anything else, and the
 * round-trip check (`raw === supplementMountUrl(…)`) makes "the URL we build"
 * and "the URL we accept" one statement rather than two spellings that can
 * drift. A hostile document cannot read anything out of this URL: it names a
 * stored digest, which is public within its own session by construction (the
 * digest already rides the row), and the frame's document either loads (with
 * the §4.1 policy) or does not.
 *
 * PURE: strings in, values out — no Electron, no I/O — so `supplement-mounts.ts`
 * (the main-process permit table) and its node suite can both use it, and the
 * renderer bundles the same builder.
 */

/** The scheme the main process registers and the frames load under. */
export const SUPPLEMENT_SCHEME = "lo-supplement";

/**
 * The host that names the stored-digest scope. One segment, constant, so the
 * parser has exactly one accepted authority and a typo cannot mint a second.
 */
const SUPPLEMENT_HOST = "s";

/** A desktop session id: the shape every `/v1/desktop/sessions/…` route takes. */
const SESSION_ID_RE = /^[a-f0-9]{12}$/;

/** A stored attachment digest: the shape every digest-addressed route takes. */
const DIGEST_RE = /^[a-f0-9]{32}$/;

/**
 * The mount URL for one stored document. THE ONLY BUILDER — the renderer's arm
 * call, the main-process permit and the protocol handler all speak this one
 * form.
 */
export function supplementMountUrl(sessionId: string, digest: string): string {
	return `${SUPPLEMENT_SCHEME}://${SUPPLEMENT_HOST}/${sessionId}/${digest}`;
}

/**
 * Parse a candidate mount URL, byte-strictly. Returns the addressed ids, or
 * `null` for every other string: wrong scheme, wrong host, a port, userinfo, a
 * query, a fragment, a non-hex or wrong-length id, an extra path segment, or
 * any spelling whose normalised form is not the exact string the builder would
 * mint (the round-trip test refuses percent-encoding and case tricks that a
 * prefix check would wave through).
 */
export function parseSupplementMountUrl(
	raw: unknown,
): { sessionId: string; digest: string } | null {
	if (typeof raw !== "string") return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== `${SUPPLEMENT_SCHEME}:`) return null;
	if (url.hostname !== SUPPLEMENT_HOST) return null;
	if (url.username !== "" || url.password !== "") return null;
	if (url.port !== "") return null;
	if (url.search !== "" || url.hash !== "") return null;
	const segments = url.pathname.split("/");
	if (segments.length !== 3 || segments[0] !== "") return null;
	const sessionId = segments[1];
	const digest = segments[2];
	if (!SESSION_ID_RE.test(sessionId) || !DIGEST_RE.test(digest)) return null;
	// Round-trip: the string must BE the builder's own output, so nothing the
	// URL normaliser rewrote (an encoded octet, a case fold) can pass here while
	// failing to match an armed permit byte-for-byte.
	if (raw !== supplementMountUrl(sessionId, digest)) return null;
	return { sessionId, digest };
}
