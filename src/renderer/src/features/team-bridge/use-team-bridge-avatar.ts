import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import {
	observedRadientAuthority,
	radientAuthoritySnapshot,
	subscribeRadientAuthority,
	useObservedRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { createBlobUrl, revokeBlobUrl } from "@shared/lib/blob-url-cache";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";

/*
 * Private avatar bytes cannot be loaded with <img src>: the bearer lives in
 * main, not the renderer. This cache holds the resulting object URLs only for
 * the current signed-in account. Its key includes the credential epoch as well
 * as account + content hash + size, so even A -> B -> A cannot resurrect an
 * earlier private read. In-flight reads share one promise per key; unmounting
 * only detaches a listener, it never cancels another avatar's read.
 */
type Entry = {
	url?: string;
	failed: boolean;
	listeners: Set<() => void>;
	promise?: Promise<void>;
};
const caches = new WeakMap<QueryClient, Map<string, Entry>>();
// Bound even mounted entries and outstanding reads: a crowded surface falls
// back to initials rather than allocating unbounded private blobs (64 MiB max).
const MAX_ENTRIES = 64;
const MAX_AVATAR_BYTES = 1024 * 1024;
function avatarStore(client: QueryClient): Map<string, Entry> {
	const existing = caches.get(client);
	if (existing) return existing;
	const store = new Map<string, Entry>();
	caches.set(client, store);
	let authority = radientAuthoritySnapshot(client);
	// Subscribe for the cache lifetime, not the component lifetime: a signout
	// must revoke idle URLs synchronously even when no avatar remains mounted.
	subscribeRadientAuthority(client, () => {
		const next = radientAuthoritySnapshot(client);
		if (next === authority) return;
		authority = next;
		const old = [...store.values()];
		store.clear();
		for (const entry of old) {
			if (entry.url) revokeBlobUrl(entry.url);
			entry.url = undefined;
			for (const listener of entry.listeners) listener();
		}
	});
	return store;
}
function makeRoom(store: Map<string, Entry>): boolean {
	if (store.size < MAX_ENTRIES) return true;
	for (const [key, entry] of store) {
		// Outstanding reads still occupy a slot until completion: evicting them
		// would allow scrolling to commission unbounded simultaneous requests.
		if (entry.listeners.size || entry.promise) continue;
		if (entry.url) revokeBlobUrl(entry.url);
		store.delete(key);
		return true;
	}
	return false;
}
// Hub auth_service.go createAccount assigns uuid.NewString(); core's
// team_bridge.types.is_account_id also admits legacy acc_[A-Za-z0-9_-]+.
// Neither spelling needs URLQueryEscaper escapes. Do not decode aliases here:
// accepting encoded slashes/dot segments would widen the closed transport
// beyond actual account identifiers. Core remains the semantic ID validator.
const AVATAR_PATTERN =
	/^\/v1\/accounts\/((?:acc_[A-Za-z0-9_-]{1,64})|(?:[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}))\/avatar\?v=([0-9a-f]{16})$/;

export function teamBridgeAvatarVersion(
	member: TeamBridgeDirectoryMember | undefined,
): { accountId: string; hash: string } | null {
	if (!member?.avatar_url) return null;
	const match = AVATAR_PATTERN.exec(member.avatar_url);
	if (!match || match[1] !== member.account_id) return null;
	// The URL and the profile hash are both supplied by the directory. Refuse a
	// disagreement rather than displaying bytes under another version's key.
	if (member.profile?.avatar && member.profile.avatar.hash !== match[2])
		return null;
	return { accountId: match[1], hash: match[2] };
}

export function useTeamBridgeAvatar(
	member: TeamBridgeDirectoryMember | undefined,
	size: 64 | 256,
): string | undefined {
	const queryClient = useQueryClient();
	const authority = useObservedRadientAuthority();
	const version = useMemo(() => teamBridgeAvatarVersion(member), [member]);
	const key = version
		? `${authority.epoch}:${authority.accountId ?? "none"}:${version.accountId}:${version.hash}:${size}`
		: null;
	const [, render] = useState(0);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	useEffect(() => {
		if (!key || !version || !authority.accountId) return;
		const store = avatarStore(queryClient);
		const cached = store.get(key);
		const entry: Entry = cached ?? { failed: false, listeners: new Set() };
		if (!cached) {
			if (!makeRoom(store)) return;
			store.set(key, entry);
			const commissionedEpoch = authority.epoch;
			const commissionedAccount = authority.accountId;
			entry.promise = TeamBridgeApi.avatarBytes({
				expectedAccountId: commissionedAccount,
				accountId: version.accountId,
				hash: version.hash,
				size,
			})
				.then(({ data, mimeType }) => {
					// Query removal/restoration can replace this key without changing
					// the auth epoch. A stale read owns only its captured entry, never
					// the replacement's URL or its place in the revocation registry.
					if (store.get(key) !== entry) return;
					const current = observedRadientAuthority(queryClient);
					if (
						current.epoch !== commissionedEpoch ||
						current.accountId !== commissionedAccount
					) {
						store.delete(key);
						return;
					}
					if (
						!["image/png", "image/jpeg"].includes(mimeType) ||
						data.byteLength === 0 ||
						data.byteLength > MAX_AVATAR_BYTES
					)
						throw new Error("Invalid avatar bytes");
					entry.url = createBlobUrl(
						new Blob([data as BlobPart], { type: mimeType }),
						mimeType,
					);
				})
				.catch(() => {
					entry.failed = true;
				})
				.finally(() => {
					entry.promise = undefined;
					if (store.get(key) !== entry) return;
					for (const listener of entry.listeners) listener();
				});
		}
		// Refresh insertion order for least-recently-mounted idle eviction.
		store.delete(key);
		store.set(key, entry);
		const listener = () => {
			if (alive.current) render((value) => value + 1);
		};
		entry.listeners.add(listener);
		return () => {
			entry.listeners.delete(listener);
			// Scrolling remounts reuse this bounded, memory-only entry. The
			// authority subscriber, not unmount, owns privacy revocation.
		};
	}, [authority.accountId, authority.epoch, key, queryClient, size, version]);

	if (!key || !authority.accountId) return undefined;
	return caches.get(queryClient)?.get(key)?.url;
}
