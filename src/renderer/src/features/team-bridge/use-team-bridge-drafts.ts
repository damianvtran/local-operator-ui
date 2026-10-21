import { useEffect, useRef, useState } from "react";
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
	const key =
		accountId && !signedOut ? draftStorageKey(accountId, tenantId) : null;
	const [snapshot, setSnapshot] = useState<{
		key: string | null;
		drafts: TeamBridgeDrafts;
	}>(() => {
		const drafts = key ? readDrafts(localStorage, key) : {};
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
			eraseAccountDrafts(localStorage, previous);
			scopes.current.clear();
			setSnapshot({ key: null, drafts: {} });
		}
		if (signedOut || accountId)
			previousAccount.current = signedOut ? undefined : accountId;
	}, [accountId, signedOut]);
	const load = () => {
		if (!scopes.current.has(key))
			scopes.current.set(key, key ? readDrafts(localStorage, key) : {});
		return scopes.current.get(key) ?? {};
	};
	const drafts = load();
	const targetKey = target ? draftTargetKey(target) : null;
	const current = targetKey ? drafts[targetKey] : undefined;
	const body = current?.body ?? "";
	const write = (entryKey: string, entry: TeamBridgeDraft | null) => {
		// Persist synchronously, including request idempotency state, before a write
		// leaves this renderer. A failed persistence cannot pretend reload is safe.
		const next = { ...load() };
		if (entry) next[entryKey] = entry;
		else delete next[entryKey];
		scopes.current.set(key, next);
		setSnapshot({ key, drafts: next });
		if (key) {
			try {
				localStorage.setItem(key, JSON.stringify(next));
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
		if (!target || !targetKey) return false;
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

	const clearSent = (entryKey: string, sentBody: string, clientRef: string) => {
		const entry = load()[entryKey];
		if (entry?.clientRef !== clientRef) return;
		if (entry.body.trim() === sentBody) write(entryKey, null);
		else
			write(entryKey, {
				...entry,
				sendAt: undefined,
				clientRef: crypto.randomUUID(),
			});
	};
	const listScopes =
		accountId && listAll
			? accountDraftScopes(localStorage, accountId)
			: new Map<string, TeamBridgeDrafts>();
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
		update,
		clearSent,
		storageFailed,
	};
}
