import type { TabRecord } from "./registry";

export const PAGE_ZOOM_STEPS = [
	0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
	5,
] as const;
export type PageZoomCommand = "in" | "out" | "reset";
export interface PageFindState {
	tabId: number;
	query: string;
	ordinal: number;
	matches: number;
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
	constructor(private changed: () => void) {}

	reconcile(active: TabRecord | null): void {
		if (
			this.record &&
			(active !== this.record ||
				!active.presented ||
				active.documentEpoch !== this.epoch ||
				active.view.webContents.isDestroyed())
		)
			this.clear();
	}
	state(active: TabRecord | null) {
		this.reconcile(active);
		if (active?.tabId !== this.noticeTabId || !active?.presented)
			this.notice = null;
		return {
			find: this.find ? { ...this.find } : null,
			zoom: active?.view.webContents.getZoomFactor?.() ?? 1,
			zoomAllowed: active?.owner === "user" && !active.handedTo,
			notice: this.notice,
		};
	}
	clear(): void {
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
		if (!active.presented) return;
		if (this.record === active) return;
		this.clear();
		this.record = active;
		this.epoch = active.documentEpoch;
		this.find = { tabId: active.tabId, query: "", ordinal: 0, matches: 0 };
		this.listener = ((
			_event: unknown,
			result: {
				requestId: number;
				activeMatchOrdinal: number;
				matches: number;
			},
		) => {
			if (
				this.record !== active ||
				!active.presented ||
				active.documentEpoch !== this.epoch ||
				result.requestId !== this.requestId ||
				!this.find
			)
				return;
			this.find = {
				...this.find,
				ordinal: result.activeMatchOrdinal,
				matches: result.matches,
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
		const same = this.find.query === query;
		this.requestId = null;
		this.find = {
			...this.find,
			query,
			...(same ? {} : { ordinal: 0, matches: 0 }),
		};
		if (!query) {
			active.view.webContents.stopFindInPage?.("clearSelection");
			return;
		}
		this.requestId =
			active.view.webContents.findInPage?.(query, {
				forward,
				findNext: same && next,
			}) ?? null;
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
