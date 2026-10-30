/**
 * Agent profile pictures, keyed by agent id, held on this machine.
 *
 * THE SEAM, AND WHY IT IS ONE MODULE. The backend has no image field on an
 * agent (`AgentCreate`/`AgentUpdate` in `local_operator/server/models/schemas.py`
 * carry none), so this proof of concept keeps the picture beside the UI
 * preferences and the surfaces only ever see `useAgentAvatar(id)`,
 * `setAgentAvatar(id, dataUrl)` and `clearAgentAvatar(id)`. When the backend
 * grows the field, those three names keep their shapes and the bodies swap to
 * the wire; nothing in the sidebar or the settings pane moves.
 *
 * WHAT A STORED PICTURE DOES NOT DO, stated here because every reader needs it:
 * it is per machine (`localStorage`, not the agent record), so it is absent on
 * another computer and on mobile; it is not uploaded anywhere; and it costs its
 * own bytes in the same few-megabyte budget as every other UI preference —
 * which is why it is downscaled to 256px before it is stored
 * (`shared/agent-avatar/downscale-image.ts`).
 *
 * ONE STORE OF ITS OWN rather than a field on `ui-preferences-store`: that blob
 * is written on every collapse, drag and toggle, and putting up to 64 avatars
 * in it would make a sidebar toggle re-serialise every picture. The mechanism is
 * the same (`zustand`'s `persist`, `localStorage`, one key per store), which is
 * the repo's existing persistence layer, not a second one.
 */

import { sanitizeAvatarImages } from "@shared/agent-avatar/avatar-image";
import { create } from "zustand";
import {
	type PersistStorage,
	createJSONStorage,
	persist,
} from "zustand/middleware";

type AgentAvatarState = {
	/** Agent id -> image data URL. Empty on a fresh profile. */
	images: Record<string, string>;
	/**
	 * Stores one picture and answers whether it reached this machine's storage.
	 *
	 * `false` means the in-memory picture IS there and the write did not land, so
	 * it will be gone after a reload. The field shows its own sentence for that
	 * (see `agent-avatar-field.tsx`); this module deliberately does not raise.
	 */
	setImage: (agentId: string, dataUrl: string) => boolean;
	/** Forgets one picture and answers whether the removal reached storage. */
	clearImage: (agentId: string) => boolean;
};

/** The storage key. Changing it orphans every stored picture. */
const AGENT_AVATAR_STORAGE_KEY = "agent-avatar-storage";

/**
 * Whether the most recent write reached `localStorage`.
 *
 * A FULL OR BLOCKED STORE MUST NOT THROW OUT OF A CLICK HANDLER (review round 1,
 * R1-1). Zustand's persist writes synchronously from `set()`, and `void
 * setItem()` does not catch a `QuotaExceededError` thrown by the browser: before
 * the wrapper below, `setAgentAvatar` threw, so an upload whose bytes were
 * accepted showed "that image could not be read" (the file was fine) and Remove
 * died before it could clear its own error. The picture is already in memory by
 * then, which is the right state; what was missing is a way to SAY the write did
 * not land, and that is this flag.
 */
let lastWritePersisted = true;

/**
 * The persist storage, with the browser's write failure folded into a flag.
 *
 * The factory refuses an absent `localStorage` (the sibling
 * `delegated-cleanup-notice-store.ts` gives the full reason): `createJSONStorage`
 * degrades only when the factory THROWS, and a wrapper around `undefined` fails
 * later with "Cannot read properties of undefined". With no store to write to,
 * there is also nothing that can fail.
 */
function createAvatarStorage(): PersistStorage<AgentAvatarState> | undefined {
	const base = createJSONStorage<AgentAvatarState>(() => {
		if (typeof localStorage === "undefined" || localStorage === null) {
			throw new Error("no localStorage in this environment");
		}
		return localStorage;
	});
	if (!base) return undefined;
	return {
		...base,
		setItem: (name, value) => {
			try {
				base.setItem(name, value);
			} catch {
				// Quota, a privacy setting, a disabled store: all the same answer here,
				// and the picture stays in memory either way.
				lastWritePersisted = false;
			}
		},
	};
}

export const useAgentAvatarStore = create<AgentAvatarState>()(
	persist(
		(set, get) => ({
			images: {},
			setImage: (agentId, dataUrl) => {
				if (!agentId) return true;
				/*
				 * The write goes through the same filter the hydrate does: a caller
				 * that hands this a URL the reader would refuse would otherwise store a
				 * picture that never appears, which is the failure that looks like the
				 * upload silently not working.
				 */
				const images = sanitizeAvatarImages({
					...get().images,
					[agentId]: dataUrl,
				});
				// Refused by the sanitiser rather than by the storage: nothing to save.
				if (!images[agentId]) return true;
				lastWritePersisted = true;
				set({ images });
				return lastWritePersisted;
			},
			clearImage: (agentId) => {
				const { [agentId]: _removed, ...rest } = get().images;
				lastWritePersisted = true;
				set({ images: rest });
				return lastWritePersisted;
			},
		}),
		{
			name: AGENT_AVATAR_STORAGE_KEY,
			storage: createAvatarStorage(),
			/*
			 * The stored blob is read as an untrusted shape: a hand-edited key, a
			 * half-written value or a downgrade must not put a non-image into
			 * `<img src>`.
			 */
			merge: (persisted, current) => ({
				...current,
				images: sanitizeAvatarImages(
					(persisted as { images?: unknown } | undefined)?.images,
				),
			}),
		},
	),
);

/**
 * The picture for one agent, or `null` when it has none.
 *
 * Subscribes to this agent's entry alone, so a picture changed in the settings
 * pane repaints the sidebar row without re-rendering the other rows.
 */
export function useAgentAvatar(
	agentId: string | null | undefined,
): string | null {
	return useAgentAvatarStore((state) =>
		agentId ? (state.images[agentId] ?? null) : null,
	);
}

/** Stores a picture for one agent. The caller has already downscaled it. */
export function setAgentAvatar(agentId: string, dataUrl: string): boolean {
	return useAgentAvatarStore.getState().setImage(agentId, dataUrl);
}

/** Forgets one agent's picture, leaving the fallback in its place. */
export function clearAgentAvatar(agentId: string): boolean {
	return useAgentAvatarStore.getState().clearImage(agentId);
}
