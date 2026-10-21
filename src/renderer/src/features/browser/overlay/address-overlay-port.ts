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

/**
 * Refusals main will repeat for the rest of this host's life: the child failed to
 * load (latched), the controller was disposed or the owner went away. A renderer
 * that retries these every frame turns one terminal failure into a runaway IPC
 * loop (QA round 1 measured 540 log lines on a load-timeout boot), so the hook
 * stops its projection loop on the first one.
 */
const PERMANENT_REFUSALS: ReadonlySet<string> = new Set([
	"overlay_failed",
	"disposed",
	"owner_unavailable",
]);

export function isPermanentOverlayRefusal(reason: unknown): boolean {
	return typeof reason === "string" && PERMANENT_REFUSALS.has(reason);
}

/**
 * Latch + single-flight state lives on the RENDERER GLOBAL, not in this module.
 * A code-split bundle can contain two copies of this module (the URL bar and a
 * lazily loaded browser surface), and per-copy state let both copies invoke once
 * — the residual two "No handler registered" lines QA measured on the S2-off
 * path. One renderer-wide object makes the first no-handler answer stop every
 * copy, and keeps one projection in flight process-wide.
 */
interface AddressOverlayPortState {
	latched: boolean;
	inFlight: Promise<unknown> | null;
}
const PORT_STATE_KEY = "__loAddressOverlayPortState";

function portState(): AddressOverlayPortState {
	const holder = globalThis as unknown as Record<
		string,
		AddressOverlayPortState | undefined
	>;
	const existing = holder[PORT_STATE_KEY];
	if (existing) return existing;
	const created: AddressOverlayPortState = { latched: false, inFlight: null };
	holder[PORT_STATE_KEY] = created;
	return created;
}
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

function unavailable(): Error {
	return new Error(
		"address_overlay_unavailable: the S2 projection channel is not armed in this launch",
	);
}

export function addressOverlayPort(): AddressOverlayPort | null {
	if (portState().latched) return null;
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
		project: (payload) => {
			// The latch is checked INSIDE the returned method as well as before it:
			// a caller that captured this object before the first no-handler answer
			// (the mirror hook does, for the life of its effect) must not keep
			// invoking a channel this process has proved is not registered.
			const state = portState();
			if (state.latched) {
				return Promise.reject(unavailable());
			}
			const run = (): Promise<unknown> => {
				if (state.latched) return Promise.reject(unavailable());
				return bridge.addressOverlayProject(payload).catch((error: unknown) => {
					if (looksLikeNoHandler(error)) state.latched = true;
					throw error;
				});
			};
			const previous = state.inFlight;
			const next = (previous ?? Promise.resolve()).then(run, run);
			state.inFlight = next;
			void next
				.catch(() => undefined)
				.then(() => {
					if (state.inFlight === next) state.inFlight = null;
				});
			return next;
		},
		onEvent: (callback) => bridge.onAddressOverlayEvent(callback),
	};
}
