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
 * Keep only `accountId`'s rows; drop the rest. `null` drops every bridge row.
 *
 * THE AUTHORITATIVE PRUNE (review round 2, R2-1), and the reason it is keyed by
 * account rather than by a revocation EVENT: a status answer names the account that
 * is signed in, and that name is the only account fact that survives a restart. The
 * revocation path below cannot carry this guarantee on its own - its trigger is
 * computed from an in-memory epoch map, which is EMPTY in a fresh process, so a quit
 * or crash as account A followed by a relaunch as account B notified nobody and left
 * A's unsent words in `localStorage` with nothing to prune them. Reading the account
 * out of the KEY is what makes the guarantee hold on the first status read of a new
 * process, whether or not any epoch was in memory to revoke.
 *
 * It mirrors the journal's own rule one file over: `reconcileDraftAccount` prunes
 * every stored draft scope that is not the signed-in account's, and the composer's
 * rows are pruned beside them in the same pass.
 */
export function pruneBridgeComposerRows(accountId: string | null): void {
	const store = useConversationInputStore.getState();
	const keep =
		accountId === null ? null : `${TEAM_BRIDGE_COMPOSER_PREFIX}${accountId}:`;
	for (const key of Object.keys(store.inputByConversation)) {
		if (!key.startsWith(TEAM_BRIDGE_COMPOSER_PREFIX)) continue;
		if (keep !== null && key.startsWith(keep)) continue;
		store.clearComposer(key);
	}
}

/**
 * The revocation arm: every bridge row goes.
 *
 * THIS IS THE SECONDARY PATH, NOT THE GUARANTEE (review round 2, R2-1).
 * `reconcileDraftAccount` prunes by account SEGMENT on every status read, which is
 * what holds across a restart; this listener covers the paths that erase an account
 * WITHOUT a status read (an in-app account switch or sign-out that calls
 * `eraseAccountDrafts` directly). It cannot be the only trigger: its event is
 * derived from an in-memory epoch map, which a fresh process has not filled.
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
