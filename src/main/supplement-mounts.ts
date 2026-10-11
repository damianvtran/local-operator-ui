/**
 * One-shot mount permits for supplement frames.
 *
 * WHY THIS EXISTS (turn-supplements memo §4.1, round-1 S-R1/S-R4). A
 * `sandbox="allow-scripts"` iframe may navigate ITSELF — the sandbox covers
 * navigation of other contexts, not the frame's own `location=` — so the
 * main window's navigation guard must allow exactly ONE child-frame navigation
 * per mounted frame: the `lo-supplement:` URL the app itself set in `src`.
 * Everything after it is a hostile navigation, whatever the URL says.
 *
 * WHY A URL LIST RATHER THAN A SCHEME ALLOWANCE OR A NONCE. A blanket allowance
 * for the scheme would admit a re-navigation to the same document under a fresh
 * spelling, which is the attack class this rule exists to close (round-1 review
 * S-R4: a document can read `location.href` and re-navigate to a URL carrying
 * the host's fragment). The permit is therefore BYTE-FOR-BYTE the URL the
 * renderer armed — minted by `supplementMountUrl` from the document the relay
 * served, never from component-authored text — and it is CONSUMED on the first
 * match, so the same URL never passes twice.
 *
 * WHAT IT DOES NOT PROVE, kept stated so a later pass never has to rediscover it
 * (memo §3.3 U6 asks for "the first navigation per frame element"; round-1 R3).
 * A frame element is not named on the arm — the arming document cannot see
 * Electron's `WebFrameMain` identity — so the permit is keyed by URL, not by
 * frame element, and a hostile document that already runs inside one supplement
 * frame can consume a SIBLING frame's permit with a byte-identical navigation,
 * at most once per armed sibling. The blast radius of that theft is bounded by
 * the caller's own belt: every frame counts its `load` events and a frame whose
 * counter has moved is unmounted as hostile, and the robbed sibling then fails
 * closed (`no-ready`/`second-load`); what loads is the sibling's own sandboxed,
 * CSP-closed document — never attacker-authored content. The permit list is also
 * bounded, so a mount that never navigates cannot grow main's memory (nothing is
 * deleted while a frame may still be loading: the oldest permit is dropped
 * instead, which fails closed — the frame's own fallback line, never an
 * unbounded list). Path (b) of round-1 R4 — a mount cancelled between `arm` and
 * `src` leaving its permit standing until eviction — is the same bounded,
 * fail-closed residue and is deliberately accepted, not papered over: the wire
 * cannot order an asynchronous `release` against the live mount's own
 * navigation (a release that lands after the theft window closes may remove the
 * permit the LIVE sibling is about to spend), and an idempotent arm (below)
 * already removes the real leak — the dev-mode double-effect.
 *
 * PURE (strings in, a verdict out, nothing from Electron), so the node suite
 * drives the whole table without a window — `scripts/window-guards.test.mjs`.
 */

import { parseSupplementMountUrl } from "../shared/supplement-frame-url";

/**
 * The longest URL a permit may hold. The accepted form is ~60 characters
 * (`lo-supplement://s/<12 hex>/<32 hex>`), so this can never bite a real mount;
 * it stays as the cheap bound on what one arm call can pin in main's memory —
 * the same reason it existed when the mount was a base64 document.
 */
export const MAX_MOUNT_URL_CHARS = 512 * 1024;

/**
 * How many unconsumed permits may stand at once. Frames mount in ones and
 * twos in the common case (MAX_COMPONENTS is 3 per block); the cap only
 * matters after a leak, and a leaked permit fails CLOSED when evicted (the
 * navigation that needed it is denied).
 */
export const MAX_ARMED_MOUNTS = 64;

/**
 * Whether a value is a mount URL the renderer may arm: a `lo-supplement:` URL
 * of exactly the builder's form (see `parseSupplementMountUrl` — wrong scheme,
 * host, extra segments, ports, queries, fragments and percent-encoding are all
 * refused; the round-trip check is what makes that "exactly"). The bytes AFTER
 * this check are carried verbatim: the permit matches the armed string exactly.
 */
export function isArmableMountUrl(raw: unknown): raw is string {
	if (typeof raw !== "string") return false;
	if (raw.length > MAX_MOUNT_URL_CHARS) return false;
	return parseSupplementMountUrl(raw) !== null;
}

/**
 * The permit list. One instance lives in `index.ts` and is shared by the two
 * halves that must agree about it: the arm channel (renderer -> main) and the
 * main window's navigation guard.
 */
export class SupplementFrameMounts {
	private readonly armed: string[] = [];

	/**
	 * Arm one mount URL. Returns whether it was accepted, so the caller (an IPC
	 * handler, where a branch is free) can answer `{ ok: false }` instead of
	 * letting a bad URL disappear into a list nobody inspects.
	 *
	 * IDEMPOTENT for a byte-identical URL that still stands unconsumed: React's
	 * development StrictMode runs every effect setup twice (the first setup is
	 * discarded before it assigns `src`), and a plain push left one unconsumed
	 * permit standing per mount in development (round-1 R4). The double-arm now
	 * collapses onto one permit — which the single real navigation then consumes
	 * — instead of leaking one. This is deliberately the ONLY fix for that path:
	 * a `release` op was rejected because the wire cannot order it against the
	 * live mount's navigation (see the header's path (b) note).
	 *
	 * THE ONLY WRITER, and it is called from the arm channel: the IPC handler
	 * checks the sender is the app's main frame before arming anything.
	 */
	public arm(raw: unknown): boolean {
		if (!isArmableMountUrl(raw)) return false;
		if (this.armed.includes(raw)) return true;
		this.armed.push(raw);
		while (this.armed.length > MAX_ARMED_MOUNTS) this.armed.shift();
		return true;
	}

	/**
	 * Whether a child-frame navigation may proceed under a permit, consuming
	 * the permit when it does. Byte-for-byte equality — never a prefix, a
	 * fragment match or a scheme test — so the pass is exactly the navigation
	 * the host itself armed.
	 */
	public consume(url: string): boolean {
		const at = this.armed.indexOf(url);
		if (at < 0) return false;
		this.armed.splice(at, 1);
		return true;
	}

	/** How many permits stand unconsumed, for the node suite's assertions. */
	public get armedCount(): number {
		return this.armed.length;
	}
}
