/**
 * S6a: the approvals card's inert native child.
 *
 * WHY A NATIVE CHILD, in one sentence: the page is a `WebContentsView` painted
 * above the app's DOM, so any card that must be visible without moving or
 * hiding that page has to be another native child added above it. This module
 * is the smallest honest version of that surface: it creates one child, gives it
 * the geometry owned by `approvals-overlay-bounds.ts`, presents it when the
 * live queue is non-empty, and never takes focus.
 *
 * S6b ADDS THE INTERACTIVE HALF: a purpose-built preload, exactly two channels
 * to main (`dismiss`, `decide`), an explicit open that hands keyboard focus to
 * the card and a close that returns it to the page. More options and Review all
 * stay local view changes in the document; decisions are re-resolved against
 * the live queue and routed through `host.respondToConsent`, never implemented
 * a second time here. Escape dismisses without deciding.
 *
 * AUTOPRESENT IS STILL UNFOCUSED, and that is fixed policy rather than a flag:
 * arrival shows the card without a focus call, a page focus/blur event or a
 * bounds change. Only `open()` — the shield's explicit click — may focus it.
 * The page keeps typing and keeps its first responder while the card is shown.
 *
 * LIFETIME: one lazy child per host window; hidden rather than destroyed when
 * the queue empties or the page stops being presented. A tab switch with an
 * unchanged content rect does not hide it; a content-rect RESIZE rebuilds it
 * because Electron 44.3.0 leaves the replacement WebContents viewport at the
 * old size otherwise (see `applyBounds`). A load failure or crash latches off,
 * so a broken document cannot restart forever.
 */

import { randomUUID } from "node:crypto";
import {
	type BrowserWindow,
	type IpcMainEvent,
	WebContentsView,
	ipcMain,
	session,
	webContents,
} from "electron";
import {
	APPROVALS_CARD_DECIDE_CHANNEL,
	APPROVALS_CARD_DISMISS_CHANNEL,
	type ApprovalsCardDecidePayload,
	type ApprovalsCardDecision,
	type ApprovalsCardDismissPayload,
	type ApprovalsCardModel,
	isApprovalsCardDecision,
} from "../../shared/browser-approvals-overlay";
import {
	APPROVALS_CARD_MIN_HEIGHT,
	type ApprovalsCardBounds,
	type ApprovalsCardRect,
	approvalsCardBoundsFor,
} from "./approvals-overlay-bounds";
import {
	type ApprovalsCardModelInput,
	approvalsCardModelFrom,
} from "./approvals-overlay-model";

export interface ApprovalsOverlayLayout {
	presented: boolean;
	contentRect: ApprovalsCardRect | null;
	revision: number;
}

export interface ApprovalsOverlayFacts {
	pending: number;
	/** The request the card is showing, if any. */
	requestEntryId: string | null;
	/** The model's seq; every action must echo it. */
	seq: number;
	/** True only after an explicit open (never for an auto-present). */
	explicitOpen: boolean;
	/** Counters for the trust tests: accepted actions and stale/forged drops. */
	actions: { dismissed: number; decided: number; dropped: number };
	presented: boolean;
	contentRect: ApprovalsCardRect | null;
	ready: boolean;
	visible: boolean;
	failedReason: string | null;
	bounds: ApprovalsCardBounds | null;
	childIndex: number;
	childCount: number;
	childWebContentsId: number | null;
	focusedWebContentsId: number | null;
	documentUrl: string;
	opaque: boolean;
}

export interface ApprovalsOverlayDeps {
	window: BrowserWindow;
	/** The app's own trusted card document; never a caller-supplied path. */
	documentUrl: string;
	/** S6b's purpose-built preload; absent means the S6a inert document. */
	preloadPath?: string;
	/** Windows/Linux fallback: opaque card, no transparent ring. */
	opaque?: boolean;
	/** The palette the host last resolved; the model carries it to the document. */
	theme?: "light" | "dark";
	/** The app's exact palette name (`data-theme`); null means the mode default. */
	palette?: string | null;
	/** Display labels keyed by the queue's `requesterSessionId`. */
	requesterLabels?: Readonly<Record<string, string>>;
	/** Called whenever the card's chrome-visible state changes (dismiss, open, close). */
	onChanged?: () => void;
	/** The resolved locale/direction the app renderer last reported. */
	locale?: string;
	dir?: "ltr" | "rtl";
	/**
	 * Answer a decision. The host routes this through `host.respondToConsent`;
	 * the controller never implements a second decision path. Rejecting (or
	 * throwing) turns the card's inline error state on and decides nothing.
	 */
	respond?: (entryId: string, decision: ApprovalsCardDecision) => unknown;
	/** The presented page, for focus return on close. */
	pageWebContents?: () => { isDestroyed(): boolean; focus(): void } | null;
	/**
	 * Reassign keyboard focus inside an already-focused window. The host passes
	 * `window-raise.ts`'s `focusBrowserChordTarget`, so an inactive/headless run
	 * cannot turn a card open into a window raise.
	 */
	focusTarget?: (target: { isDestroyed(): boolean; focus(): void }) => void;
	log?: (message: string) => void;
}

/** Labels are display strings keyed by a session id; bound both sides. */
function sanitizeRequesterLabels(
	input: Readonly<Record<string, string>>,
): Record<string, string> {
	const labels: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		if (Object.keys(labels).length >= 64) break;
		if (typeof key !== "string" || key.length === 0 || key.length > 128) {
			continue;
		}
		if (typeof value !== "string" || value.trim() === "") continue;
		labels[key] = value.trim().slice(0, 256);
	}
	return labels;
}

/**
 * S6c's one product switch. The card is ON by default; exactly `1` is the
 * kill switch that restores the DOM dock and band for that launch. Any other
 * value (including absent) leaves the card on. The switch is read once in the
 * host, so a launch either builds the child or never creates it.
 */
export const APPROVALS_OVERLAY_DISABLE_ENV =
	"LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE";

const TRANSPARENT = "#00000000";
const OPAQUE = "#1b1f24";

/** The only switch, in one place so the host and its test spell it the same. */
export function approvalsOverlayEnabled(
	env: Record<string, string | undefined>,
): boolean {
	return env[APPROVALS_OVERLAY_DISABLE_ENV] !== "1";
}

/**
 * Milliseconds until the earliest live approval expires, or `null` when the
 * queue is empty. The caller adds its own margin; this function is the one
 * arithmetic that keeps the card from outliving its queue.
 */
export function approvalsExpiryDelay(
	entries: ReadonlyArray<{ expiresAt: number }>,
	now = Date.now(),
): number | null {
	if (entries.length === 0) return null;
	return Math.max(
		0,
		Math.min(...entries.map((entry) => entry.expiresAt)) - now,
	);
}

/**
 * The card document's URL.
 *
 * THE COUNT IS A FIRST-PAINT FALLBACK ONLY. It rides the URL for the one state
 * that can be visible (a non-empty queue); at zero it is omitted, because a
 * `count=0` document paints "0 approvals waiting" for the load and the child
 * is hidden anyway. The live card arrives through the document's
 * `__approvalsCard.setModel` bridge, which owns the catalogue lookup and the ICU
 * plural; the URL count is never the source of truth.
 */
export function approvalsDocumentUrl(
	documentUrl: string,
	count: number,
	theme: "light" | "dark",
	opaque: boolean,
): string {
	try {
		const url = new URL(documentUrl);
		if (count > 0) url.searchParams.set("count", String(count));
		url.searchParams.set("theme", theme);
		if (opaque) url.searchParams.set("opaque", "1");
		return url.toString();
	} catch {
		return documentUrl;
	}
}

export class ApprovalsOverlayController {
	private readonly window: BrowserWindow;
	private readonly documentUrl: string;
	private readonly preloadPath: string | null;
	private readonly opaque: boolean;
	private readonly respond:
		| ((entryId: string, decision: ApprovalsCardDecision) => unknown)
		| null;
	private readonly pageWebContents:
		| (() => { isDestroyed(): boolean; focus(): void } | null)
		| null;
	private readonly focusTarget:
		| ((target: { isDestroyed(): boolean; focus(): void }) => void)
		| null;
	private readonly onChanged: (() => void) | null;
	private readonly log: (message: string) => void;
	private readonly onDismissAction: (
		event: IpcMainEvent,
		payload: unknown,
	) => void;
	private readonly onDecideAction: (
		event: IpcMainEvent,
		payload: unknown,
	) => void;

	private view: WebContentsView | null;
	private childListeners: Array<() => void>;
	private model: ApprovalsCardModel | null;
	/**
	 * THE RAW QUEUE, not the painted pending list. A rebuild after a dismissal or
	 * a context change must still know each entry's session id and broad grant;
	 * rebuilding from `model.pending` lost both (round-2 F2).
	 */
	private entries: ApprovalsCardModelInput["entries"];
	private modelSeq: number;
	private dismissed: Set<string>;
	private requesterLabels: Record<string, string>;
	private palette: string | null;
	private actionError: "stale" | "unavailable" | null;
	private explicitOpen: boolean;
	private pendingFocus: boolean;
	private locale: string;
	private dir: "ltr" | "rtl";
	private theme: "light" | "dark";
	private actionCounts: { dismissed: number; decided: number; dropped: number };
	private pending: number;
	private ready: boolean;
	private visible: boolean;
	private failedReason: string | null;
	private disposed: boolean;
	/**
	 * True only while the constructor runs. A child that fails synchronously
	 * (`session.fromPartition`, `new WebContentsView` throwing) reaches `fail()`
	 * before the host has finished building: its `onChanged` closes over
	 * `notifyChanged`, which is declared AFTER the controller in the host, so
	 * calling it here is a temporal-dead-zone throw that stopped the whole browser
	 * host (R1). Nothing was told `available: true` yet, so there is nothing to push:
	 * the host's first projection reads `state()` and sees `available: false`.
	 */
	private constructing: boolean;
	private naturalHeight: number;
	private layout: ApprovalsOverlayLayout;
	private bounds: ApprovalsCardBounds | null;

	constructor(deps: ApprovalsOverlayDeps) {
		this.window = deps.window;
		this.documentUrl = deps.documentUrl;
		this.preloadPath = deps.preloadPath ?? null;
		this.opaque = deps.opaque === true;
		this.respond = deps.respond ?? null;
		this.pageWebContents = deps.pageWebContents ?? null;
		this.focusTarget = deps.focusTarget ?? null;
		this.onChanged = deps.onChanged ?? null;
		this.log = deps.log ?? (() => {});
		this.view = null;
		this.childListeners = [];
		this.model = null;
		this.entries = [];
		this.modelSeq = 0;
		this.dismissed = new Set();
		this.requesterLabels = { ...(deps.requesterLabels ?? {}) };
		this.palette = deps.palette ?? null;
		this.actionError = null;
		this.explicitOpen = false;
		this.pendingFocus = false;
		this.locale = deps.locale ?? "en";
		this.dir = deps.dir === "rtl" ? "rtl" : "ltr";
		this.theme = deps.theme === "light" ? "light" : "dark";
		this.actionCounts = { dismissed: 0, decided: 0, dropped: 0 };
		this.pending = 0;
		this.ready = false;
		this.visible = false;
		this.failedReason = null;
		this.disposed = false;
		this.constructing = false;
		this.naturalHeight = APPROVALS_CARD_MIN_HEIGHT;
		this.layout = {
			presented: false,
			contentRect: null,
			revision: 0,
		};
		this.bounds = null;
		this.onDismissAction = (event, payload) => {
			if (!this.acceptAction(event, payload)) return;
			const action = payload as ApprovalsCardDismissPayload;
			/*
			 * ANY LIVE ENTRY MAY BE DISMISSED. The list view lets the operator
			 * select a request other than the oldest one, so membership in the
			 * card's own pending list is the check — not equality with
			 * `model.request` (which stays the controller's own selection).
			 */
			if (!this.isPendingEntry(action.entryId)) {
				this.dropAction();
				return;
			}
			this.actionCounts.dismissed += 1;
			this.dismissEntry(action.entryId);
		};
		this.onDecideAction = (event, payload) => {
			if (!this.acceptAction(event, payload)) return;
			const action = payload as ApprovalsCardDecidePayload;
			if (
				!this.isPendingEntry(action.entryId) ||
				!isApprovalsCardDecision(action.decision)
			) {
				this.dropAction();
				return;
			}
			this.actionCounts.decided += 1;
			this.decide(action.entryId, action.decision);
		};
		// TWO CHANNELS, BOTH PINNED TO THIS CHILD. Registering per controller is
		// what lets the sender test name one webContents; a second controller (a
		// second window) ignores it because `event.sender` is not its own child.
		ipcMain.on(APPROVALS_CARD_DISMISS_CHANNEL, this.onDismissAction);
		ipcMain.on(APPROVALS_CARD_DECIDE_CHANNEL, this.onDecideAction);
		/*
		 * ATTACH THE CHILD BEFORE THE PAGE IS FOCUSED, not when the first request
		 * arrives. A native child attached while the window already owns a focused
		 * page can become first responder even when it is hidden; attaching at host
		 * construction (before any page exists) keeps the auto-present path from
		 * moving focus when the card is later shown.
		 */
		this.constructing = true;
		try {
			this.ensureChild();
		} finally {
			this.constructing = false;
		}
	}

	/**
	 * Replace the card's model from the host's live queue.
	 *
	 * This is the AUTO-PRESENT path: a non-empty queue shows the card without a
	 * focus call, a focus event or a bounds change to the page. Only `open()`
	 * (an explicit shield click) may focus it.
	 */
	setModel(input: {
		entries: ApprovalsCardModelInput["entries"];
		locale?: string;
		dir?: "ltr" | "rtl";
		theme?: "light" | "dark";
		palette?: string | null;
		requesterLabels?: Readonly<Record<string, string>>;
		busy?: boolean;
		error?: "stale" | "unavailable" | null;
	}): void {
		if (this.disposed) return;
		if (typeof input.locale === "string" && input.locale.trim() !== "") {
			this.locale = input.locale.trim().slice(0, 35);
		}
		if (input.dir === "ltr" || input.dir === "rtl") this.dir = input.dir;
		if (input.theme === "light" || input.theme === "dark") {
			this.theme = input.theme;
		}
		if ("palette" in input) this.palette = input.palette ?? null;
		if (input.requesterLabels) {
			this.requesterLabels = { ...input.requesterLabels };
		}
		this.entries = input.entries;
		this.actionError = null;
		const model = approvalsCardModelFrom({
			seq: ++this.modelSeq,
			entries: this.entries,
			locale: this.locale,
			dir: this.dir,
			theme: this.theme,
			palette: this.palette,
			requesterLabels: this.requesterLabels,
			view: this.model?.view ?? "request",
			focus: false,
			busy: input.busy === true,
			error: input.error ?? null,
			dismissed: this.dismissed,
		});
		this.model = model;
		this.pending = model.count;
		// A dismissed id that has left the queue no longer needs remembering;
		// pruning here is what lets the same entry id be presented again only if
		// it is genuinely new, not because the set grew forever.
		for (const id of this.dismissed) {
			if (!model.pending.some((entry) => entry.entryId === id)) {
				this.dismissed.delete(id);
			}
		}
		this.pushModel(false);
		if (!model.request) {
			// An auto-present can empty while the shield still reads the card as
			// explicitly open. Clearing here keeps the shield's aria-expanded and its
			// next click coherent (M1).
			this.explicitOpen = false;
			this.pendingFocus = false;
			this.hide();
			this.onChanged?.();
			return;
		}
		this.maybeShow();
		/*
		 * The card's height is content-driven and the model just changed it, so
		 * the measurement taken at load is stale. `measureAndShow` pushes the
		 * model again (idempotent, same seq) and then reads the painted height;
		 * without this a card settled on an empty 118 DIP body would clip the
		 * decision buttons below the fold.
		 */
		if (this.ready) this.measureAndShow();
	}

	/**
	 * Explicit open (the shield). Focus is handed to the card only when the host
	 * supplied `focusTarget`; an inactive/headless run still opens the card but
	 * takes nothing.
	 */
	open(
		input: {
			focus?: boolean;
			locale?: string;
			dir?: "ltr" | "rtl";
			theme?: "light" | "dark";
			palette?: string | null;
			requesterLabels?: Readonly<Record<string, string>>;
		} = {},
	): void {
		if (this.disposed) return;
		if (typeof input.locale === "string" && input.locale.trim() !== "") {
			this.locale = input.locale.trim().slice(0, 35);
		}
		if (input.dir === "ltr" || input.dir === "rtl") this.dir = input.dir;
		if (input.theme === "light" || input.theme === "dark") {
			this.theme = input.theme;
		}
		if ("palette" in input) this.palette = input.palette ?? null;
		if (input.requesterLabels) {
			this.requesterLabels = { ...input.requesterLabels };
		}
		/*
		 * NOTHING TO OPEN: return before arming. Arming `explicitOpen` for an empty
		 * queue used to leave the next arrival auto-presented FOCUSED, because the
		 * latch survived the hide (M3).
		 */
		if (!this.model || this.model.count === 0) return;
		/*
		 * EVERY LIVE REQUEST MAY HAVE BEEN DISMISSED. The card is hidden then, but
		 * the shield must still recall it (U3); an explicit open is the operator
		 * asking to see the queue again, so the presentation-only dismissals are
		 * cleared and the oldest live request is shown.
		 */
		if (!this.model.request) {
			this.dismissed.clear();
			this.model = approvalsCardModelFrom({
				seq: ++this.modelSeq,
				entries: this.entries,
				locale: this.locale,
				dir: this.dir,
				theme: this.theme,
				palette: this.palette,
				requesterLabels: this.requesterLabels,
				view: "request",
				focus: false,
				busy: false,
				error: null,
				dismissed: this.dismissed,
			});
			this.pending = this.model.count;
		}
		this.explicitOpen = true;
		this.pendingFocus = input.focus !== false;
		this.pushModel(false);
		this.onChanged?.();
		this.maybeShow();
		// An explicit open follows a locale/width change; re-measure so the card is
		// not stuck at the height it had while hidden (U minor).
		if (this.ready) this.measureAndShow();
		this.focusIfPending();
	}

	/**
	 * Update the app context the card renders in. The renderer pushes this on
	 * mount and on every locale/theme change; without it an auto-presented card
	 * stays in `en` until the first explicit open (U5).
	 */
	setContext(input: {
		locale?: string;
		dir?: "ltr" | "rtl";
		theme?: "light" | "dark";
		palette?: string | null;
		requesterLabels?: Readonly<Record<string, string>>;
	}): void {
		if (this.disposed) return;
		let changed = false;
		if (
			typeof input.locale === "string" &&
			input.locale.trim() !== "" &&
			input.locale.trim().slice(0, 35) !== this.locale
		) {
			this.locale = input.locale.trim().slice(0, 35);
			changed = true;
		}
		if (
			(input.dir === "ltr" || input.dir === "rtl") &&
			input.dir !== this.dir
		) {
			this.dir = input.dir;
			changed = true;
		}
		if (
			(input.theme === "light" || input.theme === "dark") &&
			input.theme !== this.theme
		) {
			this.theme = input.theme;
			changed = true;
		}
		if ("palette" in input && (input.palette ?? null) !== this.palette) {
			this.palette = input.palette ?? null;
			changed = true;
		}
		if (input.requesterLabels) {
			const labels = sanitizeRequesterLabels(input.requesterLabels);
			if (JSON.stringify(labels) !== JSON.stringify(this.requesterLabels)) {
				this.requesterLabels = labels;
				changed = true;
			}
		}
		if (!changed) return;
		if (this.model) {
			this.model = approvalsCardModelFrom({
				seq: ++this.modelSeq,
				entries: this.entries,
				locale: this.locale,
				dir: this.dir,
				theme: this.theme,
				palette: this.palette,
				requesterLabels: this.requesterLabels,
				view: this.model.view,
				focus: false,
				busy: this.model.busy,
				error: this.actionError,
				dismissed: this.dismissed,
			});
		}
		this.pushModel(false);
		// A locale change changes the copy length, and a direction change moves the
		// native view; both need the layout pass and a fresh measurement.
		if (this.layout.presented) this.maybeShow();
		if (this.ready) this.measureAndShow();
	}

	/** Close without deciding (Close, Escape, or the shield's second click). */
	close(reason = "close"): void {
		if (this.disposed) return;
		// A close ends the action too: a later context push must not resurrect the
		// stale line from a click on a card that has already gone (round-3 minor).
		this.actionError = null;
		this.explicitOpen = false;
		this.pendingFocus = false;
		this.hide();
		this.returnFocus();
		this.onChanged?.();
		this.log(`[browser] approvals card closed: ${reason}`);
	}

	/** The registry's copied layout snapshot, after every page layout pass. */
	onLayout(snapshot: ApprovalsOverlayLayout): void {
		if (this.disposed) return;
		this.layout = {
			presented: snapshot.presented,
			contentRect: snapshot.contentRect ? { ...snapshot.contentRect } : null,
			revision: snapshot.revision,
		};
		if (!snapshot.presented || !snapshot.contentRect) {
			// Route loss / a modal hiding the page: the card is not on screen, so the
			// shield must not keep claiming it is explicitly open.
			this.explicitOpen = false;
			this.pendingFocus = false;
			this.hide();
			return;
		}
		if (this.model?.request) this.maybeShow();
	}

	facts(): ApprovalsOverlayFacts {
		const view = this.view;
		const children = this.window.isDestroyed()
			? []
			: this.window.contentView.children;
		const index = view ? children.indexOf(view) : -1;
		let focused: number | null = null;
		try {
			focused = webContents.getFocusedWebContents()?.id ?? null;
		} catch {
			focused = null;
		}
		return {
			pending: this.pending,
			requestEntryId: this.model?.request?.entryId ?? null,
			seq: this.model?.seq ?? 0,
			explicitOpen: this.explicitOpen,
			actions: { ...this.actionCounts },
			presented: this.layout.presented,
			contentRect: this.layout.contentRect,
			ready: this.ready,
			visible: this.visible,
			failedReason: this.failedReason,
			bounds: this.bounds,
			childIndex: index,
			childCount: children.length,
			childWebContentsId: view ? view.webContents.id : null,
			focusedWebContentsId: focused,
			documentUrl: this.documentUrl,
			opaque: this.opaque,
		};
	}

	/** The chrome projection's view of the card. */
	state(): { available: boolean; open: boolean; visible: boolean } {
		return {
			available: !this.disposed && this.failedReason === null,
			// The shield button is a TOGGLE for the surface it opens, not a mirror of
			// auto-present: `visible` is true whenever a request arrived and the card
			// painted itself, and using that as `open` made the first shield click a
			// close and a later one a no-op (M1/U1).
			open: this.explicitOpen,
			visible: this.visible,
		};
	}

	dispose(reason = "dispose"): void {
		if (this.disposed) return;
		this.disposed = true;
		this.visible = false;
		this.ready = false;
		// A dead card is not an open one: `state().open` must read false after a
		// crash, as `fail()` promises the renderer (Q2).
		this.explicitOpen = false;
		this.pendingFocus = false;
		ipcMain.removeListener(
			APPROVALS_CARD_DISMISS_CHANNEL,
			this.onDismissAction,
		);
		ipcMain.removeListener(APPROVALS_CARD_DECIDE_CHANNEL, this.onDecideAction);
		this.releaseView(reason);
	}

	/**
	 * The sender pin, in one place. The card is trusted only when the event comes
	 * from THIS child's main frame and that frame is still the card document: no
	 * other renderer, no same-origin iframe, and no navigation away can act.
	 */
	private acceptAction(event: IpcMainEvent, payload: unknown): boolean {
		const view = this.view;
		if (!view || view.webContents.isDestroyed()) return false;
		if (event.sender !== view.webContents) {
			this.dropAction();
			return false;
		}
		if (
			!event.senderFrame ||
			event.senderFrame !== view.webContents.mainFrame
		) {
			this.dropAction();
			return false;
		}
		if (!this.sameDocument(event.senderFrame.url)) {
			this.dropAction();
			return false;
		}
		const seq =
			payload && typeof payload === "object"
				? (payload as { seq?: unknown }).seq
				: undefined;
		if (
			typeof seq !== "number" ||
			!Number.isInteger(seq) ||
			seq !== this.model?.seq
		) {
			this.dropAction();
			return false;
		}
		return true;
	}

	private isPendingEntry(entryId: unknown): entryId is string {
		return (
			typeof entryId === "string" &&
			Boolean(this.model?.pending.some((entry) => entry.entryId === entryId))
		);
	}

	private sameDocument(url: string): boolean {
		const strip = (value: string): string => value.split("?")[0].split("#")[0];
		try {
			return (
				strip(new URL(url).toString()) ===
				strip(new URL(this.documentUrl).toString())
			);
		} catch {
			return false;
		}
	}

	private dropAction(): void {
		this.actionCounts.dropped += 1;
		/*
		 * A dropped action is not silent to the operator: the model is rebuilt with
		 * the stale error and pushed, so the card states that the request moved on
		 * instead of leaving the click with no visible consequence (round-2 minor).
		 */
		this.actionError = "stale";
		if (this.model) {
			this.model = approvalsCardModelFrom({
				seq: ++this.modelSeq,
				entries: this.entries,
				locale: this.locale,
				dir: this.dir,
				theme: this.theme,
				palette: this.palette,
				requesterLabels: this.requesterLabels,
				view: this.model.view,
				focus: false,
				busy: this.model.busy,
				error: this.actionError,
				dismissed: this.dismissed,
			});
			this.remeasureAfterModelChange();
		}
	}

	/**
	 * A model change that ADDS A LINE must be measured again, not only pushed (D1).
	 *
	 * The stale/unavailable error is an inline line in the sticky footer. Pushing
	 * it alone grew the card's content by ~14.6 DIP inside a native view that kept
	 * its old height, so the card's own `max-height` clamp turned the extra line
	 * into a scrolling body and the sticky footer sat over "Don't allow" (measured
	 * 14.6 DIP hidden on the S6c head, with no re-measure). `measureAndShow`
	 * applies the model AND reads the painted height in ONE script (the read is a
	 * `setTimeout(0)` after the apply, so the error has painted), then
	 * `maybeShow` resizes the child through `applyBounds`: a height change is a
	 * plain `setBounds`, never a rebuild. Before the document is ready there is
	 * nothing to measure; the load's own `measureAndShow` carries the model.
	 */
	private remeasureAfterModelChange(): void {
		this.pushModel(false);
		if (this.ready) this.measureAndShow();
	}

	/** Close the card's current entry without deciding it. */
	private dismissEntry(entryId: string): void {
		this.dismissed.add(entryId);
		// The stale line belongs to the action that failed, not to the next card
		// this dismissal presents; setContext re-pushes `actionError`, so it must
		// be cleared here as well as in close (round-3 minor).
		this.actionError = null;
		if (!this.model) return;
		const model = approvalsCardModelFrom({
			seq: ++this.modelSeq,
			entries: this.entries,
			locale: this.locale,
			dir: this.dir,
			theme: this.theme,
			palette: this.palette,
			requesterLabels: this.requesterLabels,
			view: this.model.view,
			focus: false,
			busy: false,
			error: null,
			dismissed: this.dismissed,
		});
		this.model = model;
		this.pending = model.count;
		this.pushModel(false);
		if (!model.request) {
			this.explicitOpen = false;
			this.pendingFocus = false;
			this.hide();
		} else {
			this.maybeShow();
		}
		this.returnFocus();
		// The shield's aria-expanded/toggle must follow a dismissal, not only an
		// explicit open/close: otherwise the first press after Close/Escape is a
		// stale no-op (round-2 F1/U1).
		this.onChanged?.();
	}

	/**
	 * Answer one entry. The decision's MEANING is never taken from the card: it
	 * is the host's `respondToConsent`, which re-resolves the id against the live
	 * queue. A rejection is an inline error, never a success.
	 */
	private decide(entryId: string, decision: ApprovalsCardDecision): void {
		if (!this.respond) {
			this.showActionError();
			return;
		}
		try {
			const result = this.respond(entryId, decision);
			if (
				result &&
				typeof (result as PromiseLike<unknown>).then === "function"
			) {
				void (result as Promise<unknown>).catch(() => this.showActionError());
			}
		} catch {
			this.showActionError();
			return;
		}
		this.returnFocus();
	}

	private showActionError(): void {
		if (!this.model) return;
		this.model = { ...this.model, error: "unavailable", busy: false };
		// The same extra line as `dropAction`'s stale error (D1): re-measure.
		this.remeasureAfterModelChange();
	}

	/** Focus the card, only through the host's gated helper. */
	private focusIfPending(): void {
		if (
			!this.pendingFocus ||
			!this.explicitOpen ||
			!this.ready ||
			!this.visible
		) {
			return;
		}
		const view = this.view;
		if (!view || view.webContents.isDestroyed()) return;
		this.pendingFocus = false;
		this.focusTarget?.(view.webContents);
		this.pushModel(true);
	}

	/** Return the keyboard to the page (close/dismiss/decision). */
	private returnFocus(): void {
		this.pendingFocus = false;
		const page = this.pageWebContents?.();
		if (!page || page.isDestroyed()) return;
		this.focusTarget?.(page);
	}

	private ensureChild(): void {
		if (this.view || this.failedReason !== null || this.disposed) return;
		this.createChild();
	}

	private maybeShow(): void {
		if (
			this.disposed ||
			this.failedReason !== null ||
			this.pending <= 0 ||
			!this.layout.presented ||
			!this.layout.contentRect
		) {
			this.hide();
			return;
		}
		this.ensureChild();
		if (!this.view || !this.ready) return;
		this.applyBounds();
	}

	private applyBounds(): void {
		const view = this.view;
		if (!view || !this.layout.contentRect) return;
		const bounds = approvalsCardBoundsFor({
			contentRect: this.layout.contentRect,
			naturalHeight: this.naturalHeight,
			opaque: this.opaque,
			dir: this.dir,
		});
		this.bounds = bounds;
		if (!bounds) {
			this.hide();
			return;
		}
		try {
			const current = view.getBounds();
			/*
			 * Electron 44.3.0 propagates a HEIGHT change to the child's WebContents
			 * viewport but NOT a width change: measured on 44.3.0 (a 400-wide child
			 * moved to 300 still reads `innerWidth: 400`), while 200 -> 500 reads
			 * `innerHeight: 500`. So only a width change needs the fresh-child
			 * boundary — created at the new bounds before its document loads, so the
			 * viewport and the bottom anchor are the same size. Height is a plain
			 * `setBounds`, which is also what keeps a content-driven card from
			 * rebuild-looping on a fractional measured height.
			 */
			if (current.width !== bounds.view.width) {
				this.rebuildAt(bounds);
				return;
			}
			const grew = bounds.view.height > current.height;
			view.setBounds(bounds.view);
			if (grew) this.verifyViewportFollowed(view, bounds);
			/*
			 * Raise only when a page view has been appended since the last pass.
			 * Re-adding an already-topmost child is not free: it can move focus, and
			 * the auto-present path must leave the page's first responder alone.
			 */
			const children = this.window.contentView.children;
			if (children[children.length - 1] !== view) {
				this.window.contentView.addChildView(view);
			}
			view.setVisible(true);
			this.visible = true;
		} catch (error) {
			this.fail(`bounds_apply_failed:${String(error)}`);
		}
	}

	/**
	 * A height GROWTH must reach the document's VIEWPORT, not only the native view
	 * (D1).
	 *
	 * The card is bottom-pinned with `max-height: calc(100% - 16px)`, so if the
	 * child's `innerHeight` stays at the old value the card is clamped to it and
	 * the extra line (the stale/unavailable error) still scrolls the body under
	 * the sticky footer. Electron 44.3.0 is documented to propagate a height
	 * `setBounds` to the viewport, but the S6d probe measured a hidden-window
	 * child whose `innerHeight` stayed at 414 against a 436 DIP view across eight
	 * reads over 2 s, and again for +10/+30/+60/+200 DIP nudges. The viewport is
	 * therefore READ BACK after a short settle and, if it is SHORTER than the view
	 * (the only case where the card gets clamped), the child is rebuilt at the new
	 * bounds: the same fresh-child boundary a width change already uses, with the
	 * document loaded at its final size.
	 *
	 * Growth only, on purpose: a viewport taller than the view does not clamp the
	 * card, and rebuilding on every fractional height wobble made ordinary flows
	 * (an explicit open, a dismissal) tear the document down under a click. A
	 * rebuild lands the viewport on the new height, so the next pass sees it
	 * followed and this cannot loop. A non-numeric read (a stubbed or torn-down
	 * document) is ignored, never treated as a mismatch.
	 */
	private verifyViewportFollowed(
		view: WebContentsView,
		bounds: ApprovalsCardBounds,
	): void {
		setTimeout(() => {
			if (this.view !== view || view.webContents.isDestroyed()) return;
			void view.webContents
				.executeJavaScript("window.innerHeight")
				.then((innerHeight: unknown) => {
					if (this.view !== view || this.disposed) return;
					if (
						typeof innerHeight !== "number" ||
						!Number.isFinite(innerHeight) ||
						innerHeight <= 0 ||
						innerHeight >= bounds.view.height - 1
					) {
						return;
					}
					this.rebuildAt(bounds);
				})
				.catch(() => {
					// A document mid-navigation answers on its next load.
				});
		}, 100);
	}

	private rebuildAt(bounds: ApprovalsCardBounds): void {
		this.releaseView("resize");
		this.visible = false;
		this.ready = false;
		this.bounds = bounds;
		this.createChild();
		const view = this.view;
		if (!view) return;
		// The replacement document must be laid out at the same bounds it will be
		// shown at, not the old 264-wide viewport.
		view.setBounds(bounds.view);
		view.setVisible(true);
		this.visible = true;
	}

	private releaseView(reason: string): void {
		const view = this.view;
		this.view = null;
		for (const remove of this.childListeners.splice(0)) remove();
		if (!view) return;
		try {
			if (!view.webContents.isDestroyed()) view.webContents.close();
		} catch {
			// Already closing.
		}
		try {
			this.window.contentView.removeChildView(view);
		} catch {
			// The window may be closing; nothing to detach from.
		}
		this.log(`[browser] approvals overlay child released: ${reason}`);
	}

	private createChild(): void {
		let view: WebContentsView;
		try {
			const partition = `approvals-overlay-${randomUUID()}`;
			const childSession = session.fromPartition(partition);
			childSession.setPermissionRequestHandler(
				(_contents, _permission, callback) => callback(false),
			);
			childSession.setPermissionCheckHandler(() => false);
			childSession.on("will-download", (event) => {
				event.preventDefault();
			});
			view = new WebContentsView({
				webPreferences: {
					partition,
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false,
					webSecurity: true,
					allowRunningInsecureContent: false,
					// S6b's bridge: the two card verbs only. S6a's probe passes no
					// preload, so the inert document remains exactly as reviewed.
					...(this.preloadPath ? { preload: this.preloadPath } : {}),
					javascript: true,
					backgroundThrottling: false,
				},
			});
			view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
			const allow = approvalsDocumentUrl(
				this.documentUrl,
				this.pending,
				this.theme,
				this.opaque,
			);
			const base = (() => {
				try {
					const url = new URL(allow);
					url.search = "";
					return url.toString();
				} catch {
					return allow;
				}
			})();
			view.webContents.on("will-navigate", (event, url) => {
				const target = url.split("?")[0];
				if (target !== base) event.preventDefault();
			});
			view.webContents.on("will-redirect", (event, url) => {
				const target = url.split("?")[0];
				if (target !== base) event.preventDefault();
			});
			view.setBackgroundColor(this.opaque ? OPAQUE : TRANSPARENT);
			this.window.contentView.addChildView(view);
			// A replacement is created at the bounds it will occupy BEFORE its
			// document loads; `setBounds` after load leaves the WebContents viewport
			// at zero (measured on Electron 44.3.0).
			const initial = this.bounds?.view ?? {
				x: 0,
				y: 0,
				width: 0,
				height: 0,
			};
			view.setBounds(initial);
			view.setVisible(this.bounds !== null);
			this.view = view;
			this.ready = false;
			const onFinish = () => {
				this.ready = true;
				this.measureAndShow();
			};
			const onFail = (
				_event: Electron.Event,
				code: number,
				description: string,
			) => {
				this.fail(`load_failed:${code}:${description}`);
			};
			/*
			 * A CHILD THAT DIES AFTER CONSTRUCTION IS A FAILED CARD, not a hidden one.
			 * `render-process-gone` (crash, OOM, kill) leaves a blank native view over
			 * the page that nothing would ever repaint; latching the controller off
			 * disposes it, and `fail` pushes the projection so the renderer sees
			 * `approvalsCard.available: false` and falls back to the dock and band
			 * instead of waiting on a card that can no longer be answered (S6d, M1).
			 */
			const onGone = (_event: Electron.Event, details: { reason?: string }) => {
				this.fail(`render_process_gone:${details?.reason ?? "unknown"}`);
			};
			view.webContents.on("did-finish-load", onFinish);
			view.webContents.on("did-fail-load", onFail);
			view.webContents.on("render-process-gone", onGone);
			this.childListeners.push(() =>
				view.webContents.removeListener("render-process-gone", onGone),
			);
			this.childListeners.push(() =>
				view.webContents.removeListener("did-finish-load", onFinish),
			);
			this.childListeners.push(() =>
				view.webContents.removeListener("did-fail-load", onFail),
			);
			void view.webContents.loadURL(allow).catch((error: unknown) => {
				this.fail(`load_rejected:${String(error)}`);
			});
		} catch (error) {
			this.fail(`child_create_failed:${String(error)}`);
			return;
		}
	}

	private measureAndShow(): void {
		const view = this.view;
		if (!view || view.webContents.isDestroyed()) return;
		/*
		 * THE MODEL AND THE READ ARE ONE SCRIPT. Two separate
		 * `executeJavaScript` calls are not ordered by contract; under load the
		 * read could land first and measure the empty 96 DIP card, which then
		 * stayed at that height until the next push (measured in the round-3
		 * probe). Applying the model in the same task removes the race.
		 */
		const payload = this.modelPayload(false);
		if (!payload) return;
		/*
		 * A measurement with no width is not the card's height: at 0 DIP the
		 * text wraps word by word and reports ~150 DIP, which is neither the
		 * rendered card nor a usable input to the formula. The child is created
		 * at zero bounds only until the first show, and `applyBounds` rebuilds
		 * it at its real bounds before that replacement document loads — so the
		 * first trustworthy measurement is the one taken there.
		 */
		if (view.getBounds().width <= 0) {
			// A provisional zero-width child still needs the model for the moment it
			// is rebuilt at real bounds; the combined read below waits for a width.
			void view.webContents
				.executeJavaScript(`window.__approvalsCard?.setModel(${payload})`)
				.catch(() => {});
			this.maybeShow();
			return;
		}
		/*
		 * Wait for the card's own layout before reading it. `did-finish-load` can
		 * fire while the external stylesheet is still applying; an early read once
		 * measured the unstyled block at 293 px and then clipped the settled card.
		 */
		const measured = view.webContents.executeJavaScript(
			`new Promise((resolve) => {
				window.__approvalsCard?.setModel(${payload});
				const read = () => {
					const el = document.getElementById('approvals-card');
					if (!el) { resolve(0); return; }
					/*
					 * Read the UNCLAMPED height. The card's own max-height is the
					 * viewport minus its insets, so measuring the clamped box would
					 * return the provisional 96 DIP view's ceiling forever: a
					 * circular size that never reaches the card's real height.
					 */
					const previous = el.style.maxHeight;
					el.style.maxHeight = 'none';
					const height = el.getBoundingClientRect().height;
					el.style.maxHeight = previous;
					resolve(height);
				};
				/*
				 * A timer, not requestAnimationFrame: the probe's window is HIDDEN,
				 * and an occluded window does not run animation frames, so an rAF
				 * gate never fires and the measurement falls to the 1500ms zero.
				 * setModel ran in this same task, so the next task reads the
				 * painted model.
				 */
				const afterPaint = () => setTimeout(read, 0);
				if (document.readyState === 'complete') afterPaint();
				else addEventListener('load', afterPaint, { once: true });
			})`,
		);
		const timer = new Promise<number>((resolve) => {
			setTimeout(() => resolve(0), 1500);
		});
		void Promise.race([measured, timer])
			.then((height: unknown) => {
				/*
				 * A rebuild replaces the child while its measurement may still be
				 * in flight; that measurement describes a document this controller
				 * no longer shows, and must not resize the new one.
				 */
				if (this.view !== view) return;
				if (
					typeof height === "number" &&
					Number.isFinite(height) &&
					height > 0
				) {
					this.naturalHeight = height;
				}
				this.maybeShow();
				this.focusIfPending();
			})
			.catch((error: unknown) => {
				// Closing a superseded child rejects its pending `executeJavaScript`;
				// that is the rebuild's own teardown, not a load failure.
				if (this.view !== view) return;
				this.fail(`measure_failed:${String(error)}`);
			});
		this.maybeShow();
	}

	/**
	 * Push the model into the card document. S6a proved this seam for the count;
	 * S6b sends the whole sanitized model through it, so no third channel exists
	 * in the card direction. Every push carries the current `seq`; the document
	 * echoes it on its next action.
	 */
	/** Serialize the next model, applying the controller's current context. */
	private modelPayload(focus: boolean): string | null {
		if (!this.model) return null;
		const model: ApprovalsCardModel = {
			...this.model,
			locale: this.locale,
			dir: this.dir,
			theme: this.theme,
			palette: this.palette,
			focus: focus === true,
		};
		this.model = model;
		if (focus) this.pendingFocus = false;
		return JSON.stringify(model);
	}

	private pushModel(focus: boolean): void {
		const view = this.view;
		const payload = this.modelPayload(focus);
		if (!view || !payload || view.webContents.isDestroyed()) return;
		void view.webContents
			.executeJavaScript(`window.__approvalsCard?.setModel(${payload})`)
			.catch(() => {
				// A document between loads keeps the previous model; the next ready
				// push (and the next open) carries the current one.
			});
	}

	private hide(): void {
		if (this.view) {
			try {
				this.view.setVisible(false);
			} catch {
				// Already gone.
			}
		}
		this.visible = false;
	}

	private fail(reason: string): void {
		if (this.failedReason !== null) return;
		this.failedReason = reason;
		this.hide();
		// A latched-off child is a closed document, not a hidden one waiting to be
		// retried. Keeping it alive would leave a second webContents attached after
		// its own load already failed.
		this.dispose("failed");
		this.log(`[browser] approvals overlay latched off: ${reason}`);
		/*
		 * TELL THE RENDERER. `state().available` just became false, but the chrome
		 * projection only changes when something pushes it; without this a failure
		 * after construction left the toolbar and the (unmounted) dock route
		 * believing the card still existed until the next unrelated projection tick
		 * (S6d, M1). The shield's `open` is also now false, so the push is what
		 * returns the Approvals control to the dock/dialog route.
		 */
		if (!this.constructing) this.onChanged?.();
	}
}
