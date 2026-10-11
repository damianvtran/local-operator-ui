/**
 * The `lo-supplement:` protocol: the ONE surface that serves a supplement
 * frame's document to the renderer (turn-supplements memo §4.1 — "Option 2's
 * requirements are fixed now"; the P1 delivery decision the app path needs,
 * see `src/shared/supplement-frame-url.ts` for why the `data:` URL cannot work
 * under this app's own CSP).
 *
 * WHAT IT SERVES, AND ONLY THAT. One stored digest's assembled document, for
 * one session, addressed by the exact URL form the renderer armed
 * (`parseSupplementMountUrl`; any other spelling is refused before a byte is
 * fetched). The bytes come from the same digest-addressed document family every
 * other supplement read uses — `sessions.supplementDocument`, whose route
 * re-authorises per request (session on disk, digest referenced by that
 * session's journal) — fetched with main's bearer. The frame never sees the
 * token, an address, or a URL it could re-purpose: it sees its own digest.
 *
 * THE RESPONSE CARRIES THE §4.1 POLICY AS A HEADER — not instead of the
 * document's own `<meta>` copy, but beside it: the meta is the half that
 * survives every relay (`docs/design/turn-supplements.md` §2.7), the header is
 * the half this app can guarantee locally, and a policy stated twice cannot
 * drift UP, only tighten. `nosniff` and `no-store` ride with it because the
 * document is a closed, immutable artifact: nothing about it wants sniffing,
 * caching or revalidation, and a stored digest is addressed by content, so a
 * refetch is always safe.
 *
 * WHY A CUSTOM SCHEME AND NOT A DIRECT HTTP FRAME URL. The daemon's document
 * route sits behind the desktop plane's bearer, and a frame navigation cannot
 * carry an `Authorization` header; putting the token in a URL would leak the
 * credential into the frame's own `location` and every log it passes. The
 * scheme handler is the only surface that can add the header without exposing
 * it — the same reason the media relay exists for every other authenticated
 * read — and `bypassCSP: false` (below) keeps the page's own frame-src a live
 * check on which URLs may be framed at all.
 *
 * PRIVILEGES, fixed by the memo: `standard: true` (a real origin, an ordinary
 * URL parser, subframe-loadable), `secure: false` (a secure context would
 * re-open `RTCPeerConnection`, `navigator.clipboard` and `crypto.subtle` —
 * none of which a graphic needs), `corsEnabled: false`, `bypassCSP: false`
 * (the scheme does not bypass the embedding document's CSP; the renderer's
 * `frame-src` names it explicitly, and the frame keeps `sandbox="allow-scripts"`
 * so its origin stays opaque regardless).
 */

import { protocol } from "electron";
import {
	SUPPLEMENT_SCHEME,
	parseSupplementMountUrl,
} from "../shared/supplement-frame-url";

/**
 * The document policy, byte-for-byte `supplements.document.CONTENT_SECURITY_POLICY`
 * in the core (`local_operator/supplements/document.py`) — one policy, two
 * places it is stated (the document's own `<meta>`, and this response header).
 * A copy in the other repository's vocabulary is deliberate: this half must not
 * depend on the tunnel's header forwarding or on any core read to be enforced.
 */
export const SUPPLEMENT_DOCUMENT_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
	"img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; " +
	"form-action 'none'; base-uri 'none'";

/** What one relay answer resolves to for the handler: the document, or not. */
export type SupplementDocumentFetch = (
	sessionId: string,
	digest: string,
) => Promise<{ html: string | null }>;

/**
 * Register the scheme as privileged. MUST run before the app is ready —
 * Electron accepts `registerSchemesAsPrivileged` only up to that point — which
 * is why this is a module-scope call in `index.ts`, beside the other
 * pre-ready wiring.
 */
export function registerSupplementScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: SUPPLEMENT_SCHEME,
			privileges: {
				standard: true,
				secure: false,
				corsEnabled: false,
				bypassCSP: false,
			},
		},
	]);
}

/**
 * Install the handler. Called once, after the app is ready, with the media
 * relay (`backendService.requestDesktopMedia`, so the bearer is added in main
 * and never crosses to the renderer) and the app's logger.
 *
 * Every refusal answers with an empty body and a status: a frame that cannot
 * get its document paints the frame-level fallback line through its own
 * watchdog (`no-ready`), never a half-served page.
 */
export function installSupplementProtocol(
	fetchDocument: SupplementDocumentFetch,
	log: (message: string) => void,
): void {
	protocol.handle(SUPPLEMENT_SCHEME, async (request) => {
		const parsed = parseSupplementMountUrl(request.url);
		if (parsed === null) {
			// Not a URL this app ever mints (a foreign scheme use, an
			// encoding trick, a hand-built string): nothing to serve and
			// nothing to learn from it.
			return new Response("", { status: 400 });
		}
		let document: { html: string | null };
		try {
			document = await fetchDocument(parsed.sessionId, parsed.digest);
		} catch {
			// The relay never rejects for a refusal (`requestDesktopMedia`
			// resolves with a status), so this is a bug or a main-process
			// teardown; a fail-closed answer is the same as "cannot show it".
			log(
				`[supplement-protocol] document relay threw for ${parsed.sessionId}/${parsed.digest.slice(0, 8)}…`,
			);
			return new Response("", { status: 502 });
		}
		if (document.html === null) {
			// A pruned blob, a refusal, a peer-hosted session: the same fact
			// the renderer's own fetch reports as `documentFailed`.
			return new Response("", { status: 404 });
		}
		return new Response(document.html, {
			status: 200,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"content-security-policy": SUPPLEMENT_DOCUMENT_CSP,
				"x-content-type-options": "nosniff",
				"cache-control": "no-store",
			},
		});
	});
}
