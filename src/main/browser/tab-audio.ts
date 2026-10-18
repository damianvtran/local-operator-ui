import type { DriveableWebContents } from "./electron-types";

/** The structural minimum this tracker needs of a tab: its id and its
 * webContents. Structural rather than `TabRecord` so the tracker stays
 * testable with a fake view and never imports the registry it serves. */
export interface AudioTab {
	tabId: number;
	view: { webContents: DriveableWebContents };
}

export interface TabAudioState {
	/** The page is producing sound right now (Electron `isCurrentlyAudible`,
	 * kept current by the `audio-state-changed` event). */
	audible: boolean;
	/** The user has muted this tab (Electron `isAudioMuted`). */
	muted: boolean;
}

/**
 * Per-tab audio state for the tab strip's mute control (LOH-13 slice C).
 *
 * WHY THIS IS MAIN-OWNED STATE AND NOT A RENDERER READ: a background tab's
 * only legible surface is the strip, and the strip renders a PROJECTION
 * (`host.ts`'s `chromeState`), the same rule that made `loading` per-tab.
 * Audibility changes without any navigation or IPC traffic, so a projection
 * that only read `isCurrentlyAudible()` when something else changed would
 * show a mute button late or never; the `audio-state-changed` event is what
 * pushes `changed`, and the live reads seed the state when tracking starts.
 *
 * WHY IT IS A HUMAN CONTROL ONLY: muting is the person silencing a page they
 * can hear. It is deliberately absent from the agent protocol and the RPC
 * surface — an agent that could mute a tab could hide its own audio from the
 * user, and no tool result needs it. The renderer reaches it through the
 * sender-authorized tab-action IPC, like duplicate/reload.
 *
 * ONE LISTENER PER TAB, dropped with the tab: `prune` is called from the
 * projection with the live tab ids, so a closed tab cannot leak a listener
 * onto a destroyed webContents or resurrect state for a recycled id.
 */
export class TabAudioTracker {
	private readonly states = new Map<number, TabAudioState>();
	private readonly listeners = new Map<
		number,
		{ wc: DriveableWebContents; listener: (...args: never[]) => void }
	>();

	constructor(private readonly changed: () => void) {}

	/** Start tracking one tab (idempotent) and return its current state. The
	 * muted flag is re-read live on every call: `setAudioMuted` is also
	 * reachable from the page's own media controls in principle, and a stale
	 * cached flag would render a button that claims the opposite of the
	 * page's actual state. */
	stateFor(tab: AudioTab): TabAudioState {
		this.track(tab);
		const state = this.states.get(tab.tabId) ?? {
			audible: false,
			muted: false,
		};
		const wc = tab.view.webContents;
		if (!wc.isDestroyed()) state.muted = wc.isAudioMuted?.() ?? state.muted;
		return { ...state };
	}

	/** Mute or unmute one tab. Returns the resulting state, or null when the
	 * webContents is already gone — the caller (a human press) then reports
	 * the tab as closed rather than claiming a mute that never landed. */
	setMuted(tab: AudioTab, muted: boolean): TabAudioState | null {
		const wc = tab.view.webContents;
		if (wc.isDestroyed()) return null;
		this.track(tab);
		wc.setAudioMuted?.(muted);
		const state = this.stateFor(tab);
		state.muted = wc.isAudioMuted?.() ?? muted;
		this.states.set(tab.tabId, state);
		this.changed();
		return { ...state };
	}

	/** Drop tracking for every tab not in `liveTabIds`. Called from the
	 * projection, which is the one place main already enumerates the live
	 * set on every change. */
	prune(liveTabIds: ReadonlySet<number>): void {
		for (const [tabId, entry] of this.listeners) {
			if (liveTabIds.has(tabId)) continue;
			this.listeners.delete(tabId);
			this.states.delete(tabId);
			// Removing a listener from a destroyed contents throws in Electron,
			// so the removal is guarded: a live one is detached properly, a dead
			// one can never fire again and is simply dropped.
			if (!entry.wc.isDestroyed())
				entry.wc.removeListener("audio-state-changed", entry.listener);
		}
	}

	private track(tab: AudioTab): void {
		if (this.listeners.has(tab.tabId)) return;
		const wc = tab.view.webContents;
		this.states.set(tab.tabId, {
			audible: wc.isDestroyed() ? false : (wc.isCurrentlyAudible?.() ?? false),
			muted: wc.isDestroyed() ? false : (wc.isAudioMuted?.() ?? false),
		});
		// ELECTRON 44.3.0 DELIVERS THE PARAMS ON THE EVENT ITSELF, AS THE FIRST
		// AND ONLY ARGUMENT (electron.d.ts:16120, and
		// `WebContentsAudioStateChangedEventParams = { audible: boolean }` at
		// :24316): `listener: (event: Event<WebContentsAudioStateChangedEventParams>)
		// => void`, so `event.audible` is the flag. The earlier two-argument read
		// (`(_event, params) => params?.audible`) was wrong for this Electron: the
		// second argument is undefined, every event wrote `audible: false`, and a
		// tab that began silent and later played never showed the mute control.
		// QA reached the same conclusion from the live app
		// (`argCount:1, arg0={audible:true}, arg1:ABSENT`). Reading the first
		// argument is the fix; `stateFor`'s live re-read is the belt to this
		// braces.
		const listener = ((event: { audible?: boolean }) => {
			const current = this.states.get(tab.tabId);
			if (!current) return;
			current.audible = event?.audible ?? false;
			this.states.set(tab.tabId, current);
			this.changed();
		}) as (...args: never[]) => void;
		this.listeners.set(tab.tabId, { wc, listener });
		if (!wc.isDestroyed()) wc.on("audio-state-changed", listener);
	}
}
