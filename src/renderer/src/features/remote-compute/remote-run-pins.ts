/**
 * Which runs a conversation started, so a card can be drawn under it.
 *
 * WHY THIS IS CLIENT STATE AND NOT THE SERVER'S. A run is a record on the provider's
 * side; it carries the prompt, the directory and the network, and nothing that says
 * which conversation asked for it (`POST …/runs` takes no session id). The
 * association therefore exists only in the window that made the request, which is
 * also why it is NOT persisted: after a reload the runs are still running, but this
 * app would be guessing which conversation to file them under - and a card under the
 * wrong conversation is a claim about whose work is spending money.
 *
 * THE RUNS LIST IS THE RECOVERY PATH, deliberately: a window that reloaded shows
 * every run the server holds in `RemoteRunsDialog`, so nothing is lost - it is only
 * unattributed, which is the truth.
 *
 * THE KEY IS THE PANE'S IDENTITY, the same one the composer uses (`panelIdentityFor`:
 * the session id, or the draft key before a session exists).
 */

import { create } from "zustand";

type RemoteRunPins = {
	/** Run ids, oldest first, keyed by the pane that submitted them. */
	pins: Record<string, string[]>;
	pin: (paneKey: string, runId: string) => void;
	forget: (paneKey: string, runId: string) => void;
};

export const useRemoteRunPins = create<RemoteRunPins>((set) => ({
	pins: {},
	pin: (paneKey, runId) =>
		set((state) => {
			const existing = state.pins[paneKey] ?? [];
			if (existing.includes(runId)) return state;
			return { pins: { ...state.pins, [paneKey]: [...existing, runId] } };
		}),
	forget: (paneKey, runId) =>
		set((state) => {
			const existing = state.pins[paneKey];
			if (!existing) return state;
			const next = existing.filter((id) => id !== runId);
			const pins = { ...state.pins };
			if (next.length > 0) pins[paneKey] = next;
			else delete pins[paneKey];
			return { pins };
		}),
}));
