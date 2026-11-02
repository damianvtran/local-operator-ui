import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type MentionToken, rebaseTokens } from "./tokens";

/**
 * The token SIDECAR of each composer draft.
 *
 * The draft text is persisted by `conversation-input-store`; the mention
 * tokens are not text, so they live here under the same draft key and are
 * persisted beside it as one {text, tokens} entry. Field edits publish that
 * pair before calling the text owner's setter; hydration never deletes a pair
 * merely because that owner's text has not arrived yet.
 *
 * Storage keys are JSON tuples ["mention-draft-v2", draftingAccountId,
 * tenantId, callerDraftKey]. Account/tenant come from the mention provider,
 * never display names. The caller key remains opaque: the page passes its
 * existing `bridge:<account|anon>:<authoredScope>:<targetKey>` composer key;
 * replies pass `thread|<conversationId>|<rootMessageId>`.
 * Preserve that complete suffix so page/thread/new-recipient scopes cannot
 * collapse. Unresolved ownership disables persistence. This isolates TOKENS;
 * draft text belongs to a different store and is not owner-scoped here.
 * A restored draft gets its pills back. Correctness never
 * depends on this store agreeing with the text: every read re-checks that a
 * token's range still spells `@label` (`rebaseTokens`), so a sidecar from an
 * older text simply yields no pill rather than a wrong one.
 *
 * Bounded: only drafts that hold tokens are kept, and the oldest beyond
 * `MAX_DRAFTS` are dropped, so a long-lived install cannot grow it without
 * limit. Losing a sidecar costs pills, not text.
 */
const MAX_DRAFTS = 50;

export function mentionDraftStorageKey(
	owner: { accountId: string; tenantId: string } | null | undefined,
	draftKey: string,
): string | null {
	return owner?.accountId && owner.tenantId
		? JSON.stringify([
				"mention-draft-v2",
				owner.accountId,
				owner.tenantId,
				draftKey,
			])
		: null;
}

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
					// Persist only identities whose recorded ranges still spell the
					// label. Validation cannot create identities for legacy text.
					const valid = rebaseTokens(text, text, tokens);
					if (valid.length === 0) delete drafts[key];
					else drafts[key] = { text, tokens: valid, at: Date.now() };
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
			version: 2,
			// V1 keys had no drafting owner. There is no safe owner to assign on
			// upgrade: discard those tokens, never migrate by a display-name match.
			migrate: () => ({ drafts: {} }),
		},
	),
);
