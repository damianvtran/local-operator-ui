/**
 * One-shot mount permits for supplement frames.
 *
 * WHY THIS EXISTS (turn-supplements memo §4.1, round-1 S-R1/S-R4). A
 * `sandbox="allow-scripts"` iframe may navigate ITSELF — the sandbox covers
 * navigation of other contexts, not the frame's own `location=` — so the
 * main window's navigation guard must allow exactly ONE child-frame navigation
 * per mounted frame: the `data:` URL the app itself set in `src`. Everything
 * after it is a hostile navigation, whatever the URL says.
 *
 * WHY A URL LIST RATHER THAN AN ALLOWANCE FOR `data:` OR A NONCE. A blanket
 * `data:` allowance would also admit a re-navigation to a `data:` URL carrying
 * a nonce the component read off its own `location.href`, which is the attack
 * class this rule exists to close (round-1 review S-R4). The permit is
 * therefore BYTE-FOR-BYTE the URL the renderer armed — minted from the
 * document the media relay served, never from component-authored text — and it
 * is CONSUMED on the first match, so the same URL never passes twice.
 *
 * WHAT IT DOES NOT PROVE. A frame element is not named on the arm (the arming
 * document cannot see Electron's `WebFrameMain` identity), so a hostile
 * document that already runs inside one supplement frame can consume a
 * SIBLING frame's permit with a byte-identical navigation, at most once per
 * armed sibling. The blast radius of that theft is bounded by the caller's
 * own belt: every frame counts its `load` events and a frame whose counter has
 * moved is unmounted as hostile, and the stolen navigation loads the sibling's
 * own sandboxed, CSP-closed document — never attacker-authored content. The
 * permit list is also bounded, so a mount that never navigates cannot grow
 * main's memory (nothing is deleted while a frame may still be loading: the
 * oldest permit is dropped instead, which fails closed — the frame's own
 * fallback line, never an unbounded list).
 *
 * PURE (strings in, a verdict out, nothing from Electron), so the node suite
 * drives the whole table without a window — `scripts/window-guards.test.mjs`.
 */

/** The URL prefix every permitted mount must carry. */
const DATA_HTML_PREFIX = "data:text/html;base64,";

/** Only base64 URL characters after the prefix; a stray colon or `#` is refused. */
const BASE64_BODY = /^[A-Za-z0-9+/=]+$/;

/**
 * The longest URL a permit may hold. The document cap is 64 KB (§4.1), which
 * is ~87 KB once base64 inflates it by a third; 512 KB leaves generous room
 * and still bounds what one arm call can pin in main's memory.
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
 * Whether a value is a mount URL the renderer may arm: a `data:text/html`
 * base64 URL. Everything else — a live URL, a `blob:`, a bare string, a
 * non-string — is refused. The bytes AFTER this check are carried verbatim:
 * the permit matches the armed string exactly.
 */
export function isArmableMountUrl(raw: unknown): raw is string {
	if (typeof raw !== "string") return false;
	if (raw.length > MAX_MOUNT_URL_CHARS) return false;
	if (!raw.startsWith(DATA_HTML_PREFIX)) return false;
	return BASE64_BODY.test(raw.slice(DATA_HTML_PREFIX.length));
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
	 * THE ONLY WRITER, and it is called from the arm channel: the IPC handler
	 * checks the sender is the app's main frame before arming anything.
	 */
	public arm(raw: unknown): boolean {
		if (!isArmableMountUrl(raw)) return false;
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
