/**
 * S6a: the approvals card's inert native child.
 *
 * WHY A NATIVE CHILD, in one sentence: the page is a `WebContentsView` painted
 * above the app's DOM, so any card that must be visible without moving or
 * hiding that page has to be another native child added above it. This module
 * is the smallest honest version of that surface: it creates one child, gives it
 * the geometry owned by `approvals-overlay-bounds.ts`, presents it when the
 * live queue is non-empty, and never focuses it.
 *
 * WHAT S6a DELIBERATELY DOES NOT HAVE: a preload, an IPC channel, a focus call,
 * a dismiss path, a decision path, or a renderer-side pause registration. The
 * document is inert and auto-presented; the app's existing shield is the live
 * count. That split is the point of the slice: transparency, ring/hit
 * behaviour, native capture and lifecycle are proven before a second
 * scriptable document is allowed near the trust boundary. S6b replaces the
 * static document with a purpose-built, sandboxed, IPC-speaking card.
 *
 * AUTOPRESENT IS UNFOCUSED. `setShow`/`setVisible` never call
 * `webContents.focus()`: the page keeps typing, the card does not steal the
 * first responder, and the operator's only recall affordance remains the
 * shield (and, for S6a, the card is a visible experiment, not a product claim).
 *
 * LIFETIME: one lazy child per host window; hidden rather than destroyed when
 * the queue empties or the page stops being presented. A tab switch with an
 * unchanged content rect does not hide it; a resize reapplies the same formula.
 * A load failure or crash latches off, so a broken document cannot restart
 * forever.
 */

import { randomUUID } from "node:crypto";
import {
	type BrowserWindow,
	WebContentsView,
	nativeTheme,
	session,
	webContents,
} from "electron";
import {
	APPROVALS_CARD_MIN_HEIGHT,
	type ApprovalsCardBounds,
	type ApprovalsCardRect,
	approvalsCardBoundsFor,
} from "./approvals-overlay-bounds";

export interface ApprovalsOverlayLayout {
	activeTabId: number | null;
	presented: boolean;
	contentRect: ApprovalsCardRect | null;
	revision: number;
}

export interface ApprovalsOverlayFacts {
	pending: number;
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
	/** Windows/Linux fallback: opaque card, no transparent ring. */
	opaque?: boolean;
	/** Optional evidence override; production follows the system theme. */
	theme?: "light" | "dark";
	log?: (message: string) => void;
}

/** The exact opt-in for S6a. Absent or not exactly `1` is off. */
export const APPROVALS_OVERLAY_S6A_ENV =
	"LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_S6A";

const TRANSPARENT = "#00000000";
const OPAQUE = "#1b1f24";

function documentFor(
	documentUrl: string,
	count: number,
	theme: "light" | "dark",
	opaque: boolean,
): string {
	try {
		const url = new URL(documentUrl);
		url.searchParams.set("count", String(count));
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
	private readonly opaque: boolean;
	private readonly theme: "light" | "dark";
	private readonly log: (message: string) => void;

	private view: WebContentsView | null;
	private childListeners: Array<() => void>;
	private pending: number;
	private ready: boolean;
	private visible: boolean;
	private failedReason: string | null;
	private disposed: boolean;
	private naturalHeight: number;
	private layout: ApprovalsOverlayLayout;
	private bounds: ApprovalsCardBounds | null;

	constructor(deps: ApprovalsOverlayDeps) {
		this.window = deps.window;
		this.documentUrl = deps.documentUrl;
		this.opaque = deps.opaque === true;
		this.theme =
			deps.theme ?? (nativeTheme.shouldUseDarkColors ? "dark" : "light");
		this.log = deps.log ?? (() => {});
		this.view = null;
		this.childListeners = [];
		this.pending = 0;
		this.ready = false;
		this.visible = false;
		this.failedReason = null;
		this.disposed = false;
		this.naturalHeight = APPROVALS_CARD_MIN_HEIGHT;
		this.layout = {
			activeTabId: null,
			presented: false,
			contentRect: null,
			revision: 0,
		};
		this.bounds = null;
		/*
		 * ATTACH THE CHILD BEFORE THE PAGE IS FOCUSED, not when the first request
		 * arrives. A native child attached while the window already owns a focused
		 * page can become first responder even when it is hidden; attaching at host
		 * construction (before any page exists) keeps the auto-present path from
		 * moving focus when the card is later shown. The document is inert, so the
		 * warm load costs one hidden view and no operator-visible pixels.
		 */
		this.ensureChild();
	}

	/** The live queue's count. Zero hides; a positive count auto-presents. */
	setPending(count: number): void {
		if (this.disposed) return;
		this.pending = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
		if (this.pending === 0) {
			this.hide();
			return;
		}
		this.updateCount();
		this.maybeShow();
	}

	/** The registry's copied layout snapshot, after every page layout pass. */
	onLayout(snapshot: ApprovalsOverlayLayout): void {
		if (this.disposed) return;
		this.layout = {
			activeTabId: snapshot.activeTabId,
			presented: snapshot.presented,
			contentRect: snapshot.contentRect ? { ...snapshot.contentRect } : null,
			revision: snapshot.revision,
		};
		if (!snapshot.presented || !snapshot.contentRect) {
			this.hide();
			return;
		}
		if (this.pending > 0) this.maybeShow();
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

	dispose(reason = "dispose"): void {
		if (this.disposed) return;
		this.disposed = true;
		this.visible = false;
		this.ready = false;
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
		});
		this.bounds = bounds;
		if (!bounds) {
			this.hide();
			return;
		}
		try {
			view.setBounds(bounds.view);
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
					// The document's own module measures itself and paints the count;
					// there is still no preload, no exposed IPC and no focus path.
					javascript: true,
					backgroundThrottling: false,
				},
			});
			view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
			const allow = documentFor(
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
			view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
			view.setVisible(false);
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
			view.webContents.on("did-finish-load", onFinish);
			view.webContents.on("did-fail-load", onFail);
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
		 * Wait for the card's own layout before reading it. `did-finish-load` can
		 * fire while the external stylesheet is still applying; an early read once
		 * measured the unstyled block at 293 px and then clipped the settled card.
		 */
		const measured = view.webContents.executeJavaScript(
			`new Promise((resolve) => {
				const read = () => {
					const el = document.getElementById('approvals-card');
					resolve(el ? el.getBoundingClientRect().height : 0);
				};
				if (document.readyState === 'complete') {
					requestAnimationFrame(() => requestAnimationFrame(read));
				} else {
					addEventListener('load', () => requestAnimationFrame(() => requestAnimationFrame(read)), { once: true });
				}
			})`,
		);
		const timer = new Promise<number>((resolve) => {
			setTimeout(() => resolve(0), 1500);
		});
		void Promise.race([measured, timer])
			.then((height: unknown) => {
				if (
					typeof height === "number" &&
					Number.isFinite(height) &&
					height > 0
				) {
					this.naturalHeight = height;
				}
				this.maybeShow();
			})
			.catch((error: unknown) => {
				this.fail(`measure_failed:${String(error)}`);
			});
		this.updateCount();
		this.maybeShow();
	}

	private updateCount(): void {
		const view = this.view;
		if (!view || view.webContents.isDestroyed()) return;
		void view.webContents
			.executeJavaScript(
				`(() => { const el = document.getElementById('approvals-count'); if (!el) return; const n = ${this.pending}; el.textContent = n === 1 ? "1 approval waiting" : n + " approvals waiting"; })()`,
			)
			.catch(() => {
				// The inert document is allowed to be between loads; the next measure
				// or show carries the current count.
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
		this.log(`[browser] approvals overlay latched off: ${reason}`);
	}
}
