/** Authored drafts are deliberately separate from inbound-body metadata. This
 * shared lifecycle boundary is used by status clients even with no page mounted. */
export const TEAM_BRIDGE_DRAFT_PREFIX = "team-bridge-authored-drafts:v1:";
const PREFIX = TEAM_BRIDGE_DRAFT_PREFIX;
const epochs = new Map<string, number>();
export function draftAccountEpoch(accountId: string): number {
	if (!epochs.has(accountId)) epochs.set(accountId, 0);
	return epochs.get(accountId) ?? 0;
}

export function draftStorageKey(accountId: string, tenantId: string): string {
	return `${PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(tenantId)}`;
}

export function eraseAccountDrafts(
	storage: Storage | null,
	accountId: string,
): void {
	// Revocation still holds if browser storage itself refuses deletion.
	epochs.set(accountId, draftAccountEpoch(accountId) + 1);
	const prefix = `${PREFIX}${encodeURIComponent(accountId)}:`;
	if (!storage) return;
	try {
		for (const key of Object.keys(storage)) {
			if (key.startsWith(prefix)) storage.removeItem(key);
		}
	} catch {
		/* Account-scoped reads fail closed when browser storage is unavailable. */
	}
}

/** SSR has no browser storage, and a browser policy can deny its getter.
 * Never borrow Node's experimental ambient localStorage: it masked a render
 * crash on CI's Node 22 and is not the signed-in app's authored-draft store. */
export function browserDraftStorage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

/** An authoritative status response prunes every other account's drafts,
 * including across app restarts. Pending/offline reads never mean sign-out.
 * If browser storage is unavailable the account-scoped reader still fails
 * closed; a storage refusal must not turn the status API into a failed read. */
export function reconcileDraftAccount(
	storage: Storage | null,
	status: { account_id?: string | null; state?: unknown },
): void {
	if (status.state !== "signed_out" && !status.account_id) return;
	const next =
		status.state === "signed_out" ? null : (status.account_id ?? null);
	// Revocation precedes disk cleanup: promises from an unmounted editor must
	// not resurrect bodies even if storage removal fails or the account logs in again.
	for (const [account, epoch] of epochs)
		if (account !== next) epochs.set(account, epoch + 1);
	if (!storage) return;
	try {
		const allowed = next ? `${PREFIX}${encodeURIComponent(next)}:` : null;
		for (const key of Object.keys(storage))
			if (key.startsWith(PREFIX) && (!allowed || !key.startsWith(allowed)))
				storage.removeItem(key);
	} catch {
		/* The draft editor reports storage unavailability; bodies never enter a status error or telemetry. */
	}
}
