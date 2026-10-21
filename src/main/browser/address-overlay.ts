/**
 * S1 of the address-overlay direction: a native child `WebContentsView` that
 * proves overlap with the live page, behind a double headless gate.
 *
 * WHY THIS EXISTS, and what it deliberately is NOT. A DOM popup in the app's own
 * renderer cannot paint above a driven page: the page is a separate native
 * surface (`WebContentsView`) added to the window's content view, so the only
 * way to hold a rectangle over it without moving or hiding it is another native
 * child added last. This module owns exactly one such child for one desktop
 * window and nothing else. It has no editor, no suggestion list, no selection,
 * no commit path, no focus, no user-facing trigger and no final theming claim;
 * S2/S3 own those. The rectangle is deliberately the top blank strip of the
 * already-reported content rect, so the proof is "the child paints above the
 * page" rather than "the list lines up with the URL field".
 *
 * TRUST: the child loads one fixed packaged document from this app's own
 * renderer tree, in a dedicated in-memory session (no `persist:` prefix), with
 * sandbox + context isolation, no Node, JavaScript off, no preload and no
 * child-to-main protocol. It rejects every navigation and redirect that is not
 * that exact document, denies popups, permissions and downloads. The document
 * itself is static and inert with a strict CSP; there is no scripting surface to
 * reach in the first place.
 *
 * LIFETIME: lazy on the first explicit probe show; at most one child; hidden
 * rather than destroyed between shows; destroyed and detached on tab close,
 * owner loss, route loss, resize/layout invalidation, crash, host stop and
 * window close. A load failure or child crash latches off for the rest of the
 * host's lifetime so a broken document cannot become a restart loop.
 *
 * WHY THE CONSTANTS AND THE LAYOUT OBSERVER LIVE HERE: the registry delivers a
 * copied layout snapshot after every page layout pass; this module is the only
 * consumer that turns it into a native rectangle. Keeping the arithmetic pure
 * and exported is what lets `scripts/browser-address-overlay.test.mjs` assert
 * the numeric edges without an Electron.
 *
 * THE BYTECODE CONSTRAINT (`electron.vite.config.js`): packaged main is compiled
 * to V8 bytecode, which cannot compile an arrow function inside a class
 * property. Every field below is assigned in the constructor; nothing that
 * survives into the packaged build is a class-field arrow.
 */

import { randomUUID } from "node:crypto";
import {
	type BrowserWindow,
	type WebContents,
	WebContentsView,
	session,
} from "electron";
import type { WindowMode } from "../window-mode";

/** The exact opt-in. Absent or anything other than `1` is off. */
export const ADDRESS_OVERLAY_S1_ENV =
	"LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1";

/** The packaged document, a sibling of the trusted renderer index. */
export const ADDRESS_OVERLAY_DOCUMENT = "browser-address-overlay.html";

/** S1's rectangle: the top strip of the reported content rect, never taller. */
export const ADDRESS_OVERLAY_MAX_HEIGHT_DIP = 160;

/** Readiness budget. A slow/failed local document is a failure, not a spinner:
 * the probe has no user waiting, and a latched failure is the fail-closed answer. */
export const ADDRESS_OVERLAY_READY_TIMEOUT_MS = 5_000;

/** Signed 32-bit DIP range; the same integer range Electron's `Rectangle` accepts. */
const DIP_INT32_MAX = 2 ** 31 - 1;

const INDEX_DOCUMENT_SUFFIX = /\/?index\.html(\?.*)?$/;
const TRAILING_SLASH = /\/$/;

/**
 * The overlay document's URL, derived from the trusted renderer URL exactly as
 * the console capture's and mini view's documents are (`console/capture-url.ts`):
 * a built/packaged `file:` URL ends in `index.html`, so the document is its
 * sibling; a dev run hands over an origin, so the document is appended. The
 * caller must pass the app's resolved trusted URL, never a path from outside.
 */
export function addressOverlayDocumentUrlFor(rendererUrl: string): string {
	return INDEX_DOCUMENT_SUFFIX.test(rendererUrl)
		? rendererUrl.replace(INDEX_DOCUMENT_SUFFIX, `/${ADDRESS_OVERLAY_DOCUMENT}`)
		: `${rendererUrl.replace(TRAILING_SLASH, "")}/${ADDRESS_OVERLAY_DOCUMENT}`;
}

export interface AddressOverlayGate {
	/** Whether the environment named the experiment at all. Drives the log line. */
	asked: boolean;
	enabled: boolean;
	/** Why it was refused, in the same shape the dev driver uses. */
	reason: string | null;
}

/**
 * The effective gate: the exact opt-in AND the already-resolved dev driver
 * arming AND `headless`.
 *
 * WHY IT REFUSES `inactive` TOO: `inactive` is visible by design. S1 has no
 * user-facing path, so there is no reason to put a blank rectangle on the
 * operator's screen; a headless window is the only mode where a child can be
 * proven without becoming product surface. Pure so the gate can be asserted
 * without an app.
 */
export function resolveAddressOverlayGate(input: {
	env: Record<string, string | undefined>;
	devDriverArmed: boolean;
	windowMode: WindowMode;
}): AddressOverlayGate {
	const raw = input.env[ADDRESS_OVERLAY_S1_ENV];
	if (raw === undefined || raw.trim() === "") {
		return { asked: false, enabled: false, reason: null };
	}
	const asked = true;
	if (raw.trim() !== "1") {
		return {
			asked,
			enabled: false,
			reason: `${ADDRESS_OVERLAY_S1_ENV}=${raw.trim()} is not an opt-in (accepted: 1); the address overlay stayed off`,
		};
	}
	if (!input.devDriverArmed) {
		return {
			asked,
			enabled: false,
			reason:
				"the address overlay needs the armed renderer dev driver; it has no user-facing trigger in S1",
		};
	}
	if (input.windowMode !== "headless") {
		return {
			asked,
			enabled: false,
			reason: `the address overlay refused to arm in a "${input.windowMode}" window; S1 has no user-facing path, so use --window-mode=headless`,
		};
	}
	return { asked, enabled: true, reason: null };
}

export interface OverlayRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface OwnerSize {
	width: number;
	height: number;
}

function int32(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	const rounded = Math.round(value);
	return Math.abs(rounded) > DIP_INT32_MAX ? null : rounded;
}

/**
 * The one geometry decision: the top `min(160, height)` strip of the reported
 * content rect, clamped to the owning window's content box.
 *
 * `contentRect` is the renderer's parent-relative DIP rectangle, the same
 * coordinate system the pages use. There are no screen coordinates and no
 * renderer-supplied overlay rectangle: whatever the renderer reports for the
 * page is all this is allowed to read. Anything non-finite, unrounded outside
 * signed 32-bit, non-positive or empty after intersection returns null, and the
 * caller refuses to show rather than clamping a nonsense rectangle into shape.
 */
export function overlayBoundsFor(
	contentRect: OverlayRect | null,
	owner: OwnerSize,
): OverlayRect | null {
	if (contentRect === null) return null;
	const x = int32(contentRect.x);
	const y = int32(contentRect.y);
	const width = int32(contentRect.width);
	const height = int32(contentRect.height);
	const ownerWidth = int32(owner.width);
	const ownerHeight = int32(owner.height);
	if (
		x === null ||
		y === null ||
		width === null ||
		height === null ||
		ownerWidth === null ||
		ownerHeight === null
	)
		return null;
	if (width <= 0 || height <= 0 || ownerWidth <= 0 || ownerHeight <= 0) {
		return null;
	}
	const left = Math.max(0, x);
	const top = Math.max(0, y);
	const right = Math.min(ownerWidth, x + width);
	const bottom = Math.min(
		ownerHeight,
		y + Math.min(height, ADDRESS_OVERLAY_MAX_HEIGHT_DIP),
	);
	if (right <= left || bottom <= top) return null;
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** What the registry delivers after every layout pass. A copy, never a live record. */
export interface AddressOverlayLayoutSnapshot {
	activeTabId: number | null;
	presented: boolean;
	contentRect: OverlayRect | null;
	revision: number;
}

function copyLayout(
	snapshot: AddressOverlayLayoutSnapshot,
): AddressOverlayLayoutSnapshot {
	return {
		activeTabId: snapshot.activeTabId,
		presented: snapshot.presented,
		contentRect: snapshot.contentRect
			? {
					x: snapshot.contentRect.x,
					y: snapshot.contentRect.y,
					width: snapshot.contentRect.width,
					height: snapshot.contentRect.height,
				}
			: null,
		revision: snapshot.revision,
	};
}

/** The identity of a layout, so a repeated pass with the same rectangle is not
 * treated as a revision: a background page creation must re-raise the child,
 * not hide it. */
export function layoutKeyOf(snapshot: AddressOverlayLayoutSnapshot): string {
	const rect = snapshot.contentRect;
	return `${snapshot.activeTabId}:${snapshot.presented ? 1 : 0}:${
		rect ? `${rect.x},${rect.y},${rect.width},${rect.height}` : "null"
	}`;
}

export type AddressOverlayState =
	| "absent"
	| "loading"
	| "ready"
	| "shown"
	| "failed"
	| "disposed";

export interface AddressOverlayFacts {
	documentUrl: string;
	state: AddressOverlayState;
	failedReason: string | null;
	hiddenReason: string | null;
	generation: number;
	childCreatedCount: number;
	shownCount: number;
	lastShow: {
		shown: boolean;
		reason: string | null;
		bounds: OverlayRect | null;
		at: number;
	} | null;
	readiness: { domReady: boolean; finished: boolean; loadMs: number | null };
	child: {
		webContentsId: number;
		visible: boolean;
		bounds: OverlayRect | null;
		order: number;
		childCount: number;
	} | null;
	owner: {
		windowId: number | null;
		destroyed: boolean;
		contentBounds: OwnerSize | null;
	};
	layout: AddressOverlayLayoutSnapshot;
	/** Listener/timer bookkeeping, so a reuse loop can prove it does not grow. */
	listeners: { owner: number; child: number };
	pendingShow: boolean;
	readinessTimer: boolean;
	/** The active page's structural geometry, merged by the host that owns the
	 * registry. The controller itself never reads the registry. */
	page?: AddressOverlayPageFacts | null;
	/** OS process ids/types only, when the host supplies them. Never page content. */
	metrics: unknown;
}

/** What the probe reports about the presented page: ids and geometry, no content. */
export interface AddressOverlayPageFacts {
	tabId: number;
	presented: boolean;
	bounds: OverlayRect | null;
	visible: boolean;
}

export interface AddressOverlayShowResult {
	shown: boolean;
	reason: string | null;
	bounds: OverlayRect | null;
}

export interface AddressOverlayDeps {
	window: BrowserWindow;
	documentUrl: string;
	/** Test seam. Production uses the hardened factory below. */
	createView?: () => WebContentsView;
	readinessTimeoutMs?: number;
	log?: (message: string) => void;
	now?: () => number;
	appMetrics?: () => unknown;
}

/** Opaque, neutral, and deliberately not a theme claim (S4 owns theming). */
const OVERLAY_BACKGROUND = "#1b1f24";

/**
 * The production child. A dedicated non-persistent session means this document
 * has its own cookie jar (empty, and discarded with the child), and the session
 * handlers deny the whole capability vocabulary before the page is created.
 */
function createHardenedView(): WebContentsView {
	const partition = `address-overlay-${randomUUID()}`;
	const childSession = session.fromPartition(partition);
	childSession.setPermissionRequestHandler(
		(_contents, _permission, callback) => {
			callback(false);
		},
	);
	childSession.setPermissionCheckHandler(() => false);
	childSession.on("will-download", (event) => {
		event.preventDefault();
	});
	const view = new WebContentsView({
		webPreferences: {
			partition,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			// No `preload`, and no script in the document: nothing can ask for a
			// bridge, and the renderer never runs JavaScript even if the document
			// changes by accident.
			javascript: false,
		},
	});
	view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	view.setBackgroundColor(OVERLAY_BACKGROUND);
	return view;
}

export class AddressOverlayController {
	private readonly window: BrowserWindow;
	private readonly documentUrl: string;
	private readonly createView: () => WebContentsView;
	private readonly readinessTimeoutMs: number;
	private readonly log: (message: string) => void;
	private readonly now: () => number;
	private readonly appMetrics: (() => unknown) | null;

	private view: WebContentsView | null;
	private childWebContentsId: number | null;
	private state: AddressOverlayState;
	private failedReason: string | null;
	private hiddenReason: string | null;
	private generation: number;
	private childCreatedCount: number;
	private shownCount: number;
	private lastShow: AddressOverlayFacts["lastShow"];
	private layout: AddressOverlayLayoutSnapshot;
	private layoutKey: string;
	private boundTabId: number | null;
	private domReady: boolean;
	private finished: boolean;
	private loadStartedAt: number | null;
	private loadMs: number | null;
	private readyWaiter: ((ok: boolean) => void) | null;
	private readinessTimer: ReturnType<typeof setTimeout> | null;
	private showInFlight: Promise<AddressOverlayShowResult> | null;
	private disposingChild: boolean;
	private disposed: boolean;
	private ownerListeners: Array<() => void>;
	private childListeners: Array<() => void>;

	constructor(deps: AddressOverlayDeps) {
		this.window = deps.window;
		this.documentUrl = deps.documentUrl;
		this.createView = deps.createView ?? createHardenedView;
		this.readinessTimeoutMs =
			deps.readinessTimeoutMs ?? ADDRESS_OVERLAY_READY_TIMEOUT_MS;
		this.log = deps.log ?? (() => {});
		this.now = deps.now ?? (() => Date.now());
		this.appMetrics = deps.appMetrics ?? null;

		this.view = null;
		this.childWebContentsId = null;
		this.state = "absent";
		this.failedReason = null;
		this.hiddenReason = null;
		this.generation = 0;
		this.childCreatedCount = 0;
		this.shownCount = 0;
		this.lastShow = null;
		this.layout = {
			activeTabId: null,
			presented: false,
			contentRect: null,
			revision: 0,
		};
		this.layoutKey = "none";
		this.boundTabId = null;
		this.domReady = false;
		this.finished = false;
		this.loadStartedAt = null;
		this.loadMs = null;
		this.readyWaiter = null;
		this.readinessTimer = null;
		this.showInFlight = null;
		this.disposingChild = false;
		this.disposed = false;
		this.ownerListeners = [];
		this.childListeners = [];
		this.attachOwnerListeners();
	}

	// ---- observer hooks ------------------------------------------------------

	/**
	 * The registry's post-layout hook. Called after every page layout pass,
	 * including null and suppressed ones.
	 *
	 * A changed key (tab, presentation or rectangle) hides and invalidates first:
	 * a moved page must never keep a stale rectangle floating over it, and a
	 * resized window invalidates old geometry until a fresh renderer rect
	 * arrives. An unchanged key is the background-page-creation case: the layout
	 * pass may have added a page above the child, so the child is re-added last
	 * and given the same rectangle. It never re-opens by itself; showing again is
	 * always an explicit probe call.
	 */
	onLayout(snapshot: AddressOverlayLayoutSnapshot): void {
		if (this.disposed) return;
		const next = copyLayout(snapshot);
		const nextKey = layoutKeyOf(next);
		const previousKey = this.layoutKey;
		this.layout = next;
		this.layoutKey = nextKey;
		if (previousKey !== nextKey) {
			this.hide("layout");
			return;
		}
		if (this.state !== "shown") return;
		const view = this.view;
		if (!view || this.viewUsable(view) === false) return;
		const bounds = overlayBoundsFor(next.contentRect, this.ownerSize());
		if (bounds === null || !next.presented) {
			this.hide("layout_invalid");
			return;
		}
		try {
			view.setBounds(bounds);
			this.raiseChild(view);
		} catch (error) {
			this.releaseChild("layout_error");
			this.log(`[browser] address overlay layout failed: ${String(error)}`);
		}
	}

	/** The bound page is going away. Dispose the child before the page release. */
	onTabReleased(tabId: number): void {
		if (this.disposed) return;
		if (this.boundTabId !== tabId) return;
		this.releaseChild("bound-tab-released");
	}

	/** The bound page's renderer died but its webContents survives (a crashed tab).
	 * The child is bound to that page's rectangle, so it goes with the renderer; a
	 * later explicit show may create a fresh one. */
	onPageGone(tabId: number): void {
		if (this.disposed) return;
		if (this.boundTabId !== tabId) return;
		this.releaseChild("page-crash");
	}

	// ---- probe surface ------------------------------------------------------

	async showOverlay(): Promise<AddressOverlayShowResult> {
		if (this.showInFlight) return this.showInFlight;
		const pending = this.showOnce();
		this.showInFlight = pending;
		void pending.then(
			() => {
				if (this.showInFlight === pending) this.showInFlight = null;
			},
			() => {
				if (this.showInFlight === pending) this.showInFlight = null;
			},
		);
		return pending;
	}

	hide(reason = "hide"): void {
		if (this.disposed) return;
		this.generation += 1;
		this.settleReady(false);
		this.hiddenReason = reason;
		const view = this.view;
		if (view && this.viewUsable(view)) {
			try {
				view.setVisible(false);
			} catch {
				// The window is going away; the child is disposed below anyway.
			}
		}
		if (this.state === "shown") {
			this.state = this.failedReason
				? "failed"
				: this.domReady && this.finished
					? "ready"
					: "loading";
		}
		this.log(`[browser] address overlay hidden: ${reason}`);
	}

	/** Facts only: identifiers, geometry and counters. No page content. */
	facts(): AddressOverlayFacts {
		const view = this.view;
		let child: AddressOverlayFacts["child"] = null;
		if (view) {
			let visible = false;
			let bounds: OverlayRect | null = null;
			let order = -1;
			let childCount = 0;
			try {
				visible = view.getVisible();
				bounds = view.getBounds();
				const children = this.window.contentView.children;
				childCount = children.length;
				order = children.indexOf(view);
			} catch {
				// A window in teardown answers nothing useful; keep the ids.
			}
			child = {
				webContentsId: this.childWebContentsId ?? view.webContents.id,
				visible,
				bounds,
				order,
				childCount,
			};
		}
		let ownerDestroyed = true;
		let contentBounds: OwnerSize | null = null;
		try {
			ownerDestroyed = this.window.isDestroyed();
			if (!ownerDestroyed) contentBounds = this.ownerSize();
		} catch {
			ownerDestroyed = true;
		}
		return {
			documentUrl: this.documentUrl,
			state: this.state,
			failedReason: this.failedReason,
			hiddenReason: this.hiddenReason,
			generation: this.generation,
			childCreatedCount: this.childCreatedCount,
			shownCount: this.shownCount,
			lastShow: this.lastShow,
			readiness: {
				domReady: this.domReady,
				finished: this.finished,
				loadMs: this.loadMs,
			},
			child,
			owner: {
				windowId: typeof this.window.id === "number" ? this.window.id : null,
				destroyed: ownerDestroyed,
				contentBounds,
			},
			layout: copyLayout(this.layout),
			listeners: {
				owner: this.ownerListeners.length,
				child: this.childListeners.length,
			},
			pendingShow: this.showInFlight !== null,
			readinessTimer: this.readinessTimer !== null,
			metrics: this.appMetrics ? this.appMetrics() : null,
		};
	}

	async probe(action: "show" | "hide" | "facts"): Promise<AddressOverlayFacts> {
		if (action === "show") {
			await this.showOverlay();
			return this.facts();
		}
		if (action === "hide") {
			this.hide("probe");
			return this.facts();
		}
		return this.facts();
	}

	/**
	 * Idempotent teardown for the host's stop/rollback/window-close paths.
	 * Closing the webContents before detaching is required: removing a
	 * `WebContentsView` does not release its renderer.
	 */
	dispose(reason: string): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.settleReady(false);
		this.detachOwnerListeners();
		this.destroyChild();
		this.state = "disposed";
		this.hiddenReason = reason;
		this.log(`[browser] address overlay disposed: ${reason}`);
	}

	get isDisposed(): boolean {
		return this.disposed;
	}

	// ---- show path ----------------------------------------------------------

	private async showOnce(): Promise<AddressOverlayShowResult> {
		const refuse = (reason: string): AddressOverlayShowResult => {
			this.lastShow = { shown: false, reason, bounds: null, at: this.now() };
			return { shown: false, reason, bounds: null };
		};
		try {
			if (this.disposed) return refuse("disposed");
			if (this.failedReason) return refuse(this.failedReason);
			if (this.ownerUnavailable()) {
				this.releaseChild("owner_unavailable");
				return refuse("owner_unavailable");
			}
			const snapshot = this.layout;
			const bounds = overlayBoundsFor(snapshot.contentRect, this.ownerSize());
			if (
				snapshot.activeTabId === null ||
				!snapshot.presented ||
				bounds === null
			) {
				return refuse("no_layout");
			}
			this.generation += 1;
			const generation = this.generation;
			this.boundTabId = snapshot.activeTabId;
			if (!this.view) {
				const created = this.createChild(bounds);
				if (!created) return refuse(this.failedReason ?? "child_create_failed");
			}
			if (!(this.domReady && this.finished)) {
				this.state = "loading";
				const ready = await this.waitForReady();
				if (!ready) return refuse(this.failedReason ?? "invalidated");
			}
			if (this.disposed || generation !== this.generation) {
				return refuse("invalidated");
			}
			if (this.ownerUnavailable()) {
				this.releaseChild("owner_unavailable");
				return refuse("owner_unavailable");
			}
			const view = this.view;
			if (!view) return refuse("child_missing");
			const finalBounds = overlayBoundsFor(
				this.layout.contentRect,
				this.ownerSize(),
			);
			if (
				finalBounds === null ||
				this.layout.activeTabId === null ||
				!this.layout.presented ||
				this.layout.activeTabId !== this.boundTabId
			) {
				return refuse("invalidated");
			}
			view.setBounds(finalBounds);
			// Re-add LAST immediately before show: any page created since the child
			// was attached sits above it otherwise, and a child under the page would
			// paint nothing while claiming to be shown.
			this.raiseChild(view);
			view.setVisible(true);
			this.state = "shown";
			this.hiddenReason = null;
			this.shownCount += 1;
			this.lastShow = {
				shown: true,
				reason: null,
				bounds: finalBounds,
				at: this.now(),
			};
			this.log(
				`[browser] address overlay shown tab=${this.boundTabId} bounds=${finalBounds.x},${finalBounds.y},${finalBounds.width},${finalBounds.height} generation=${generation}`,
			);
			return { shown: true, reason: null, bounds: finalBounds };
		} catch (error) {
			this.failChild(`show_error:${String(error)}`);
			return refuse("child_error");
		}
	}

	private createChild(bounds: OverlayRect): boolean {
		let view: WebContentsView;
		try {
			view = this.createView();
		} catch (error) {
			this.failChild(`child_create_failed:${String(error)}`);
			return false;
		}
		this.view = view;
		this.childWebContentsId = view.webContents.id;
		this.childCreatedCount += 1;
		this.domReady = false;
		this.finished = false;
		this.loadMs = null;
		this.loadStartedAt = null;
		try {
			// Attach, size, hide, then load — the documented initialization order
			// (a view hidden before it is sized keeps a 0x0 layout viewport).
			this.window.contentView.addChildView(view);
			view.setBounds(bounds);
			view.setVisible(false);
		} catch (error) {
			this.failChild(`child_attach_failed:${String(error)}`);
			return false;
		}
		this.wireChild(view);
		this.loadStartedAt = this.now();
		try {
			const loading = view.webContents.loadURL(this.documentUrl);
			void Promise.resolve(loading).catch((error: unknown) => {
				if (this.disposed || this.view !== view) return;
				this.failChild(`load_failed:${String(error)}`);
			});
		} catch (error) {
			this.failChild(`load_failed:${String(error)}`);
			return false;
		}
		this.log(
			`[browser] address overlay child created wc=${view.webContents.id}`,
		);
		return true;
	}

	private waitForReady(): Promise<boolean> {
		if (this.domReady && this.finished) return Promise.resolve(true);
		if (this.readyWaiter) {
			// One waiter at a time; `show` is serialized, so this is a failure path.
			return Promise.resolve(false);
		}
		return new Promise<boolean>((resolve) => {
			this.readyWaiter = resolve;
			this.readinessTimer = setTimeout(() => {
				this.readinessTimer = null;
				if (this.readyWaiter) this.failChild("load_timeout");
			}, this.readinessTimeoutMs);
		});
	}

	private settleReady(ok: boolean): void {
		if (this.readinessTimer !== null) {
			clearTimeout(this.readinessTimer);
			this.readinessTimer = null;
		}
		const waiter = this.readyWaiter;
		this.readyWaiter = null;
		if (waiter) waiter(ok);
	}

	private maybeReady(): void {
		if (!(this.domReady && this.finished)) return;
		if (this.loadStartedAt !== null && this.loadMs === null) {
			this.loadMs = this.now() - this.loadStartedAt;
		}
		if (this.state === "loading" || this.state === "absent") {
			this.state = this.readyWaiter ? this.state : "ready";
		}
		this.settleReady(true);
	}

	// ---- child wiring -------------------------------------------------------

	private wireChild(view: WebContentsView): void {
		const contents = view.webContents;
		const on = (
			target: WebContents,
			event: string,
			listener: (...args: unknown[]) => void,
		): void => {
			const emitter = target as unknown as {
				on(name: string, handler: (...args: unknown[]) => void): unknown;
				removeListener(
					name: string,
					handler: (...args: unknown[]) => void,
				): unknown;
			};
			emitter.on(event, listener);
			this.childListeners.push(() => {
				try {
					emitter.removeListener(event, listener);
				} catch {
					// The contents may already be gone.
				}
			});
		};
		on(contents, "dom-ready", () => {
			if (this.view !== view) return;
			this.domReady = true;
			this.maybeReady();
		});
		on(contents, "did-finish-load", () => {
			if (this.view !== view) return;
			this.finished = true;
			this.maybeReady();
		});
		on(contents, "did-fail-load", (...args) => {
			if (this.view !== view) return;
			const code = typeof args[1] === "number" ? args[1] : 0;
			const isMainFrame = args[4] !== false;
			// -3 is ERR_ABORTED: a superseded or cancelled load is not a broken
			// document, and latching on it would make an ordinary hide fatal.
			if (!isMainFrame || code === -3) return;
			this.failChild(`load_failed:${code}`);
		});
		on(contents, "render-process-gone", () => {
			if (this.view !== view) return;
			this.failChild("child_crash");
		});
		on(contents, "destroyed", () => {
			if (this.view !== view) return;
			if (this.disposingChild) return;
			this.failChild("child_destroyed");
		});
		on(contents, "will-navigate", (...args) => {
			const url = typeof args[1] === "string" ? args[1] : "";
			const event = args[0] as { preventDefault?: () => void } | undefined;
			if (url === this.documentUrl) return;
			event?.preventDefault?.();
			this.log(`[browser] address overlay refused navigation to ${url}`);
		});
		on(contents, "will-redirect", (...args) => {
			const url = typeof args[1] === "string" ? args[1] : "";
			const event = args[0] as { preventDefault?: () => void } | undefined;
			if (url === this.documentUrl) return;
			event?.preventDefault?.();
			this.log(`[browser] address overlay refused redirect to ${url}`);
		});
	}

	/** Terminal for this host lifetime: a broken document must not be retried. */
	private failChild(reason: string): void {
		if (this.failedReason) return;
		this.failedReason = reason;
		this.state = "failed";
		this.settleReady(false);
		this.destroyChild();
		this.log(`[browser] address overlay failed: ${reason}`);
	}

	/** Recoverable: the child goes, a later explicit show may lazily recreate one. */
	private releaseChild(reason: string): void {
		this.generation += 1;
		this.settleReady(false);
		this.destroyChild();
		if (!this.failedReason) this.state = "absent";
		this.boundTabId = null;
		this.domReady = false;
		this.finished = false;
		this.loadStartedAt = null;
		this.log(`[browser] address overlay child released: ${reason}`);
	}

	private destroyChild(): void {
		const view = this.view;
		if (!view) return;
		this.view = null;
		this.childWebContentsId = null;
		this.disposingChild = true;
		for (const remove of this.childListeners.splice(0)) remove();
		try {
			if (!view.webContents.isDestroyed()) view.webContents.close();
		} catch {
			// Already gone.
		}
		try {
			this.window.contentView.removeChildView(view);
		} catch {
			// The window may be closing; nothing to detach from.
		}
		this.disposingChild = false;
	}

	private raiseChild(view: WebContentsView): void {
		this.window.contentView.addChildView(view);
	}

	private viewUsable(view: WebContentsView): boolean {
		try {
			return !view.webContents.isDestroyed();
		} catch {
			return false;
		}
	}

	// ---- owner wiring -------------------------------------------------------

	private attachOwnerListeners(): void {
		const on = (
			target: BrowserWindow | WebContents,
			event: string,
			listener: (...args: unknown[]) => void,
		): void => {
			// Electron's `on`/`removeListener` are per-event overloads; this helper
			// names one event and one listener, which the overload set cannot express
			// without spelling every overload. The emitter narrows to the two methods.
			const emitter = target as unknown as {
				on(name: string, handler: (...args: unknown[]) => void): unknown;
				removeListener(
					name: string,
					handler: (...args: unknown[]) => void,
				): unknown;
			};
			emitter.on(event, listener);
			this.ownerListeners.push(() => {
				try {
					emitter.removeListener(event, listener);
				} catch {
					// The window may already be gone.
				}
			});
		};
		on(this.window, "blur", () => {
			this.hide("window_blur");
		});
		on(this.window, "minimize", () => {
			this.hide("window_minimize");
		});
		on(this.window, "closed", () => {
			this.dispose("window_closed");
		});
		const contents = this.window.webContents;
		on(contents, "render-process-gone", () => {
			// The owner document died; its listener set is gone with it. Keep the
			// controller alive so an explicit later probe can create a fresh child,
			// but never resurrect one on a stale layout.
			this.releaseChild("owner_crash");
		});
		on(contents, "destroyed", () => {
			this.dispose("owner_destroyed");
		});
		on(contents, "did-start-navigation", (...args) => {
			const details = args[0] as
				| { isMainFrame?: boolean; isSameDocument?: boolean }
				| undefined;
			if (details?.isMainFrame && details.isSameDocument !== true) {
				this.releaseChild("owner_navigation");
			}
		});
	}

	private detachOwnerListeners(): void {
		for (const remove of this.ownerListeners.splice(0)) remove();
	}

	private ownerSize(): OwnerSize {
		const bounds = this.window.getContentBounds();
		return { width: bounds.width, height: bounds.height };
	}

	private ownerUnavailable(): boolean {
		try {
			return this.window.isDestroyed() || this.window.webContents.isDestroyed();
		} catch {
			return true;
		}
	}
}
