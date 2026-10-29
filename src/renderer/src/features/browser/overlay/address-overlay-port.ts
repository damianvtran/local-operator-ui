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
	/** The span of `text` holding the user's own value, which the child isolates
	 * as an LTR run (see `AddressListIsolate` in main). Display only. */
	isolate?: { start: number; end: number };
}

export type AddressOverlayView =
	| { kind: "rows"; rows: AddressOverlayRow[] }
	| {
			kind: "notice";
			notice: "error" | "empty" | "no_match";
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

/**
 * What the renderer is allowed to say: display text, the strip's own anchor, a
 * seq and a theme. No URL, no HTML, no destination, and no child rectangle —
 * main derives the child's box from the trusted page rect and this anchor.
 */
export interface AddressOverlayPost {
	v: 2;
	seq: number;
	tabId: number;
	visible: boolean;
	pageRect: AddressOverlayRect;
	anchor: { x: number; width: number };
	active: number;
	view: AddressOverlayView;
	label: string;
	dir: "ltr" | "rtl";
	theme?: AddressOverlayTheme;
}

/** A hide is the one projection that carries no geometry. */
export interface AddressOverlayHide {
	v: 2;
	seq: number;
	tabId: number;
	visible: false;
}

export interface AddressOverlayCommit {
	type: "commit";
	seq: number;
	index: number;
}

export interface AddressOverlayEvent {
	type: "commit" | "dismiss";
	seq?: number;
	index?: number;
	reason?: string;
}

export interface AddressOverlayPort {
	project(payload: AddressOverlayPost | AddressOverlayHide): Promise<unknown>;
	onEvent(callback: (event: AddressOverlayEvent) => void): () => void;
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
	/** The product channel answered "No handler registered", so this launch is a
	 * probe without the product door. Sticky for the renderer process: the answer
	 * cannot change without a relaunch. */
	productDoorRefused: boolean;
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
	const created: AddressOverlayPortState = {
		latched: false,
		productDoorRefused: false,
		inFlight: null,
	};
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

/** One door's pair of calls. A door is a transport, not a trust decision. */
interface AddressOverlayDoor {
	project: (
		payload: AddressOverlayPost | AddressOverlayHide,
	) => Promise<unknown>;
	onEvent: (callback: (event: AddressOverlayEvent) => void) => () => void;
}

/** The armed evidence launch's door, or null when this renderer has no driver. */
function devDoor(): AddressOverlayDoor | null {
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
		project: (payload) => bridge.addressOverlayProject(payload),
		onEvent: (callback) =>
			bridge.onAddressOverlayEvent(callback as (event: unknown) => void),
	};
}

/**
 * The PRODUCT door first, the probe door second, and a no-handler answer DEMOTES
 * the product door instead of latching everything off.
 *
 * S4b's popout is default-on (darwin) and must not read `__loDevDriver`: that
 * object exists only for an armed evidence launch. The ordinary app bridge is
 * the product path. But the bridge is defined by PRELOAD unconditionally, while
 * main registers `browser-address-overlay-project` only when the product
 * controller is wired — so in an S1–S3 probe launch the first projection used to
 * reject "No handler registered" and set the renderer-wide latch, which also hid
 * the dev-driver door for the rest of the run (agent review round 1, MINOR-1).
 * A refusal now remembers only that the PRODUCT door is closed.
 *
 * Both event subscriptions are opened while both doors exist. In a product
 * launch the driver object is absent; in a probe launch the product channel is
 * never sent on. Nothing can arrive twice.
 */
export function addressOverlayPort(): AddressOverlayPort | null {
	if (portState().latched) return null;
	const productBridge =
		typeof window === "undefined"
			? undefined
			: window.api?.browser?.addressOverlay;
	const product: AddressOverlayDoor | null = productBridge
		? {
				project: (payload) => productBridge.project(payload),
				onEvent: (callback) =>
					productBridge.onEvent(callback as (event: unknown) => void),
			}
		: null;
	const dev = devDoor();
	if (!product && !dev) return null;
	return makePort(product, dev);
}

function makePort(
	product: AddressOverlayDoor | null,
	dev: AddressOverlayDoor | null,
): AddressOverlayPort {
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
			const run = async (): Promise<unknown> => {
				if (state.latched) throw unavailable();
				if (product && !state.productDoorRefused) {
					try {
						return await product.project(payload);
					} catch (error) {
						if (!looksLikeNoHandler(error)) throw error;
						state.productDoorRefused = true;
						if (!dev) {
							state.latched = true;
							throw error;
						}
					}
				}
				if (dev) {
					try {
						return await dev.project(payload);
					} catch (error) {
						// The dev door is the last one: its no-handler answer is the latch.
						if (looksLikeNoHandler(error)) state.latched = true;
						throw error;
					}
				}
				state.latched = true;
				throw unavailable();
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
		onEvent: (callback) => {
			const offProduct = product?.onEvent(callback) ?? (() => {});
			const offDev = dev?.onEvent(callback) ?? (() => {});
			return () => {
				offProduct();
				offDev();
			};
		},
	};
}
