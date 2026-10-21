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
import {
	ADDRESS_LIST_DOCUMENT,
	ADDRESS_LIST_ENV,
	ADDRESS_LIST_HEADER_HEIGHT,
	ADDRESS_LIST_ROW_HEIGHT,
	type AddressListMeasurement,
	type AddressListProjection,
	addressListBoundsFor,
	addressListMeasurementProblem,
	addressListRowIndexAt,
	addressListViewModel,
	sanitizeProjection,
} from "./address-overlay-list";

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
	return documentUrlFor(rendererUrl, ADDRESS_OVERLAY_DOCUMENT);
}

/** S2's scripted document, resolved by the same rule and never by a
 * renderer-supplied path. */
export function addressListDocumentUrlFor(rendererUrl: string): string {
	return documentUrlFor(rendererUrl, ADDRESS_LIST_DOCUMENT);
}

function documentUrlFor(rendererUrl: string, document: string): string {
	return INDEX_DOCUMENT_SUFFIX.test(rendererUrl)
		? rendererUrl.replace(INDEX_DOCUMENT_SUFFIX, `/${document}`)
		: `${rendererUrl.replace(TRAILING_SLASH, "")}/${document}`;
}

export interface AddressOverlayGate {
	/** Whether the environment named the experiment at all. Drives the log line. */
	asked: boolean;
	enabled: boolean;
	/**
	 * S2's list mirror. True only when the S2 opt-in is present AND every S1 gate
	 * passed: S2 is an increment on S1's child and session, never a parallel arm.
	 */
	list: boolean;
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
	const listRaw = input.env[ADDRESS_LIST_ENV];
	const listAsked = listRaw !== undefined && listRaw.trim() !== "";
	if (raw === undefined || raw.trim() === "") {
		// A lone S2 opt-in is a refusal, not silence: the operator named an
		// experiment and is owed the reason it did not arm.
		return listAsked
			? {
					asked: true,
					enabled: false,
					list: false,
					reason: `${ADDRESS_LIST_ENV} needs ${ADDRESS_OVERLAY_S1_ENV}=1: S2's list is a mirror inside S1's child, not a second child`,
				}
			: { asked: false, enabled: false, list: false, reason: null };
	}
	const asked = true;
	if (raw.trim() !== "1") {
		return {
			asked,
			enabled: false,
			list: false,
			reason: `${ADDRESS_OVERLAY_S1_ENV}=${raw.trim()} is not an opt-in (accepted: 1); the address overlay stayed off`,
		};
	}
	if (listAsked && listRaw.trim() !== "1") {
		return {
			asked,
			enabled: false,
			list: false,
			reason: `${ADDRESS_LIST_ENV}=${listRaw.trim()} is not an opt-in (accepted: 1); the address overlay stayed off`,
		};
	}
	if (!input.devDriverArmed) {
		return {
			asked,
			enabled: false,
			list: false,
			reason:
				"the address overlay needs the armed renderer dev driver; it has no user-facing trigger in S1",
		};
	}
	if (input.windowMode !== "headless") {
		return {
			asked,
			enabled: false,
			list: false,
			reason: `the address overlay refused to arm in a "${input.windowMode}" window; S1 has no user-facing path, so use --window-mode=headless`,
		};
	}
	return { asked, enabled: true, list: listAsked, reason: null };
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
	/** S2 mirror counters. Present in every controller so a probe can prove the
	 * S1 path leaves them at zero rather than inferring it from silence. */
	s2: {
		list: boolean;
		javascript: boolean;
		lastSeq: number;
		shownSeq: number;
		lastRejected: string | null;
		theme: string;
		applyCount: number;
		view: {
			kind: "none" | "rows" | "notice";
			rowCount: number;
			active: number;
		};
		measured: AddressListMeasurement | null;
		commitsEmitted: number;
		commitsDropped: Record<string, number>;
		hideCounts: Record<string, number>;
		keysBlocked: number;
		mouseDowns: number;
		mouseUps: number;
		contextMenuBlocked: number;
	};
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

/** What one projection call decided. `accepted` is about the payload; `shown`
 * is the child's resulting visibility, so a refusal and a hide stay distinct. */
export interface AddressOverlayProjectResult {
	accepted: boolean;
	shown: boolean;
	reason: string | null;
	/** The rectangle the child was given, when one was computed. */
	bounds: OverlayRect | null;
}

/** Integer + tolerance compare for two rectangles in the same CSS-px space. */
function sameRect(a: OverlayRect, b: OverlayRect | null): boolean {
	if (b === null) return false;
	return (
		a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
	);
}

export interface AddressOverlayDeps {
	window: BrowserWindow;
	documentUrl: string;
	/** Test seam. Production uses the hardened factory below. */
	createView?: () => WebContentsView;
	readinessTimeoutMs?: number;
	/** S2: the child document runs its own bundled module script. False for S1. */
	javascript?: boolean;
	/** S2: where a validated row click is reported (the host forwards it to the
	 * owner window). Absent means no sink, and the click is counted, not sent. */
	onEvent?: (event: AddressOverlayCommitEvent) => void;
	log?: (message: string) => void;
	now?: () => number;
	appMetrics?: () => unknown;
}

/** The one event main sends back to the renderer: a row index inside the
 * projection with that seq. Never a URL, never a string the renderer trusts. */
export interface AddressOverlayCommitEvent {
	type: "commit";
	seq: number;
	index: number;
}

/** Opaque, neutral, and deliberately not a theme claim (S4 owns theming). */
const OVERLAY_BACKGROUND = "#1b1f24";

/**
 * The production child. A dedicated non-persistent session means this document
 * has its own cookie jar (empty, and discarded with the child), and the session
 * handlers deny the whole capability vocabulary before the page is created.
 *
 * S2 opens exactly one switch: `javascript`. S1's document stays JS-off, so an
 * unintended script in it cannot run; S2's list document needs its module entry
 * to paint rows. Everything else — sandbox, context isolation, no Node, no
 * preload, denials — is the same object for both, which is what keeps S2 from
 * becoming a second, weaker trust boundary.
 */
function createHardenedView(options: { javascript: boolean }): WebContentsView {
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
			// No `preload`, and no app imports in either document. The flag is the
			// S1/S2 split: false for the inert document, true for the mirror list.
			javascript: options.javascript,
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
	private readonly javascript: boolean;
	private readonly onEvent: ((event: AddressOverlayCommitEvent) => void) | null;
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
	// ---- S2 mirror state ----------------------------------------------------
	private lastSeq: number;
	private shownSeq: number;
	private lastProjection: AddressListProjection | null;
	/** The rectangle last applied for a projection. `onLayout`'s unchanged-key
	 * re-assert uses THIS, never the S1 top-strip rule: an S2 child sits at the
	 * dock, and re-raising it with the S1 rectangle would move the list. */
	private lastAppliedBounds: OverlayRect | null;
	private lastMeasurement: AddressListMeasurement | null;
	private themeFact: string;
	private applyCount: number;
	private commitsEmitted: number;
	private commitsDropped: Map<string, number>;
	private hideCounts: Map<string, number>;
	private keysBlocked: number;
	private mouseDowns: number;
	private mouseUps: number;
	private mouseDownRow: number | null;
	private contextMenuBlocked: number;
	private lastRejected: string | null;
	private projectQueue: Promise<unknown>;

	constructor(deps: AddressOverlayDeps) {
		this.window = deps.window;
		this.documentUrl = deps.documentUrl;
		this.createView =
			deps.createView ??
			(() => createHardenedView({ javascript: deps.javascript === true }));
		this.javascript = deps.javascript === true;
		this.onEvent = deps.onEvent ?? null;
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
		this.lastSeq = 0;
		this.shownSeq = -1;
		this.lastProjection = null;
		this.lastAppliedBounds = null;
		this.lastMeasurement = null;
		this.themeFact = "absent";
		this.applyCount = 0;
		this.commitsEmitted = 0;
		this.commitsDropped = new Map();
		this.hideCounts = new Map();
		this.keysBlocked = 0;
		this.mouseDowns = 0;
		this.mouseUps = 0;
		this.mouseDownRow = null;
		this.contextMenuBlocked = 0;
		this.lastRejected = null;
		this.projectQueue = Promise.resolve();
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
		const bounds =
			this.lastProjection !== null
				? this.lastAppliedBounds
				: overlayBoundsFor(next.contentRect, this.ownerSize());
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
		this.hideCounts.set(reason, (this.hideCounts.get(reason) ?? 0) + 1);
		// A hidden child can route nothing: drop the row under the pointer and the
		// seq a commit would have to match, so a late mouse-up cannot commit a row
		// the user can no longer see.
		this.shownSeq = -1;
		this.mouseDownRow = null;
		this.lastMeasurement = null;
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
			s2: {
				list: this.javascript,
				javascript: this.javascript,
				lastSeq: this.lastSeq,
				shownSeq: this.shownSeq,
				lastRejected: this.lastRejected,
				theme: this.themeFact,
				applyCount: this.applyCount,
				view:
					this.lastProjection === null
						? { kind: "none", rowCount: 0, active: -1 }
						: {
								kind: this.lastProjection.view.kind,
								rowCount:
									this.lastProjection.view.kind === "rows"
										? this.lastProjection.view.rows.length
										: 0,
								active: this.lastProjection.active,
							},
				measured: this.lastMeasurement,
				commitsEmitted: this.commitsEmitted,
				commitsDropped: Object.fromEntries(this.commitsDropped),
				hideCounts: Object.fromEntries(this.hideCounts),
				keysBlocked: this.keysBlocked,
				mouseDowns: this.mouseDowns,
				mouseUps: this.mouseUps,
				contextMenuBlocked: this.contextMenuBlocked,
			},
			metrics: this.appMetrics ? this.appMetrics() : null,
		};
	}

	async probe(
		action: "show" | "hide" | "facts" | "click" | "measure" | "key",
		argument?: unknown,
	): Promise<AddressOverlayFacts> {
		if (action === "show") {
			await this.showOverlay();
			return this.facts();
		}
		if (action === "hide") {
			this.hide("probe");
			return this.facts();
		}
		if (action === "click") {
			this.probeClick(argument);
			await new Promise((done) => setTimeout(done, 40));
			return this.facts();
		}
		if (action === "measure") {
			await this.probeMeasure();
			return this.facts();
		}
		if (action === "key") {
			this.probeKey(argument);
			await new Promise((done) => setTimeout(done, 20));
			return this.facts();
		}
		return this.facts();
	}

	/**
	 * Apply one renderer projection (S2). Everything arriving here was or will be
	 * revalidated: JSON size, shape, every string, tab/layout freshness, zoom,
	 * anchor geometry and — after the child paints — the child's own measurements.
	 *
	 * Serialized: a per-frame renderer can outpace `executeJavaScript`, and two
	 * overlapping applies would let an older model win. The queue is per
	 * controller, so a burst between frames costs one apply each in arrival order.
	 */
	project(raw: unknown): Promise<AddressOverlayProjectResult> {
		const run = (): Promise<AddressOverlayProjectResult> =>
			this.projectOnce(raw);
		const next = this.projectQueue.then(run, run);
		this.projectQueue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	private async projectOnce(
		raw: unknown,
	): Promise<AddressOverlayProjectResult> {
		const parsed = sanitizeProjection(raw);
		if (!parsed.ok) {
			this.drop(parsed.reason);
			return {
				accepted: false,
				shown: false,
				reason: parsed.reason,
				bounds: null,
			};
		}
		const projection = parsed.projection;
		this.themeFact = projection.themeFact;

		if (!projection.visible) {
			if (projection.seq > this.lastSeq) this.lastSeq = projection.seq;
			this.hide("projection_hidden");
			return { accepted: true, shown: false, reason: null, bounds: null };
		}
		if (this.disposed) {
			return this.refuseProjection("disposed");
		}
		if (projection.seq < this.lastSeq) {
			// An out-of-order frame is dropped WITHOUT hiding: the list on screen is
			// newer than this projection, and hiding it would be a visible regression.
			this.drop("stale_seq");
			return {
				accepted: false,
				shown: this.state === "shown",
				reason: "stale_seq",
				bounds: null,
			};
		}
		if (projection.seq === this.lastSeq && projection.seq === this.shownSeq) {
			return {
				accepted: true,
				shown: this.state === "shown",
				reason: null,
				bounds:
					this.view && this.viewUsable(this.view)
						? this.view.getBounds()
						: null,
			};
		}
		if (this.failedReason) return this.refuseProjection("overlay_failed");
		if (this.ownerUnavailable()) {
			this.releaseChild("owner_unavailable");
			return this.refuseProjection("owner_unavailable");
		}

		// ZOOM FAILS CLOSED. At a zoom factor other than 1 a DOM rect keeps its
		// CSS-px left while the window's inner size shrinks, so CSS px and DIP stop
		// being interchangeable; scaling only this child would make it disagree with
		// the page. The page-at-zoom question is pre-existing and not measured here.
		const zoom = this.ownerZoom();
		if (zoom === null || Math.abs(zoom - 1) > 1e-3) {
			return this.refuseProjection("zoomed");
		}

		const layout = this.layout;
		if (projection.tabId !== layout.activeTabId) {
			return this.refuseProjection("stale_tab");
		}
		if (
			!layout.presented ||
			!sameRect(projection.pageRect, layout.contentRect)
		) {
			return this.refuseProjection("stale_layout");
		}
		const bounds = addressListBoundsFor(
			projection.field,
			projection.listTop,
			projection.view,
			this.ownerSize(),
		);
		if (bounds === null) return this.refuseProjection("anchor_inconsistent");

		this.generation += 1;
		const generation = this.generation;
		this.boundTabId = projection.tabId;
		if (!this.view) {
			const created = this.createChild(bounds);
			if (!created) {
				return this.refuseProjection(
					this.failedReason ?? "child_create_failed",
				);
			}
		}
		if (!(this.domReady && this.finished)) {
			this.state = "loading";
			const ready = await this.waitForReady();
			if (!ready)
				return this.refuseProjection(this.failedReason ?? "invalidated");
		}
		if (this.disposed || generation !== this.generation) {
			return this.refuseProjection("invalidated");
		}
		const view = this.view;
		if (!view || !this.viewUsable(view)) {
			return this.refuseProjection("child_unavailable");
		}

		// SIZE BEFORE PAINT, and WAIT until the child's own layout viewport is the
		// size we asked for. The child measures its rows to prove what it painted, so
		// a model with five rows cannot be judged against the 69-DIP view that one
		// row sized. A hidden (headless) window throttles its frame loop, so a native
		// resize can land up to ~1 s later; re-assert it and poll `innerHeight`
		// instead of guessing with one fixed sleep. A visible window lands on the
		// next frame, so this costs one evaluation there.
		view.setBounds(bounds);
		const model = addressListViewModel(projection);
		let measured: unknown = null;
		let problem: string | null = null;
		try {
			for (let attempt = 0; attempt < 8; attempt += 1) {
				// A dropped resize loses the attempt, not the request: re-assert the
				// rectangle every time rather than only before the first apply.
				view.setBounds(bounds);
				// A FIXED function name with a main-built JSON argument: the child never
				// receives code, only data. `JSON.stringify` escapes quotes, U+2028/2029
				// and `</script>` for this call by construction, and the strings inside
				// have already been stripped of control/bidi characters.
				measured = await view.webContents.executeJavaScript(
					`window.__loAddressOverlay && window.__loAddressOverlay.apply(${JSON.stringify(model)})`,
					false,
				);
				problem = addressListMeasurementProblem(measured, projection);
				if (problem === null) break;
				// A native view resize can take a compositor frame to reach the child's
				// layout. That shows up as a viewport smaller than the model needs
				// (`measure_scroll`) on the first apply after a height change; wait one
				// frame and re-apply. Any OTHER mismatch is a real defect and refuses
				// on the spot.
				if (problem !== "measure_scroll") break;
				await new Promise((done) => setTimeout(done, 30));
			}
		} catch {
			return this.refuseProjection("apply_error");
		}
		if (problem !== null) return this.refuseProjection(problem, bounds);

		this.applyCount += 1;
		this.lastSeq = projection.seq;
		this.shownSeq = projection.seq;
		this.lastProjection = projection;
		this.lastAppliedBounds = bounds;
		this.lastMeasurement = measured as AddressListMeasurement;
		this.lastRejected = null;
		this.state = "shown";
		this.hiddenReason = null;
		this.raiseChild(view);
		view.setVisible(true);
		return { accepted: true, shown: true, reason: null, bounds };
	}

	private refuseProjection(
		reason: string,
		bounds: OverlayRect | null = null,
	): AddressOverlayProjectResult {
		this.lastRejected = reason;
		this.drop(reason);
		this.hide(reason);
		return { accepted: false, shown: false, reason, bounds };
	}

	private drop(reason: string): void {
		this.commitsDropped.set(reason, (this.commitsDropped.get(reason) ?? 0) + 1);
	}

	private ownerZoom(): number | null {
		try {
			const zoom = this.window.webContents.getZoomFactor();
			return typeof zoom === "number" && Number.isFinite(zoom) ? zoom : null;
		} catch {
			return null;
		}
	}

	private rowAt(y: number): number | null {
		if (this.state !== "shown") return null;
		if (this.lastProjection === null) return null;
		if (this.shownSeq !== this.lastSeq || this.shownSeq < 1) return null;
		const projection = this.lastProjection;
		if (projection.view.kind !== "rows") return null;
		const index = addressListRowIndexAt(projection.view, y);
		if (index === null || index >= projection.view.rows.length) return null;
		return index;
	}

	private emitCommit(index: number): void {
		const projection = this.lastProjection;
		const sink = this.onEvent;
		if (projection === null || sink === null) {
			this.drop("no_sink");
			return;
		}
		if (
			projection.view.kind !== "rows" ||
			index >= projection.view.rows.length
		) {
			this.drop("commit_index");
			return;
		}
		this.commitsEmitted += 1;
		sink({ type: "commit", seq: projection.seq, index });
		this.log(
			`[browser] address overlay commit emitted: seq=${projection.seq} index=${index}`,
		);
	}

	/**
	 * Probe-only mouse path: `sendInputEvent` into the child's own input pipeline.
	 * This exercises the child and the before-mouse-event observer; it does NOT
	 * exercise macOS NSView hit-testing between sibling views (matrix V3).
	 */
	private probeClick(argument: unknown): void {
		const view = this.view;
		const measurement = this.lastMeasurement;
		if (!view || !this.viewUsable(view) || !measurement) {
			throw new Error("address_overlay_click: no applied list to click");
		}
		const arg = (argument ?? {}) as { row?: unknown; upRow?: unknown };
		const row = arg.row;
		const upRow = arg.upRow === undefined ? row : arg.upRow;
		const rows = measurement.rowRects;
		if (typeof row !== "number" || !Number.isInteger(row) || !rows[row]) {
			throw new Error(
				"address_overlay_click: row must be a rendered row index",
			);
		}
		if (typeof upRow !== "number" || !Number.isInteger(upRow)) {
			throw new Error("address_overlay_click: upRow must be an integer");
		}
		// Child measurements are viewport-relative; `sendInputEvent` (and the
		// before-mouse-event coordinates it produces) are document-relative. The
		// header and the list's top padding are the difference.
		const point = (index: number): { x: number; y: number } => {
			const rect = rows[index];
			const fallbackY =
				ADDRESS_LIST_HEADER_HEIGHT +
				2 +
				(index + 0.5) * ADDRESS_LIST_ROW_HEIGHT;
			return rect
				? {
						x: 40,
						y: ADDRESS_LIST_HEADER_HEIGHT + 2 + rect.top + rect.height / 2,
					}
				: { x: 40, y: fallbackY };
		};
		const receive = (
			type: "mouseMove" | "mouseDown" | "mouseUp",
			index: number,
		): void => {
			const { x, y } = point(index);
			view.webContents.sendInputEvent({
				type,
				x: Math.round(x),
				y: Math.round(y),
				button: "left",
				clickCount: 1,
			});
		};
		receive("mouseMove", row);
		receive("mouseDown", row);
		receive("mouseUp", upRow);
	}

	/**
	 * Probe-only key into the child's own input pipeline. It is how the gated
	 * harness proves `before-input-event` swallows keys; CDP-injected keys go
	 * through a different path and were measured NOT to fire it.
	 */
	private probeKey(argument: unknown): void {
		const view = this.view;
		if (!view || !this.viewUsable(view)) {
			throw new Error("address_overlay_key: no child");
		}
		const arg = (argument ?? {}) as { keyCode?: unknown };
		const keyCode =
			typeof arg.keyCode === "string" && arg.keyCode.length > 0
				? arg.keyCode.slice(0, 32)
				: "A";
		view.webContents.sendInputEvent({ type: "keyDown", keyCode });
		view.webContents.sendInputEvent({ type: "keyUp", keyCode });
	}

	private async probeMeasure(): Promise<void> {
		const view = this.view;
		if (!view || !this.viewUsable(view)) {
			throw new Error("address_overlay_measure: no child");
		}
		const measured = await view.webContents.executeJavaScript(
			"window.__loAddressOverlay && window.__loAddressOverlay.measure()",
			false,
		);
		this.lastMeasurement = measured as AddressListMeasurement;
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
		/*
		 * S2's input policy. The child is a PRESENTATION surface: it never owns
		 * keyboard, focus or native hit routing (S3), so every key is swallowed and
		 * counted, and the context menu is refused. Mouse events are observed in main
		 * and always prevented — preventing the down/up is what keeps a click on a
		 * row from moving focus out of the parent input (a lost click is acceptable;
		 * a wrong navigation is not).
		 */
		on(contents, "before-input-event", (...args) => {
			const event = args[0] as { preventDefault?: () => void } | undefined;
			event?.preventDefault?.();
			this.keysBlocked += 1;
		});
		on(contents, "context-menu", (...args) => {
			const event = args[0] as { preventDefault?: () => void } | undefined;
			event?.preventDefault?.();
			this.contextMenuBlocked += 1;
		});
		on(contents, "before-mouse-event", (...args) => {
			const event = args[0] as { preventDefault?: () => void } | undefined;
			event?.preventDefault?.();
			const mouse = args[1] as
				| { type?: string; x?: number; y?: number }
				| undefined;
			if (
				!mouse ||
				typeof mouse.x !== "number" ||
				typeof mouse.y !== "number"
			) {
				return;
			}
			if (mouse.type === "mouseDown") {
				this.mouseDowns += 1;
				this.mouseDownRow = this.rowAt(mouse.y);
				return;
			}
			if (mouse.type !== "mouseUp") return;
			this.mouseUps += 1;
			const row = this.rowAt(mouse.y);
			const downRow = this.mouseDownRow;
			this.mouseDownRow = null;
			if (downRow === null || row === null) {
				this.drop("mouse_no_row");
				return;
			}
			if (downRow !== row) {
				this.drop("mouse_mismatch");
				return;
			}
			this.emitCommit(row);
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
