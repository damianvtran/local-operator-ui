import { create } from "zustand";
import type { HubItemKind, HubNote } from "./hub-updates";

/**
 * What the hub controls remember between presses, in ONE place.
 *
 * WHY A STORE AND NOT PER-HOOK STATE (agent review round 1, R6/R7). The sidebar
 * and the detail pane each held their own `useHubActions()` state, so a press in
 * one left the other's button idle for the same item (a double merge was
 * possible) and a failure sentence appeared only where the press happened.
 * `pending`, `notes` and `rollups` describe the ITEM and the SECTION, not the
 * component that pressed, so they live where every consumer reads the same value.
 *
 * NOTES EXPIRE. A sentence beside a control is an answer to a press, not a state
 * of the item (the mark carries that), so it clears on the next press on the key,
 * on the next success, when the item leaves the backend's list
 * (`pruneNotes`), and after a TTL. It used to stay for the life of the sidebar,
 * red, under a row that had long since resolved.
 */

/** Info answers are read once; an error is the one thing worth keeping a little longer. */
export const HUB_NOTE_TTL_MS = { info: 15_000, error: 45_000 } as const;
export const HUB_ROLLUP_TTL_MS = 30_000;

type HubActionState = {
	pending: ReadonlySet<string>;
	notes: Readonly<Record<string, HubNote>>;
	rollups: Readonly<Partial<Record<HubItemKind, string>>>;
	begin: (key: string) => void;
	end: (key: string) => void;
	setNote: (key: string, note: HubNote | null) => void;
	setRollup: (kind: HubItemKind, text: string | null) => void;
	/** Drop error notes for items the backend no longer lists (and are not mid-press). */
	pruneNotes: (listed: ReadonlySet<string>) => void;
	reset: () => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const clearTimer = (id: string) => {
	const timer = timers.get(id);
	if (timer !== undefined) clearTimeout(timer);
	timers.delete(id);
};

export const useHubActionStore = create<HubActionState>()((set, get) => ({
	pending: new Set(),
	notes: {},
	rollups: {},
	begin: (key) => {
		clearTimer(`note:${key}`);
		set((state) => {
			const notes = { ...state.notes };
			delete notes[key];
			return { pending: new Set(state.pending).add(key), notes };
		});
	},
	end: (key) =>
		set((state) => {
			const pending = new Set(state.pending);
			pending.delete(key);
			return { pending };
		}),
	setNote: (key, note) => {
		clearTimer(`note:${key}`);
		if (!note) {
			set((state) => {
				if (!(key in state.notes)) return state;
				const { [key]: _gone, ...notes } = state.notes;
				return { notes };
			});
			return;
		}
		set((state) => ({ notes: { ...state.notes, [key]: note } }));
		timers.set(
			`note:${key}`,
			setTimeout(() => get().setNote(key, null), HUB_NOTE_TTL_MS[note.tone]),
		);
	},
	setRollup: (kind, text) => {
		clearTimer(`rollup:${kind}`);
		if (text === null) {
			set((state) => {
				if (!(kind in state.rollups)) return state;
				const { [kind]: _gone, ...rollups } = state.rollups;
				return { rollups };
			});
			return;
		}
		set((state) => ({ rollups: { ...state.rollups, [kind]: text } }));
		timers.set(
			`rollup:${kind}`,
			setTimeout(() => get().setRollup(kind, null), HUB_ROLLUP_TTL_MS),
		);
	},
	pruneNotes: (listed) => {
		const { notes, pending } = get();
		const stale = Object.entries(notes)
			.filter(
				([key, note]) =>
					note.tone === "error" &&
					!key.startsWith("all:") &&
					key !== "check" &&
					!listed.has(key) &&
					!pending.has(key),
			)
			.map(([key]) => key);
		for (const key of stale) get().setNote(key, null);
	},
	reset: () => {
		for (const id of [...timers.keys()]) clearTimer(id);
		set({ pending: new Set(), notes: {}, rollups: {} });
	},
}));
