import type { TabRecord } from "./registry";

export const PAGE_ZOOM_STEPS = [
	0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
	5,
] as const;
export type PageZoomCommand = "in" | "out" | "reset";
/** Electron's print failure wording for the person cancelling their own
 * dialog ("Print job canceled" and platform variants): a cancellation is
 * the human changing their mind, not a failure to report. */
const PRINT_CANCELLED = /cancel/i;
export interface PageFindState {
	tabId: number;
	query: string;
	ordinal: number;
	matches: number;
	pending: boolean;
	unreported: boolean;
}

/** Human-only native page controls. No protocol/action entry points: the owning
 * desktop renderer reaches these through sender-authorized IPC. Find belongs to
 * one PRESENTED document, not a renderer-local tab id. Both the request id and
 * document epoch fence late Electron results; a switch/hide tears the listener
 * down before stopFindInPage can emit. Nothing injects a preload or page script.
 *
 * Electron's find highlights are composited page overlays, so agent operations
 * clear them in the tab's existing serial lane before reads/screenshots. Human
 * IPC uses that SAME lane: a new search cannot race an agent capture. */
export class PageControls {
	private find: PageFindState | null = null;
	private record: TabRecord | null = null;
	private epoch = -1;
	private requestId: number | null = null;
	private listener: ((...args: never[]) => void) | null = null;
	private notice: string | null = null;
	private noticeTabId: number | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	constructor(
		private changed: () => void,
		private resultTimeoutMs = 5000,
		/**
		 * "Hidden by our own overlay" is not "not presented" (QA Q2-F1): a menu
		 * pauses the native view so DOM can be seen, while the page itself is still
		 * the active, laid-out document. Without this, opening the ⋯ menu makes Find
		 * and Print no-ops and leaves Reset zoom reporting 1.25 — the chrome's own
		 * pause breaking the chrome's own controls.
		 */
		private hiddenByOverlay: (tabId: number) => boolean = () => false,
	) {}
	/** A presented page, or the same page waiting under an app overlay. */
	private shown(active: TabRecord): boolean {
		return active.presented || this.hiddenByOverlay(active.tabId);
	}
	private stopTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	reconcile(active: TabRecord | null): void {
		if (
			this.record &&
			(active !== this.record ||
				!this.shown(active) ||
				active.documentEpoch !== this.epoch ||
				active.view.webContents.isDestroyed())
		)
			this.clear();
	}
	state(active: TabRecord | null) {
		this.reconcile(active);
		if (active?.tabId !== this.noticeTabId || !active || !this.shown(active))
			this.notice = null;
		return {
			find: this.find ? { ...this.find } : null,
			zoom: active?.view.webContents.getZoomFactor?.() ?? 1,
			zoomAllowed: active?.owner === "user" && !active.handedTo,
			notice: this.notice,
		};
	}
	clear(): void {
		this.stopTimer();
		const old = this.record;
		const listener = this.listener;
		this.record = null;
		this.find = null;
		this.requestId = null;
		this.listener = null;
		if (old && listener)
			old.view.webContents.removeListener("found-in-page", listener);
		if (old && !old.view.webContents.isDestroyed())
			old.view.webContents.stopFindInPage?.("clearSelection");
	}
	open(active: TabRecord): void {
		this.reconcile(active);
		if (!this.shown(active)) return;
		if (this.record === active) return;
		this.clear();
		this.record = active;
		this.epoch = active.documentEpoch;
		this.find = {
			tabId: active.tabId,
			query: "",
			ordinal: 0,
			matches: 0,
			pending: false,
			unreported: false,
		};
		this.listener = ((
			_event: unknown,
			result: {
				requestId: number;
				activeMatchOrdinal: number;
				matches: number;
				finalUpdate?: boolean;
			},
		) => {
			if (
				this.record !== active ||
				!this.shown(active) ||
				active.documentEpoch !== this.epoch ||
				result.requestId !== this.requestId ||
				!this.find
			)
				return;
			if (result.finalUpdate !== false) this.stopTimer();
			this.find = {
				...this.find,
				unreported: false,
				ordinal: result.activeMatchOrdinal,
				matches: result.matches,
				pending: result.finalUpdate === false,
			};
			this.changed();
		}) as (...args: never[]) => void;
		active.view.webContents.on("found-in-page", this.listener);
	}
	search(
		active: TabRecord,
		query: string,
		forward: boolean,
		next: boolean,
	): void {
		this.open(active);
		if (!this.find || this.record !== active) return;
		this.stopTimer();
		const same = this.find.query === query;
		// After stop/timeout there is no native search to advance. Enter retries
		// the query from scratch rather than continuing a dead native session.
		const continuing =
			same && next && this.requestId !== null && !this.find.unreported;
		this.requestId = null;
		this.find = {
			...this.find,
			query,
			pending: query.length > 0,
			unreported: false,
			...(same ? {} : { ordinal: 0, matches: 0 }),
		};
		if (!query) {
			active.view.webContents.stopFindInPage?.("clearSelection");
			return;
		}
		this.requestId =
			active.view.webContents.findInPage?.(query, {
				forward,
				// Electron's misleading name means NEW SESSION (44.3 native maps
				// it to options->new_session), not "advance". Initial/changed/retry
				// must be true; an existing query's next/previous must be false.
				findNext: !continuing,
			}) ?? null;
		// Native search may never report (measured in hidden Electron). Bound the
		// progress claim; silence is not "no matches". Fencing/stop-before-notify
		// also makes a late result after timeout harmless. A new query retries.
		const request = this.requestId;
		this.timer = setTimeout(() => {
			this.timer = null;
			if (
				this.record !== active ||
				!this.shown(active) ||
				active.documentEpoch !== this.epoch ||
				this.requestId !== request ||
				!this.find
			)
				return;
			this.requestId = null;
			if (active.view.webContents.isDestroyed()) {
				this.clear();
				this.changed();
				return;
			}
			active.view.webContents.stopFindInPage?.("clearSelection");
			this.find = {
				...this.find,
				pending: false,
				unreported: true,
				ordinal: 0,
				matches: 0,
			};
			this.changed();
		}, this.resultTimeoutMs);
		this.timer.unref?.();
	}
	zoom(active: TabRecord, command: PageZoomCommand): void {
		if (active.owner !== "user" || active.handedTo) {
			this.notice = "Zoom is off for tabs an agent is driving";
			this.noticeTabId = active.tabId;
			return;
		}
		this.notice = null;
		const current = active.view.webContents.getZoomFactor?.() ?? 1;
		const factor =
			command === "reset"
				? 1
				: command === "in"
					? (PAGE_ZOOM_STEPS.find((step) => step > current + 0.001) ?? 5)
					: ([...PAGE_ZOOM_STEPS]
							.reverse()
							.find((step) => step < current - 0.001) ?? 0.25);
		active.view.webContents.setZoomFactor?.(factor);
	}
	/** Print the presented page (LOH-13 slice C).
	 *
	 * HUMAN-ONLY, like everything in this class: it travels the sender-
	 * authorized page-control IPC and the tab's serial lane, never the agent
	 * protocol — an agent that needs a page as a document already has the
	 * PDF/screenshot actions, and silently sending a page to a physical
	 * printer is not a capability a tool call should hold.
	 *
	 * `silent: false` is the load-bearing option: Electron's silent mode
	 * prints to the default printer with default settings and NO dialog,
	 * which for a human press would be a side effect they never confirmed.
	 * The dialog is the consent. A failure the dialog itself reports
	 * (cancelled is the person changing their mind, not a failure) only
	 * surfaces through `notice` when Electron names a real reason. */
	print(active: TabRecord): void {
		if (!this.shown(active)) return;
		const wc = active.view.webContents;
		if (wc.isDestroyed() || !wc.print) {
			// A MAIN-SIDE LITERAL, DELIBERATELY (LOH-13 slice C, review minor 2).
			// These notices follow the class the zoom notice above already
			// establishes: this class is main-only native page chrome with no
			// renderer/catalogue surface of its own, and the notice band renders
			// whatever string it is handed. Keying these two alone would give
			// this one file a second way of producing a user-visible sentence
			// beside the literal the zoom notice already uses — the defect the
			// repo's own convention names. If the notice band is ever moved onto
			// the catalogue, all of this file's sentences move together.
			this.notice = "Printing is not available for this page";
			this.noticeTabId = active.tabId;
			return;
		}
		this.notice = null;
		wc.print({ silent: false, printBackground: false }, (success, reason) => {
			if (success || !reason || PRINT_CANCELLED.test(reason)) return;
			this.notice = `Printing failed: ${reason}`;
			this.noticeTabId = active.tabId;
			this.changed();
		});
	}
	/** Call BEFORE a capability transfer. Isolated per-WebContents zoom means
	 * resetting this tab cannot alter another tab at the same origin. */
	prepareAgent(record: TabRecord): void {
		const changed =
			this.record === record ||
			(record.view.webContents.getZoomFactor?.() ?? 1) !== 1;
		if (this.record === record) this.clear();
		record.view.webContents.setZoomFactor?.(1);
		if (changed) this.changed();
	}
}
