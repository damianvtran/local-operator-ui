import {
	dropBridgeComposerRows,
	pruneBridgeComposerRows,
} from "./team-bridge-composer-rows";

/** Authored drafts are deliberately separate from inbound-body metadata. This
 * shared lifecycle boundary is used by status clients even with no page mounted. */
export const TEAM_BRIDGE_DRAFT_PREFIX = "team-bridge-authored-drafts:v1:";
const PREFIX = TEAM_BRIDGE_DRAFT_PREFIX;
const epochs = new Map<string, number>();
/*
 * Other account-owned, in-memory draft state (the composer's image previews)
 * registers here so the SAME fence that erases stored drafts also drops it:
 * a signed-out or replaced account must not leave its pictures in a module
 * map for the next account to read. Listeners receive nothing - they drop
 * everything - so no account id has to leave this module.
 */
const revocationListeners = new Set<() => void>();
export function onDraftRevocation(listener: () => void): () => void {
	revocationListeners.add(listener);
	return () => revocationListeners.delete(listener);
}
const notifyRevocation = () => {
	for (const listener of revocationListeners) listener();
};
/*
 * THE COMPOSER'S OWN ROWS GO WITH THE AUTHORED DRAFTS (review round 1, R1-1).
 * The draft body lives in `conversation-input-store` now, and that store persists
 * to one unscoped key, so erasing the journal alone would leave the operator's
 * unsent words on disk after a sign-out, a session expiry or a relaunch as another
 * account. This module is the app-scoped lifecycle boundary - status clients use
 * it with no page mounted - so registering here is what makes the erasure fire at
 * all: the bridge page's own effect is defence in depth, never the only trigger.
 */
onDraftRevocation(dropBridgeComposerRows);
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
	notifyRevocation();
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
/* The account the last authoritative status read named (`null` = signed out);
 * `undefined` until the first one in this process. */
let lastReconciled: string | null | undefined;
export function reconcileDraftAccount(
	storage: Storage | null,
	status: { account_id?: string | null; state?: unknown },
): void {
	if (status.state !== "signed_out" && !status.account_id) return;
	const next =
		status.state === "signed_out" ? null : (status.account_id ?? null);
	/*
	 * THE COMPOSER'S ROWS ARE PRUNED BY SEGMENT HERE, UNCONDITIONALLY (review round 2,
	 * R2-1). The revocation below is computed from the in-memory `epochs` map and
	 * fires on `revoked || next === null`; that map is EMPTY in a fresh process, so a
	 * quit or crash as one account followed by a relaunch as another notified nobody
	 * and left the first account's unsent words in `localStorage`. The account named
	 * in the status answer IS the fact that survives a restart, so the prune reads it
	 * straight out of every row's key - the same rule the stored drafts below follow
	 * one statement further down.
	 */
	pruneBridgeComposerRows(next);
	// Revocation precedes disk cleanup: promises from an unmounted editor must
	// not resurrect bodies even if storage removal fails or the account logs in again.
	let revoked = false;
	for (const [account, epoch] of epochs)
		if (account !== next) {
			epochs.set(account, epoch + 1);
			revoked = true;
		}
	/*
	 * LISTENERS FIRE ON A TRANSITION, NOT ON EVERY READ (PR #1528 QA round 1, Q1).
	 * `epochs` never forgets an account, so after one in-place sign-out/sign-in every
	 * later status read found a "foreign" account and re-ran the wipe: the composer
	 * rows and the failed-send record went on each poll, and a retry after a lost
	 * answer went out under a new key as a duplicate. The epoch bump above stays
	 * unconditional (it only fences callbacks already stale); the listeners run once,
	 * when the observed account differs from the one this reconciler last acted on.
	 * A fresh process starts at `undefined`, so its first sign-out read still fires,
	 * and the persisted-account prune above and below never depended on this.
	 */
	if ((revoked || next === null) && next !== lastReconciled) notifyRevocation();
	lastReconciled = next;
	// No storage means nothing on disk to clean; the revocation above (epochs
	// and the in-memory preview listeners) has already happened regardless.
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
