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
	webContents,
} from "electron";
import type { WindowMode } from "../window-mode";
import {
	ADDRESS_LIST_DOCUMENT,
	ADDRESS_LIST_ENV,
	ADDRESS_LIST_HEADER_HEIGHT,
	ADDRESS_LIST_MIN_WIDTH_DIP,
	ADDRESS_LIST_ROW_HEIGHT,
	type AddressListMeasurement,
	type AddressListProjection,
	addressListBoundsFor,
	addressListBoundsV2For,
	addressListMeasurementProblem,
	addressListRowIndexAt,
	addressListViewModel,
	sanitizeProjection,
} from "./address-overlay-list";

/** The exact opt-in. Absent or anything other than `1` is off. */
export const ADDRESS_OVERLAY_S1_ENV =
	"LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1";

/**
 * S3's one visible-probe opt-in. Absent or anything other than `1` is off, and
 * ABSENT IS THE PRODUCT: this variable adds a window to the operator's screen, so
 * it must never be set by a default, a `.env`, a settings row or a product path.
 *
 * WHAT IT UNLOCKS, AND WHY IT IS A SEPARATE SWITCH. Every gate before it proves
 * the overlay with a headless window: the child paints, the page does not move,
 * keys are swallowed. None of them can prove what the operator sees, because a
 * headless window is never composited and a `capturePage()` of the owner returns
 * page pixels only. A visible run is therefore the one input that can close the
 * composite/hit-routing gap, and it is also the one input that can leave a window
 * on someone's screen. It is exact-`1`, requires S1 and S2, requires the armed
 * dev driver, refuses `normal` and `headless`, refuses a packaged build, and is
 * capped and launcher-bound (see `ADDRESS_OVERLAY_VISIBLE_MAX_MS`).
 */
export const ADDRESS_OVERLAY_VISIBLE_ENV =
	"LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_VISIBLE";

/**
 * The hard cap on a visible probe: 120 s from arm to exit, whatever the probe is
 * doing. `inactive` is not launcher-bound on its own (a person can close a visible
 * window, so `resolveLauncherWatchPlan` deliberately does not watch that mode), so
 * a visible run needs a lifetime of its own or a crashed harness leaves an
 * orphaned window — the exact leak class `AGENTS.md` records. The cap and the
 * launcher watch are both armed only when this gate says `visible`.
 */
export const ADDRESS_OVERLAY_VISIBLE_MAX_MS = 120_000;

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

/**
 * Shared sibling-document derivation. Exported for S6a's card so a second
 * overlay does not grow a second spelling of "trusted renderer URL's sibling";
 * the caller still supplies the document name, never a caller-supplied path.
 */
export function documentUrlFor(rendererUrl: string, document: string): string {
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
	/**
	 * S3's visible probe. True only when S1 and S2 passed AND the visible opt-in is
	 * exactly `1` AND the run is unpackaged, driven and `inactive`. It is a fact
	 * about the LAUNCH, so the host, the launcher watch and the lifetime cap all
	 * read this one field rather than re-deriving the conditions.
	 */
	visible: boolean;
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
 *
 * S3 LAYERS ON TOP, IT DOES NOT RELAX ANYTHING: with no visible opt-in present
 * every input reaches exactly the same answer it reached before S3 (the `visible`
 * field is the only addition, and it is always false there). A visible opt-in
 * flips the accepted mode from `headless` to `inactive` and adds three refusals —
 * missing S2, a packaged build, and any mode that is not `inactive` — because a
 * visible run is the one arm that can be mistaken for product behaviour.
 */
export function resolveAddressOverlayGate(input: {
	env: Record<string, string | undefined>;
	devDriverArmed: boolean;
	windowMode: WindowMode;
	/**
	 * `app.isPackaged` at the launch, passed by the caller that already reads it for
	 * `windowMode`. Optional and defaulting to `false` so every pre-S3 caller keeps
	 * its exact input shape; the visible arm is the only branch that reads it.
	 */
	packaged?: boolean;
}): AddressOverlayGate {
	const raw = input.env[ADDRESS_OVERLAY_S1_ENV];
	const listRaw = input.env[ADDRESS_LIST_ENV];
	const visibleRaw = input.env[ADDRESS_OVERLAY_VISIBLE_ENV];
	const listAsked = listRaw !== undefined && listRaw.trim() !== "";
	const visibleAsked = visibleRaw !== undefined && visibleRaw.trim() !== "";
	if (raw === undefined || raw.trim() === "") {
		// A lone S2/S3 opt-in is a refusal, not silence: the operator named an
		// experiment and is owed the reason it did not arm. S3 names BOTH missing
		// opt-ins, because VISIBLE alone is even less an arm than S2 alone.
		if (visibleAsked) {
			return {
				asked: true,
				enabled: false,
				list: false,
				visible: false,
				reason: `${ADDRESS_OVERLAY_VISIBLE_ENV} needs ${ADDRESS_OVERLAY_S1_ENV}=1 and ${ADDRESS_LIST_ENV}=1: the visible probe is an increment on S1's child and S2's mirror, not a third arm`,
			};
		}
		return listAsked
			? {
					asked: true,
					enabled: false,
					list: false,
					visible: false,
					reason: `${ADDRESS_LIST_ENV} needs ${ADDRESS_OVERLAY_S1_ENV}=1: S2's list is a mirror inside S1's child, not a second child`,
				}
			: {
					asked: false,
					enabled: false,
					list: false,
					visible: false,
					reason: null,
				};
	}
	const asked = true;
	if (raw.trim() !== "1") {
		return {
			asked,
			enabled: false,
			list: false,
			visible: false,
			reason: `${ADDRESS_OVERLAY_S1_ENV}=${raw.trim()} is not an opt-in (accepted: 1); the address overlay stayed off`,
		};
	}
	if (listAsked && listRaw.trim() !== "1") {
		return {
			asked,
			enabled: false,
			list: false,
			visible: false,
			reason: `${ADDRESS_LIST_ENV}=${listRaw.trim()} is not an opt-in (accepted: 1); the address overlay stayed off`,
		};
	}
	if (visibleAsked) {
		/*
		 * S3 is checked in this order for a reason: the opt-in shapes come first so a
		 * typo is reported as a typo, then the missing S2 arm, then every condition
		 * that would make a visible run unsafe or self-deceiving. `inactive` is the
		 * only accepted mode — `normal` is the product's own mode (a probe there could
		 * be mistaken for product behaviour and could take the operator's focus), and
		 * `headless` is refused because a headless run labelled "visible" would
		 * misattribute every pixel claim it wrote down.
		 */
		if (visibleRaw.trim() !== "1") {
			return {
				asked,
				enabled: false,
				list: false,
				visible: false,
				reason: `${ADDRESS_OVERLAY_VISIBLE_ENV}=${visibleRaw.trim()} is not an opt-in (accepted: 1); the address overlay stayed off`,
			};
		}
		if (!listAsked) {
			return {
				asked,
				enabled: false,
				list: false,
				visible: false,
				reason: `${ADDRESS_OVERLAY_VISIBLE_ENV} needs ${ADDRESS_LIST_ENV}=1: S3's visible probe shows S2's mirror, never a bare S1 child`,
			};
		}
		if (input.windowMode === "headless") {
			return {
				asked,
				enabled: false,
				list: false,
				visible: false,
				reason: `${ADDRESS_OVERLAY_VISIBLE_ENV} refused in a "headless" window: a headless run labelled visible would misattribute its evidence; use --window-mode=inactive`,
			};
		}
		if (input.windowMode !== "inactive") {
			return {
				asked,
				enabled: false,
				list: false,
				visible: false,
				reason: `${ADDRESS_OVERLAY_VISIBLE_ENV} refused in a "${input.windowMode}" window: a visible probe never runs in the product's own mode; use --window-mode=inactive`,
			};
		}
		if (!input.devDriverArmed) {
			return {
				asked,
				enabled: false,
				list: false,
				visible: false,
				reason:
					"the visible address overlay needs the armed renderer dev driver; it has no product path",
			};
		}
		if (input.packaged === true) {
			return {
				asked,
				enabled: false,
				list: false,
				visible: false,
				reason: `${ADDRESS_OVERLAY_VISIBLE_ENV} refused in a packaged build: S3 is an unpackaged probe, never product surface`,
			};
		}
		return {
			asked,
			enabled: true,
			list: true,
			visible: true,
			reason: null,
		};
	}
	if (!input.devDriverArmed) {
		return {
			asked,
			enabled: false,
			list: false,
			visible: false,
			reason:
				"the address overlay needs the armed renderer dev driver; it has no user-facing trigger in S1",
		};
	}
	if (input.windowMode !== "headless") {
		return {
			asked,
			enabled: false,
			list: false,
			visible: false,
			reason: `the address overlay refused to arm in a "${input.windowMode}" window; S1 has no user-facing path, so use --window-mode=headless`,
		};
	}
	return {
		asked,
		enabled: true,
		list: listAsked,
		visible: false,
		reason: null,
	};
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

/** The identity of the CONTENT a projection hangs from: the tab and the
 * rectangle, WITHOUT presentation.
 *
 * A presentation flip alone is not a reason to drop the product row's draft.
 * Opening the page menu suppresses the native page by design (the panel paints
 * into the content rect, where a native view wins), which flips `presented` to
 * false while the tab and the rectangle stay identical. Keying the dismissal on
 * `layoutKeyOf` made every menu item — and the menu's own view suppression —
 * close the field row it was opened from (agent review round 1, MAJOR-1). A
 * moved page, a changed tab or a torn-down rect still changes this key, and
 * those are the facts the renderer must obey. */
export function layoutContentKeyOf(
	snapshot: AddressOverlayLayoutSnapshot,
): string {
	const rect = snapshot.contentRect;
	return `${snapshot.activeTabId}:${
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
	/**
	 * S3 focus facts. They exist so the handoff claim ("focus never leaves the
	 * parent") is a MEASUREMENT rather than a reading of the source: a probe shows
	 * and hides the child, clicks into it and sends it keys, then checks that the
	 * child emitted no focus events, is not focused, and that the app's focused
	 * webContents is still the owner.
	 *
	 * WHAT THESE ARE NOT: `ownerWindowFocused` is `BrowserWindow.isFocused()`, which
	 * describes the window, not macOS first-responder state; Chromium's focus
	 * emulation (a CDP switch the probe turns on) can make `document.hasFocus()` true
	 * in a window the OS never activated. Both are labelled in the evidence matrix.
	 */
	child: {
		webContentsId: number;
		visible: boolean;
		bounds: OverlayRect | null;
		order: number;
		childCount: number;
		focusEvents: number;
		blurEvents: number;
		isFocused: boolean;
	} | null;
	/** True only for an S3 visible arm; false for every product and headless run. */
	visibleMode: boolean;
	/** `webContents.getFocusedWebContents()?.id` at facts time, or null. */
	ownerFocusedContentsId: number | null;
	/** `BrowserWindow.isFocused()` at facts time. */
	ownerWindowFocused: boolean;
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
		mouseMoves: number;
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
	/** S3: the launch gate's visible-probe fact. Facts only; the controller's
	 * behaviour does not change with it (there is no product path either way). */
	visible?: boolean;
	/**
	 * S4b: this controller is the PRODUCT chrome, not a probe.
	 *
	 * The difference is lifecycle, not trust: the product controller is built by
	 * every darwin launch and warms its child after the first presented layout so
	 * the first Cmd+L finds a loaded list; a probe creates its child only when a
	 * script calls `show`. Both use the same hardened child, the same projection
	 * sanitiser and the same commit sink.
	 */
	product?: boolean;
	/** S2: where a validated row click or a main-decided dismissal is reported
	 * (the host forwards it to the owner window). Absent means no sink, and the
	 * event is counted, not sent. */
	onEvent?: (event: AddressOverlayEvent) => void;
	/** The child's health changed in a way `mode()` reports (a terminal failure,
	 * or a release that clears one). The host re-projects chrome state from this,
	 * because the renderer reads `addressOverlay.mode` out of the projection and
	 * has no other way to learn the list went away (QA round 1, Q-F1: a raise
	 * that raced a failing child kept announcing suggestions). */
	onHealthChange?: () => void;
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

/**
 * The other event main sends: the list must come down, and the reason is
 * main's own observation (the page took focus, the bound tab navigated, the tab
 * changed or the layout moved). The renderer lowers its field row; it never
 * decides these facts itself, because a renderer-only dismissal cannot see a
 * click that lands on the native page view.
 */
export interface AddressOverlayDismissEvent {
	type: "dismiss";
	reason: string;
}

export type AddressOverlayEvent =
	| AddressOverlayCommitEvent
	| AddressOverlayDismissEvent;

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
			// The mirror is a tiny document that must stay frame-accurate while the
			// owner window is hidden, unfocused or occluded (headless probe, a
			// background app window). Chromium otherwise throttles its frame loop,
			// and a native resize can sit unapplied for ~1 s — the exact interval
			// `measure_viewport` is there to catch. S1 keeps the default.
			...(options.javascript ? { backgroundThrottling: false } : {}),
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
	private readonly onEvent: ((event: AddressOverlayEvent) => void) | null;
	private readonly onHealthChange: (() => void) | null;
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
	/** The layout's content identity (tab + rect), the fact a product dismissal
	 * is allowed to rest on; see `layoutContentKeyOf`. */
	private layoutContentKey: string;
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
	/** A sanitized v2 projection whose anchor preceded the matching page rect.
	 * It can resize a hidden reusable child on the next layout, never re-open it. */
	private pendingResizeProjection: AddressListProjection | null;
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
	private mouseMoves: number;
	private mouseDownRow: number | null;
	private contextMenuBlocked: number;
	// ---- S3 focus facts -----------------------------------------------------
	/** Counted only for the scripted (S2/S3) child, so S1's listener set stays
	 * exactly what it was; see `wireChild`'s S2 policy comment. */
	private childFocusEvents: number;
	private childBlurEvents: number;
	/** The launch gate's `visible` fact, copied in so `facts()` can report it
	 * without re-deriving the gate (which it must never do: one pure decision). */
	private readonly visibleMode: boolean;
	private readonly product: boolean;
	private warmScheduled: boolean;
	private lastRejected: string | null;
	private projectQueue: Promise<unknown>;
	/** The native page is hidden for a reason that says nothing about the popout
	 * (the page menu suppresses it while its panel is open). The row stays
	 * raised, so the child's paint stops and its "shown" state does not. */
	private presentationSuspended: boolean;
	/** A projection that arrived while the page was suppressed. Applied on
	 * resume rather than refused: a refusal would make the mirror re-project
	 * every frame until the menu closed. */
	private deferredProjection: unknown;

	constructor(deps: AddressOverlayDeps) {
		this.window = deps.window;
		this.documentUrl = deps.documentUrl;
		this.createView =
			deps.createView ??
			(() => createHardenedView({ javascript: deps.javascript === true }));
		this.javascript = deps.javascript === true;
		this.onEvent = deps.onEvent ?? null;
		this.onHealthChange = deps.onHealthChange ?? null;
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
		this.layoutContentKey = "none";
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
		this.pendingResizeProjection = null;
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
		this.mouseMoves = 0;
		this.mouseDownRow = null;
		this.contextMenuBlocked = 0;
		this.childFocusEvents = 0;
		this.childBlurEvents = 0;
		this.visibleMode = deps.visible === true;
		this.product = deps.product === true;
		this.warmScheduled = false;
		this.lastRejected = null;
		this.projectQueue = Promise.resolve();
		this.presentationSuspended = false;
		this.deferredProjection = null;
		this.attachOwnerListeners();
	}

	// ---- observer hooks ------------------------------------------------------

	/**
	 * The registry's post-layout hook. Called after every page layout pass,
	 * including null and suppressed ones.
	 *
	 * A changed key (tab, presentation or rectangle) is handled by ONE of two
	 * rules, and the split is load-bearing (agent review round 1, MAJOR-1):
	 * a CONTENT change (tab or rectangle) hides and invalidates, while a
	 * PRESENTATION-only change is a suppression that belongs to someone else —
	 * the page menu, which paints into the content rect — so it only stops the
	 * child's paint and keeps the shown state. Collapsing the two made opening
	 * the menu dismiss the popout it was opened from. An unchanged key is the
	 * background-page-creation case: the layout pass may have added a page above
	 * the child, so the child is re-added last and given the same rectangle. It
	 * never re-opens by itself; showing again is always an explicit probe call.
	 */
	onLayout(snapshot: AddressOverlayLayoutSnapshot): void {
		if (this.disposed) return;
		const next = copyLayout(snapshot);
		const nextKey = layoutKeyOf(next);
		const previousKey = this.layoutKey;
		const nextContentKey = layoutContentKeyOf(next);
		const previousContentKey = this.layoutContentKey;
		this.layout = next;
		this.layoutKey = nextKey;
		this.layoutContentKey = nextContentKey;
		if (previousKey !== nextKey) {
			const contentChanged = previousContentKey !== nextContentKey;
			if (!contentChanged) {
				// PRESENTATION ONLY: the page menu hides the native page while ITS panel is
				// open (a panel anchored in the strip paints into the content rect, where the
				// native view wins). That is not a fact about the popout — it must stay
				// raised — so the child only stops painting and the "shown" state the
				// re-assert below relies on is preserved (agent review round 1, MAJOR-1).
				if (next.presented) this.resumePresentation();
				else this.suspendPresentation();
				return;
			}
			// A moved page, a changed tab or a torn-down presentation invalidates the
			// popout as a whole. The product field row lives in the renderer, so main
			// tells it to come down rather than only hiding the native list. A narrow
			// anchor that arrived just before this rect may still resize the reusable
			// child, but the dismissal and hidden state are unchanged.
			this.resizeDeferredChild(next);
			this.hide("layout");
			// The first pass has no popout to lower (previousKey "none").
			if (this.product && previousKey !== "none") this.emitDismiss("layout");
			return;
		}
		if (this.product && next.presented && next.contentRect !== null) {
			this.ensureChild();
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

	/** Hide the child's paint without dropping the popout's state; see `onLayout`. */
	private suspendPresentation(): void {
		this.presentationSuspended = true;
		const view = this.view;
		if (!view || this.viewUsable(view) === false) return;
		try {
			view.setVisible(false);
		} catch {
			// The window is closing; the visibility claim is moot.
		}
	}

	/** The page is back. Re-present the child from the bounds last applied, or
	 * apply the projection that arrived while the page was hidden. */
	private resumePresentation(): void {
		if (!this.presentationSuspended) return;
		this.presentationSuspended = false;
		const deferred = this.deferredProjection;
		this.deferredProjection = null;
		if (deferred !== null) {
			void this.project(deferred);
			return;
		}
		if (this.state !== "shown") return;
		// The S1 show path has no projection, so it has no applied bounds either; the
		// same rule `onLayout`'s re-assert uses covers it.
		const bounds =
			this.lastAppliedBounds ??
			overlayBoundsFor(this.layout.contentRect, this.ownerSize());
		if (bounds === null) return;
		const view = this.view;
		if (!view || this.viewUsable(view) === false) return;
		try {
			view.setBounds(bounds);
			this.raiseChild(view);
			view.setVisible(true);
		} catch {
			this.releaseChild("layout_error");
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

	/**
	 * The popout's current health, in the one shape the renderer reads.
	 *
	 * `suspend` is sticky for the app run: the child is either latched failed or
	 * gone, and the restart that would clear it is a new process. A conditional
	 * refusal (`zoomed`, `anchor_too_narrow`, `stale_*`) is NOT reported here —
	 * those clear themselves, and the projection answer names them while they
	 * last.
	 */
	mode(): { mode: "popout" | "suspend"; reason: string | null } {
		if (this.disposed) return { mode: "suspend", reason: "disposed" };
		if (this.failedReason)
			return { mode: "suspend", reason: this.failedReason };
		return { mode: "popout", reason: null };
	}

	/**
	 * A main-decided dismissal (the page took focus, the bound tab's main frame
	 * navigated, the tab went away). Idempotent: a second reason for a popout that
	 * is already hidden sends nothing.
	 */
	dismiss(reason: string): void {
		if (this.disposed) return;
		// The PRODUCT renderer may be raised before any projection exists (the field
		// is usable while the child loads or after it failed), so "was the child
		// shown" is not the question: a dismissal is main's fact about the popout,
		// and a renderer with nothing open ignores it.
		this.hide(reason);
		if (this.product) this.emitDismiss(reason);
	}

	/** The page `tabId` took focus. Only the bound tab can dismiss its own list;
	 * a background tab's focus event is not this popout's business. */
	dismissForTab(tabId: number, reason: string): void {
		if (this.disposed) return;
		if (this.boundTabId !== null && this.boundTabId !== tabId) return;
		if (this.layout.activeTabId !== null && this.layout.activeTabId !== tabId)
			return;
		this.dismiss(reason);
	}

	/**
	 * Warm the list child once the page has a presented layout, so the first
	 * raise finds a loaded document instead of paying the load after Cmd+L. The
	 * child is created hidden and stays hidden until a projection shows it.
	 */
	private ensureChild(): void {
		if (!this.product || this.view || this.failedReason || this.warmScheduled)
			return;
		const bounds = overlayBoundsFor(this.layout.contentRect, this.ownerSize());
		if (bounds === null || !this.layout.presented) return;
		this.warmScheduled = true;
		setTimeout(() => {
			this.warmScheduled = false;
			if (this.disposed || this.view || this.failedReason) return;
			if (!this.layout.presented) return;
			const rect = overlayBoundsFor(this.layout.contentRect, this.ownerSize());
			if (rect === null) return;
			if (this.createChild(rect)) this.state = "loading";
		}, 0);
	}

	private emitDismiss(reason: string): void {
		this.onEvent?.({ type: "dismiss", reason });
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
		// A hide is the end of the row's native life: whatever the page-menu
		// suppression was holding must not come back on a later layout pass.
		this.presentationSuspended = false;
		this.deferredProjection = null;
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

	/** `WebContents.isFocused()` behind a guard: a disposed view throws. */
	private childIsFocused(view: WebContentsView): boolean {
		try {
			return view.webContents.isFocused();
		} catch {
			return false;
		}
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
				focusEvents: this.childFocusEvents,
				blurEvents: this.childBlurEvents,
				isFocused: this.childIsFocused(view),
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
		// Read separately from the block above: a window stub without `isFocused`
		// must answer "not focused", never turn into "destroyed".
		let ownerWindowFocused = false;
		try {
			ownerWindowFocused = !ownerDestroyed && this.window.isFocused();
		} catch {
			ownerWindowFocused = false;
		}
		/*
		 * `getFocusedWebContents` answers "which of THIS app's webContents holds focus",
		 * which is the only in-process reading of the handoff that Chromium exposes. It
		 * is read defensively: it can throw before `app` is ready or during teardown,
		 * and a facts call must never be what fails a probe.
		 */
		let ownerFocusedContentsId: number | null = null;
		try {
			ownerFocusedContentsId = webContents.getFocusedWebContents()?.id ?? null;
		} catch {
			ownerFocusedContentsId = null;
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
			visibleMode: this.visibleMode,
			ownerFocusedContentsId,
			ownerWindowFocused,
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
				mouseMoves: this.mouseMoves,
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
		if (this.presentationSuspended) {
			// The page is hidden for a reason that does not involve the field. Keep the
			// newest payload for `resumePresentation` and answer as accepted so the
			// mirror does not re-project the same frame sixty times a second.
			this.deferredProjection = raw;
			return Promise.resolve({
				accepted: true,
				shown: false,
				reason: null,
				bounds: null,
			});
		}
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
			this.pendingResizeProjection = null;
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
		const bounds =
			projection.v === 2
				? projection.anchor.width < ADDRESS_LIST_MIN_WIDTH_DIP
					? null
					: addressListBoundsV2For(
							projection.anchor,
							projection.pageRect,
							projection.view,
							this.ownerSize(),
						)
				: addressListBoundsFor(
						projection.field,
						projection.listTop,
						projection.view,
						this.ownerSize(),
					);
		if (bounds === null) {
			const tooNarrow =
				projection.v === 2 &&
				projection.anchor.width < ADDRESS_LIST_MIN_WIDTH_DIP;
			if (projection.v === 2 && !tooNarrow) {
				// ResizeObserver delivery is not atomic across the row and page. Keep
				// the sanitized geometry only so the matching layout can resize the
				// hidden child; it is not shown and main's consistency check is intact.
				this.pendingResizeProjection = projection;
			}
			return this.refuseProjection(
				tooNarrow ? "anchor_too_narrow" : "anchor_inconsistent",
			);
		}
		this.pendingResizeProjection = null;

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

		// SIZE BEFORE PAINT. The child pins its layout height from the model, so the
		// measurement must ALSO prove the native view is the size main asked for
		// (`innerHeight`); otherwise a deferred resize lets main claim "shown" over
		// rows the view is not painting. A hidden (headless) window throttles its
		// frame loop, so the mismatch is retried; a visible window lands next frame.
		view.setBounds(bounds);
		// VISIBLE BEFORE MEASUREMENT. Chromium does not deliver a resize to a hidden
		// WebContentsView: the native bounds read back correctly while the renderer
		// viewport stays at the previous height indefinitely (measured at 140→211).
		// The child is about to be shown, and the apply below lands before the next
		// compositor frame, so the worst case after a refusal is one frame at the
		// new rectangle showing the model being replaced.
		this.raiseChild(view);
		view.setVisible(true);
		const model = addressListViewModel(projection);
		let measured: unknown = null;
		let problem: string | null = null;
		try {
			for (let attempt = 0; attempt < 8; attempt += 1) {
				// Re-assert only on alternate attempts: a `setBounds` per iteration
				// would supersede the previous native resize before the compositor
				// can apply it, starving the very transition this loop waits for.
				if (attempt % 2 === 1) view.setBounds(bounds);
				// A FIXED function name with a main-built JSON argument: the child never
				// receives code, only data. `JSON.stringify` does NOT escape U+2028/2029
				// or `</script>`; the guarantee here is that `sanitizeProjection` strips
				// those code points from every string before this point, and that this is
				// `executeJavaScript` rather than an HTML parsing context.
				measured = await view.webContents.executeJavaScript(
					`window.__loAddressOverlay && window.__loAddressOverlay.apply(${JSON.stringify(model)})`,
					false,
				);
				problem = addressListMeasurementProblem(
					measured,
					projection,
					bounds.height,
				);
				if (problem === null) break;
				// Two mismatches are timing, not defects: the child's scrollport can
				// predate the model height (`measure_scroll`), and the native view can
				// still be the previous rectangle (`measure_viewport`) while the
				// compositor catches up. Retry both, then fail closed. The spacing is
				// 150 ms, not one frame: a HIDDEN (headless) window throttles its frame
				// loop, and the shipped S2 matrix measured up to ~1 s before a native
				// resize reached the child's layout. Eight attempts bound this at
				// 1.2 s; a visible window lands on the first or second.
				if (problem !== "measure_scroll" && problem !== "measure_viewport")
					break;
				await new Promise((done) => setTimeout(done, 150));
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
		return { accepted: true, shown: true, reason: null, bounds };
	}

	private resizeDeferredChild(snapshot: AddressOverlayLayoutSnapshot): void {
		const projection = this.pendingResizeProjection;
		this.pendingResizeProjection = null;
		// Only the refusal path above hides before this helper runs. A shown child
		// keeps the established lastAppliedBounds path below; this branch must not
		// turn a deferred resize into a second presentation mechanism.
		if (
			this.state === "shown" ||
			projection === null ||
			projection.v !== 2 ||
			projection.tabId !== snapshot.activeTabId ||
			!snapshot.presented ||
			snapshot.contentRect === null
		) {
			return;
		}
		const bounds = addressListBoundsV2For(
			projection.anchor,
			snapshot.contentRect,
			projection.view,
			this.ownerSize(),
		);
		const view = this.view;
		if (bounds === null || !view || !this.viewUsable(view)) return;
		try {
			// Chromium does not deliver a resize to a hidden WebContentsView renderer.
			// These synchronous calls yield no compositor frame: the child becomes
			// measurable at the new bounds, then returns to the dismissal's hidden
			// state in the same main-task turn rather than re-opening the list.
			const wasVisible = view.getVisible();
			if (!wasVisible) view.setVisible(true);
			view.setBounds(bounds);
			if (!wasVisible) view.setVisible(false);
		} catch (error) {
			this.releaseChild(`layout_error:${String(error)}`);
		}
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
		 * S2's input policy, and ONLY for S2's scripted child: S1's inert document
		 * keeps the exact listener set it had, so "S2 off is bit-for-bit S1" stays
		 * literally true. The child is a PRESENTATION surface — it never owns
		 * keyboard, focus or native hit routing (S3) — so every key is swallowed and
		 * counted and the context menu is refused. Mouse DOWN/UP are observed and
		 * prevented (preventing them is what keeps a click on a row from moving focus
		 * out of the parent input; a lost click is acceptable, a wrong navigation is
		 * not). MOVE is delivered untouched so the row's `:hover` can paint.
		 */
		if (!this.javascript) return;
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
		/*
		 * S3's handoff counters. They count and nothing else: the child must never
		 * take focus, and an observer that re-focuses the parent would hide the very
		 * defect the probe is looking for. Registered only for the scripted child so
		 * "S2 off is bit-for-bit S1" stays true of the listener set too.
		 */
		on(contents, "focus", () => {
			this.childFocusEvents += 1;
		});
		on(contents, "blur", () => {
			this.childBlurEvents += 1;
		});
		on(contents, "before-mouse-event", (...args) => {
			const event = args[0] as { preventDefault?: () => void } | undefined;
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
			// HOVER IS NOT A CLICK. Only down/up are prevented; a prevented move
			// never reaches the page and would make `.lo-row:hover` dead. The move
			// is counted so a probe can prove delivery.
			if (mouse.type === "mouseMove") {
				this.mouseMoves += 1;
				return;
			}
			event?.preventDefault?.();
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
		// The renderer's Tier 1 notice rests on `mode()`, so a failure that lands
		// while the field is already raised must reach it as a projection.
		this.onHealthChange?.();
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
		this.onHealthChange?.();
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
