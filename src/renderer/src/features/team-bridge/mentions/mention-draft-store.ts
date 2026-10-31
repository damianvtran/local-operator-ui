import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MentionToken } from "./tokens";

/**
 * The token SIDECAR of each composer draft.
 *
 * The draft text is persisted by `conversation-input-store`; the mention
 * tokens are not text, so they live here under the same draft key and are
 * persisted beside it. A restored draft gets its pills back. Correctness never
 * depends on this store agreeing with the text: every read re-checks that a
 * token's range still spells `@label` (`rebaseTokens`), so a sidecar from an
 * older text simply yields no pill rather than a wrong one.
 *
 * Bounded: only drafts that hold tokens are kept, and the oldest beyond
 * `MAX_DRAFTS` are dropped, so a long-lived install cannot grow it without
 * limit. Losing a sidecar costs pills, not text.
 */
const MAX_DRAFTS = 50;

type Entry = { text: string; tokens: MentionToken[]; at: number };

type State = {
	drafts: Record<string, Entry>;
	write: (key: string, text: string, tokens: MentionToken[]) => void;
};

export const useMentionDraftStore = create<State>()(
	persist(
		(set) => ({
			drafts: {},
			write: (key, text, tokens) =>
				set((state) => {
					const drafts = { ...state.drafts };
					if (tokens.length === 0) delete drafts[key];
					else drafts[key] = { text, tokens, at: Date.now() };
					const keys = Object.keys(drafts);
					if (keys.length > MAX_DRAFTS)
						for (const old of keys
							.sort((a, b) => drafts[a].at - drafts[b].at)
							.slice(0, keys.length - MAX_DRAFTS))
							delete drafts[old];
					return { drafts };
				}),
		}),
		{
			name: "team-bridge-mention-drafts",
			storage: createJSONStorage(() => localStorage),
			version: 1,
		},
	),
);
