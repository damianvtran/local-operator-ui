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
import { persist } from "zustand/middleware";

type AgentAvatarState = {
	/** Agent id -> image data URL. Empty on a fresh profile. */
	images: Record<string, string>;
	setImage: (agentId: string, dataUrl: string) => void;
	clearImage: (agentId: string) => void;
};

/** The storage key. Changing it orphans every stored picture. */
const AGENT_AVATAR_STORAGE_KEY = "agent-avatar-storage";

export const useAgentAvatarStore = create<AgentAvatarState>()(
	persist(
		(set, get) => ({
			images: {},
			setImage: (agentId, dataUrl) => {
				if (!agentId) return;
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
				if (!images[agentId]) return;
				set({ images });
			},
			clearImage: (agentId) => {
				const { [agentId]: _removed, ...rest } = get().images;
				set({ images: rest });
			},
		}),
		{
			name: AGENT_AVATAR_STORAGE_KEY,
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
export function setAgentAvatar(agentId: string, dataUrl: string): void {
	useAgentAvatarStore.getState().setImage(agentId, dataUrl);
}

/** Forgets one agent's picture, leaving the fallback in its place. */
export function clearAgentAvatar(agentId: string): void {
	useAgentAvatarStore.getState().clearImage(agentId);
}
