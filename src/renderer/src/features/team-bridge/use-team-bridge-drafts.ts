import { useEffect, useMemo, useRef, useState } from "react";
import {
	TEAM_BRIDGE_DRAFT_PREFIX,
	browserDraftStorage,
	draftAccountEpoch,
} from "../../shared/store/team-bridge-draft-account";
import type { DraftAttachment } from "./team-bridge-attachments-model";
import {
	type TeamBridgeDraft,
	type TeamBridgeDrafts,
	accountDraftScopes,
	draftStorageKey,
	draftTargetKey,
	draftTenantFromStorageKey,
	eraseAccountDrafts,
	readDrafts,
} from "./team-bridge-drafts";
import type { TeamBridgeTarget } from "./team-bridge-model";

/** Writes happen at the edit, not in an effect cleanup: a navigation followed
 * by a render must never save the old field under the new target's key. */
export function useTeamBridgeDrafts(
	accountId: string | undefined,
	tenantId: string,
	target: TeamBridgeTarget | null,
	initialBody = "",
	signedOut = false,
	listAll = tenantId === "all",
) {
	const storage = browserDraftStorage();
	const key =
		accountId && !signedOut ? draftStorageKey(accountId, tenantId) : null;
	// Fence by account lifetime, not target: an authorized old-target send may
	// settle after navigation, but no callback survives logout or account reuse.
	const liveAccount = signedOut ? null : (accountId ?? null);
	const lifetime = useRef({ account: liveAccount, epoch: 0 });
	if (lifetime.current.account !== liveAccount)
		lifetime.current = {
			account: liveAccount,
			epoch: lifetime.current.epoch + 1,
		};
	const renderEpoch = lifetime.current.epoch;
	const accountEpoch = accountId ? draftAccountEpoch(accountId) : 0;
	const authorized = () =>
		!signedOut &&
		lifetime.current.epoch === renderEpoch &&
		(!accountId || draftAccountEpoch(accountId) === accountEpoch);
	const [snapshot, setSnapshot] = useState<{
		key: string | null;
		drafts: TeamBridgeDrafts;
	}>(() => {
		const drafts = key && storage ? readDrafts(storage, key) : {};
		if (initialBody && target && !drafts[draftTargetKey(target)])
			drafts[draftTargetKey(target)] = {
				target,
				body: initialBody,
				clientRef: crypto.randomUUID(),
			};
		return { key, drafts };
	});
	const [storageFailed, setStorageFailed] = useState(false);
	const scopes = useRef(
		new Map<string | null, TeamBridgeDrafts>([[snapshot.key, snapshot.drafts]]),
	);
	const previousAccount = useRef(accountId);
	useEffect(() => {
		const previous = previousAccount.current;
		if (previous && (signedOut || (accountId && previous !== accountId))) {
			eraseAccountDrafts(storage, previous);
			scopes.current.clear();
			setSnapshot({ key: null, drafts: {} });
		}
		if (signedOut || accountId)
			previousAccount.current = signedOut ? undefined : accountId;
	}, [accountId, signedOut, storage]);
	const load = () => {
		if (!scopes.current.has(key))
			scopes.current.set(key, key && storage ? readDrafts(storage, key) : {});
		return scopes.current.get(key) ?? {};
	};
	const drafts = load();
	const targetKey = target ? draftTargetKey(target) : null;
	const current = targetKey ? drafts[targetKey] : undefined;
	const body = current?.body ?? "";
	const write = (entryKey: string, entry: TeamBridgeDraft | null) => {
		if (!authorized()) return false;
		// Persist synchronously, including request idempotency state, before a write
		// leaves this renderer. A failed persistence cannot pretend reload is safe.
		const next = { ...load() };
		if (entry) next[entryKey] = entry;
		else delete next[entryKey];
		scopes.current.set(key, next);
		setSnapshot({ key, drafts: next });
		if (key) {
			if (!storage) {
				setStorageFailed(true);
				return false;
			}
			try {
				storage.setItem(key, JSON.stringify(next));
				setStorageFailed(false);
				return true;
			} catch {
				setStorageFailed(true);
				return false;
			}
		}
		return true;
	};
	const update = (patch: Partial<TeamBridgeDraft>) => {
		if (!authorized() || !target || !targetKey) return false;
		const existing = load()[targetKey];
		return write(targetKey, {
			...(existing ?? { target, body, clientRef: crypto.randomUUID() }),
			target,
			...patch,
		});
	};
	// Recipient changes make a different destination, but reordering chips does
	// not. Never reuse an acknowledged group ID for a changed To: set.
	// biome-ignore lint/correctness/useExhaustiveDependencies: recipient changes are the event; edits write synchronously.
	useEffect(() => {
		if (target?.type !== "compose") return;
		const previous = load().compose?.target;
		const signature = (value: typeof target) =>
			value.recipients
				.map((row) => `${row.kind}:${row.accountId}`)
				.sort()
				.join("|");
		const changed =
			previous?.type === "compose" && signature(previous) !== signature(target);
		update({
			target,
			...(changed
				? {
						conversationId: undefined,
						sendAt: undefined,
						createUncertain: false,
						clientRef: crypto.randomUUID(),
					}
				: {}),
		});
	}, [target, key]);
	const setBody = (value: string) =>
		update({
			body: value,
			// A schedule with an uncertain response keeps its key even if the reader
			// edits. The server returns client_ref_conflict instead of duplicating it.
			...(value.trim() !== body.trim() && !current?.sendAt
				? { clientRef: crypto.randomUUID() }
				: {}),
		});

	/*
	 * Images change what a client_ref means: the hub's replay check compares
	 * (body_hash, attachments_hash), so reusing a key for a different image set
	 * would be refused as a conflict. Same rule as `setBody`: a fresh key, except
	 * while an uncertain schedule holds its original one.
	 */
	const setAttachments = (
		next: DraftAttachment[],
		options: { keepClientRef?: boolean } = {},
	) => {
		// Read the STORED entry, not this render's `current`: uploads settle
		// asynchronously, after renders that predate the send's key.
		const stored = targetKey ? load()[targetKey] : undefined;
		// Clearing images on an entry that no longer exists (a confirmed send
		// just deleted it) must not recreate it: `update` would rebuild the
		// entry from this render's body and resurrect the sent text.
		if (!stored && next.length === 0) return true;
		const before = (stored?.attachments ?? []).map((row) => row.id).join(",");
		const after = next.map((row) => row.id).join(",");
		return update({
			attachments: next.length > 0 ? next : undefined,
			/*
			 * `keepClientRef`: a send/schedule is in flight and its key is already
			 * on the wire. Images it stages are PART of that request, so rotating
			 * here would orphan the request from its own draft (R1-02).
			 */
			...(before !== after && !stored?.sendAt && !options.keepClientRef
				? { clientRef: crypto.randomUUID() }
				: {}),
		});
	};

	const clearSent = (
		entryKey: string,
		sentBody: string,
		clientRef: string,
		sentAttachmentIds: readonly string[] = [],
	) => {
		if (!authorized()) return;
		const entry = load()[entryKey];
		if (entry?.clientRef !== clientRef) return;
		// Images the hub just bound are gone from the staging set either way: a
		// bound id can never bind again, so leaving it would guarantee a 404.
		const sent = new Set(sentAttachmentIds);
		const remaining = (entry.attachments ?? []).filter(
			(row) => !sent.has(row.id),
		);
		if (entry.body.trim() === sentBody && remaining.length === 0)
			write(entryKey, null);
		else
			write(entryKey, {
				...entry,
				// An image added mid-send keeps the entry alive, but the text that
				// DID go out must not come back with it (R2-01).
				body: entry.body.trim() === sentBody ? "" : entry.body,
				attachments: remaining.length > 0 ? remaining : undefined,
				sendAt: undefined,
				clientRef: crypto.randomUUID(),
			});
	};
	const [storageRevision, setStorageRevision] = useState(0);
	useEffect(() => {
		const changed = (event: StorageEvent) => {
			if (event.key === null || event.key.startsWith(TEAM_BRIDGE_DRAFT_PREFIX))
				setStorageRevision((revision) => revision + 1);
		};
		window.addEventListener("storage", changed);
		return () => window.removeEventListener("storage", changed);
	}, []);
	// Local writes overlay scopes below; unrelated rerenders/keystrokes need not
	// enumerate and parse every organization's stored drafts again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision represents external storage writes.
	const storedScopes = useMemo(
		() =>
			accountId && !signedOut && listAll && storage
				? accountDraftScopes(storage, accountId)
				: new Map<string, TeamBridgeDrafts>(),
		[accountId, signedOut, listAll, storageRevision, storage],
	);
	const listScopes = new Map(storedScopes);
	for (const [scopeKey, values] of scopes.current)
		if (
			scopeKey &&
			accountId &&
			scopeKey.startsWith(draftStorageKey(accountId, "")) &&
			(listAll || scopeKey === key)
		)
			listScopes.set(scopeKey, values);
	const entries = key
		? [...listScopes].flatMap(([scopeKey, values]) =>
				Object.entries(values).map(([targetKey, entry]) => ({
					key: `${scopeKey}:${targetKey}`,
					tenantId: draftTenantFromStorageKey(scopeKey),
					entry,
				})),
			)
		: Object.entries(drafts).map(([targetKey, entry]) => ({
				key: targetKey,
				tenantId,
				entry,
			}));
	return {
		drafts,
		entries,
		current,
		body,
		setBody,
		setAttachments,
		update,
		clearSent,
		storageFailed,
	};
}
