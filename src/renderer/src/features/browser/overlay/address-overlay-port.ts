/**
 * The renderer's only door to S2's mirror: one module that returns `null`
 * unless this launch is an armed dev-driver launch AND main registered the S2
 * channel. Nothing else in the renderer may touch `window.__loDevDriver` for
 * this feature, so "off" has exactly one answer and the ordinary app bridge
 * (`window.api`) is untouched.
 *
 * WHY IT LATCHES OFF ON "No handler registered": the channel is registered only
 * when the S2 gate passed. An armed S1-only launch therefore HAS the bridge but
 * no handler, and every frame would pay a rejected invoke plus an Electron error.
 * The first such rejection is proof this launch is not S2; latching is the
 * fail-closed, cheap answer. A later retry that arms S2 replaces the whole
 * renderer process, so the latch cannot hide a channel that appears mid-life.
 */

export interface AddressOverlayRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AddressOverlayRow {
	text: string;
	title: string;
}

export type AddressOverlayView =
	| { kind: "rows"; rows: AddressOverlayRow[] }
	| {
			kind: "notice";
			notice: "error" | "hint" | "empty" | "no_match";
			text: string;
	  };

export interface AddressOverlayTheme {
	elevated: string;
	ink: string;
	inkMuted: string;
	accent: string;
	accentWash: string;
	rowHover: string;
	hairline: string;
	control: string;
}

/** What the renderer is allowed to say: display text, its own measured
 * geometry, a seq and a theme. No URL, no HTML, no destination. */
export interface AddressOverlayPost {
	v: 1;
	seq: number;
	tabId: number;
	visible: boolean;
	pageRect: AddressOverlayRect;
	field: AddressOverlayRect;
	listTop: number;
	active: number;
	view: AddressOverlayView;
	label: string;
	dir: "ltr" | "rtl";
	theme?: AddressOverlayTheme;
}

export interface AddressOverlayCommit {
	type: "commit";
	seq: number;
	index: number;
}

export interface AddressOverlayPort {
	project(payload: AddressOverlayPost): Promise<unknown>;
	onEvent(callback: (event: unknown) => void): () => void;
}

const NO_HANDLER = /No handler registered/;

let latchedOff = false;
/**
 * Monotone across mounts. Main refuses a seq it has already accepted, and this
 * field survives route remounts inside one renderer process — a per-hook counter
 * would restart at 1 and be refused forever after the first remount.
 */
let seqCounter = 0;

export function nextAddressOverlaySeq(): number {
	seqCounter += 1;
	return seqCounter;
}

function looksLikeNoHandler(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return NO_HANDLER.test(message);
}

export function addressOverlayPort(): AddressOverlayPort | null {
	if (latchedOff) return null;
	const bridge =
		typeof window === "undefined" ? undefined : window.__loDevDriver;
	if (!bridge || bridge.armed !== true) return null;
	if (
		typeof bridge.addressOverlayProject !== "function" ||
		typeof bridge.onAddressOverlayEvent !== "function"
	) {
		return null;
	}
	return {
		project: (payload) =>
			bridge.addressOverlayProject(payload).catch((error: unknown) => {
				if (looksLikeNoHandler(error)) latchedOff = true;
				throw error;
			}),
		onEvent: (callback) => bridge.onAddressOverlayEvent(callback),
	};
}
