import { TEAM_BRIDGE_ALL_SCOPE } from "./team-bridge-model";

/**
 * The identity the shared composer keys a Team Bridge draft by.
 *
 * WHY THIS IS NOT THE BRIDGE'S OWN JOURNAL ANY MORE. The composer's text lives in
 * `useConversationInputStore`, addressed by `conversationId`, and that store
 * mounts a box against whatever key it is handed - the mini view already mounts
 * one against a draft key rather than a session id. Two owners for one body is
 * the defect this seam exists to prevent, so the bridge hands the composer a key
 * and keeps only what the composer cannot hold (idempotency key, schedule time,
 * create-uncertainty, the created conversation).
 *
 * THE ACCOUNT IS IN THE KEY (R1). `conversation-input-store` persists to ONE
 * `localStorage` key with no account scoping of its own, while this feature's
 * journal fences by account epoch and erases on sign-out. Naming the account
 * here means account B cannot address account A's row even though both live in
 * the same persisted blob, and `forgetBridgeDrafts` (below) drops the ones that
 * would otherwise linger. Neither half alone is enough: a scoped key leaves the
 * rows on disk, and a wipe-only rule brings them back if it ever fails to run.
 *
 * The tenant segment uses the scope the draft was authored under, so the
 * "All organizations" list keeps its own draft beside the per-organization one,
 * exactly as the journal's storage scope did.
 */
export function teamBridgeComposerKey(
	accountId: string | undefined,
	tenantId: string | undefined,
	targetKey: string,
): string {
	// `anon` rather than an empty segment: a signed-out renderer must still
	// produce a stable, collidable key of its own rather than one that reads as
	// "any account".
	return `bridge:${accountId ?? "anon"}:${tenantId ?? TEAM_BRIDGE_ALL_SCOPE}:${targetKey}`;
}

/**
 * Drop every bridge draft row belonging to `accountId` (or every bridge row when
 * no account is named, which is the sign-out arm).
 *
 * WHY IT IS A FUNCTION RATHER THAN A STORE ACTION. The input store owns rows, not
 * scopes: nothing in it knows that some `conversationId`s name another feature's
 * drafts. Teaching it the `bridge:` prefix would put this feature's naming scheme
 * in a store every composer in the app shares; enumerating here keeps the scheme
 * where it is defined.
 *
 * `clearComposer` rather than `clearAll`: a bridge key never carries submitted
 * history (the bridge journal keeps its own), so the narrower clear is the one
 * that describes what is being retired.
 */
export function forgetBridgeDrafts(
	store: { inputByConversation: Record<string, unknown> },
	clearComposer: (conversationId: string) => void,
	accountId?: string,
): void {
	const prefix = `bridge:${accountId ?? ""}`;
	for (const key of Object.keys(store.inputByConversation))
		if (key.startsWith("bridge:") && key.startsWith(prefix)) clearComposer(key);
}
