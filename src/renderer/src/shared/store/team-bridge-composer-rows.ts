import { useConversationInputStore } from "./conversation-input-store";

/**
 * The rows Team Bridge's draft text lives in, and the account fence around them.
 *
 * WHY THIS IS IN `shared/store` RATHER THAN BESIDE THE FEATURE. The composer's
 * text lives in `conversation-input-store`, addressed by `conversationId`, and the
 * mini view already mounts a box against a draft key rather than a session id.
 * Two owners for one body is the defect this seam exists to prevent, so the bridge
 * hands the composer a key and keeps only what the composer cannot hold. That key
 * is a fact about the STORE, and so is pruning it.
 *
 * THE ACCOUNT IS IN THE KEY. `conversation-input-store` persists to ONE
 * `localStorage` key with no account scoping of its own, while Team Bridge's
 * journal fences by account epoch and erases on sign-out. Naming the account here
 * means account B cannot ADDRESS account A's row even though both live in the same
 * persisted blob. Reachability is only half: `dropBridgeComposerRows` is wired into
 * the same revocation this feature's stored drafts already answer to
 * (`team-bridge-draft-account.ts`), so the rows are DROPPED on sign-out or an
 * account change whether or not a bridge page is mounted. Neither half alone is
 * enough - a scoped key leaves the rows on disk, and a wipe that only runs from a
 * mounted page never runs at all.
 *
 * The scope segment is the scope the draft was authored under, so the "All
 * organizations" list keeps its own draft beside the per-organization one, exactly
 * as the journal's storage scope does.
 */
export const TEAM_BRIDGE_COMPOSER_PREFIX = "bridge:";

export function teamBridgeComposerKey(
	accountId: string | undefined,
	scope: string,
	targetKey: string,
): string {
	// `anon` rather than an empty segment: a signed-out renderer must still
	// produce a stable, collidable key of its own rather than one that reads as
	// "any account".
	return `${TEAM_BRIDGE_COMPOSER_PREFIX}${accountId ?? "anon"}:${scope}:${targetKey}`;
}

/**
 * Drop every bridge row belonging to `accountId`, or every bridge row when no
 * account is named (the sign-out arm).
 *
 * WHY IT IS A FUNCTION RATHER THAN A STORE ACTION. The input store owns rows, not
 * scopes: nothing in it knows that some `conversationId`s name another feature's
 * drafts. Teaching it the `bridge:` prefix would put this feature's naming scheme
 * in a store every composer in the app shares; enumerating here keeps the scheme
 * where it is defined.
 *
 * `clearComposer` rather than `clearAll`: a bridge key never carries submitted
 * history (the bridge journal keeps its own), so the narrower clear is the one that
 * describes what is being retired.
 *
 * THE PREFIX IS MATCHED WHOLE, trailing colon included: matching `bridge:acct-1`
 * would also match `bridge:acct-12`, and the account id is the only thing standing
 * between two accounts' text.
 */
export function forgetBridgeComposerRows(
	store: { inputByConversation: Record<string, unknown> },
	clearComposer: (conversationId: string) => void,
	accountId?: string,
): void {
	const prefix =
		accountId === undefined
			? TEAM_BRIDGE_COMPOSER_PREFIX
			: `${TEAM_BRIDGE_COMPOSER_PREFIX}${accountId}:`;
	for (const key of Object.keys(store.inputByConversation))
		if (key.startsWith(prefix)) clearComposer(key);
}

/**
 * The revocation arm: every bridge row goes.
 *
 * WHY EVERY ROW AND NOT ONE ACCOUNT'S. Revocation listeners are deliberately told
 * nothing - no account id leaves `team-bridge-draft-account.ts` - and the event
 * itself means "the drafts this session authored may not survive it" (sign-out, or
 * a status answer naming a different account). Keeping the current account's rows
 * through that would require telling every listener which account survived, which
 * is the leak the listener signature exists to avoid. Losing a draft on an account
 * switch is recoverable; leaving the operator's words on disk under a session that
 * has ended is not.
 */
export function dropBridgeComposerRows(): void {
	const store = useConversationInputStore.getState();
	forgetBridgeComposerRows(store, store.clearComposer);
}
