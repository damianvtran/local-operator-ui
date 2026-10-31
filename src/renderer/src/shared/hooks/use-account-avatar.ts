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
import {
	ACCOUNT_AVATAR_URL,
	type AvatarIdentity,
	resolveIdentityAvatar,
} from "../../../../shared/identity-avatar";

/*
 * MOVED FROM features/team-bridge (2026-10-26) when the sidebar's own account
 * row started showing the signed-in person's photo: one private-avatar path for
 * every surface, so there is one cache, one revocation rule and one fetch.
 * Team Bridge plates reach it through `useIdentityAvatar`, which asks the one
 * identity resolver which version (if any) an identity may show, then hands
 * that version (account + content hash) to `useAccountAvatar`.
 *
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
	/*
	 * The one automatic retry a `retryOnce` caller may spend on this entry
	 * (agent review round 1, M1). `retried` flips when the retry is SCHEDULED,
	 * not when it runs, so concurrent listeners cannot schedule two; `retryTimer`
	 * is the pending backoff, cleared if its scheduler unmounts first.
	 */
	retried: boolean;
	retryTimer?: ReturnType<typeof setTimeout>;
};
const caches = new WeakMap<QueryClient, Map<string, Entry>>();
// Bound even mounted entries and outstanding reads: a crowded surface falls
// back to initials rather than allocating unbounded private blobs (64 MiB max).
const MAX_ENTRIES = 64;
const MAX_AVATAR_BYTES = 1024 * 1024;
/*
 * WHY A FAILED READ IS RETRIED ONCE, AND ONLY FOR THE OWN-ACCOUNT ROW (agent
 * review round 1, M1). A failed entry is cached for the authority epoch, which
 * is what keeps a crowded Team Bridge list from re-requesting broken avatars on
 * every scroll remount. But the sidebar's account row never unmounts, so one
 * transient 502 (core restarting, hub blip) left that row on initials until the
 * next sign-in or reload. The bound is deliberate: ONE retry per entry per epoch,
 * after a backoff long enough for a restarting core to answer, so a permanent
 * failure (an older core's 404) costs exactly two requests and never a loop.
 * Team Bridge keeps its old behaviour: its rows remount and get evicted instead.
 */
const FAILED_READ_RETRY_MS = 3000;
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
/*
 * The account-avatar path shape lives with the identity resolver
 * (`src/shared/identity-avatar.ts`), the one place that decides which picture
 * an identity may show. This file only fetches the version it is handed.
 */
const AVATAR_PATTERN = ACCOUNT_AVATAR_URL;

/**
 * The picture for one Team Bridge identity, through the ONE resolver.
 *
 * Returns an object URL for a human's own account photo, or undefined, which
 * the plate draws as the identity's placeholder: the Bot glyph for an agent,
 * the initial for a person. An agent never yields an account photo here (see
 * `resolveIdentityAvatar`). Its own endpoint picture is a documented seam with
 * no relay yet, so it also renders as the glyph today.
 */
export function useIdentityAvatar(
	identity: AvatarIdentity | undefined,
	size: 64 | 256,
): string | undefined {
	const resolved = identity ? resolveIdentityAvatar(identity) : null;
	const src = resolved?.src;
	// Keyed on primitives: a directory refetch returns new objects every time,
	// and the version is a dependency of the fetch effect.
	const accountId = src?.type === "account" ? src.accountId : undefined;
	const hash = src?.type === "account" ? src.hash : undefined;
	const version = useMemo(
		() => (accountId && hash ? { accountId, hash } : null),
		[accountId, hash],
	);
	return useAccountAvatar(version, size);
}

/** One hash-pinned avatar: whose, and which content version. */
export type AccountAvatarVersion = { accountId: string; hash: string };

/** The Radient account read's own avatar fields (`GET /me`, forwarded verbatim). */
export type RadientAccountAvatarFields = {
	id?: string;
	avatar_url?: string;
	profile?: { avatar?: { source?: string; hash?: string } | null } | null;
};

const ACCOUNT_ID_PATTERN =
	/^(?:acc_[A-Za-z0-9_-]{1,64}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/;
const AVATAR_HASH_PATTERN = /^[0-9a-f]{16}$/;

/**
 * The signed-in person's avatar version, from their own account read.
 *
 * WHY THIS SOURCE. The hub's `/me` returns the account model, whose
 * `profile.avatar` carries `{source, hash}` (agent-server #216). `/me` does not
 * derive `avatar_url` (only the account GET is decorated), so the hash is the
 * authoritative half. Core forwards `/me` verbatim through the Radient proxy, the
 * same read that settles this renderer's account authority, so the version and
 * the `expectedAccountId` fence come from one answer. An older hub (no profile)
 * yields null and the row keeps its initials. When `avatar_url` IS present it
 * must agree with the hash, the same refusal `resolveIdentityAvatar` applies to
 * a directory row.
 */
export function radientAccountAvatarVersion(
	account: RadientAccountAvatarFields | undefined | null,
): AccountAvatarVersion | null {
	const id = account?.id;
	const avatar = account?.profile?.avatar;
	if (!id || !ACCOUNT_ID_PATTERN.test(id) || !avatar) return null;
	if (!avatar.hash || !AVATAR_HASH_PATTERN.test(avatar.hash)) return null;
	if (avatar.source === "none") return null;
	if (account.avatar_url) {
		const match = AVATAR_PATTERN.exec(account.avatar_url);
		if (!match || match[1] !== id || match[2] !== avatar.hash) return null;
	}
	return { accountId: id, hash: avatar.hash };
}

/**
 * The signed-in person's own photo, or undefined (initials) when there is none,
 * the read failed (retried once after a backoff, since this row never remounts),
 * the core is too old to relay it (404 -> failed entry), or the
 * account the version names is not the account the renderer is currently signed
 * in as. The last check is what keeps A's photo off B's row across a switch: the
 * cache revokes on the authority change, and a version that still names A while
 * the authority already names B is refused rather than commissioned.
 */
export function useOwnAccountAvatar(
	account: RadientAccountAvatarFields | undefined | null,
	size: 64 | 256,
): string | undefined {
	const authority = useObservedRadientAuthority();
	// Keyed on the primitives, not the object: a refetch returns a new account
	// object every time, and the version must stay referentially stable for the
	// fetch effect (it is one of its dependencies).
	const id = account?.id;
	const hash = account?.profile?.avatar?.hash;
	const source = account?.profile?.avatar?.source;
	const url = account?.avatar_url;
	const version = useMemo(
		() =>
			radientAccountAvatarVersion({
				id,
				avatar_url: url,
				profile: { avatar: { hash, source } },
			}),
		[id, hash, source, url],
	);
	return useAccountAvatar(
		version && version.accountId === authority.accountId ? version : null,
		size,
		// Always mounted, so it never recovers by remount the way a Team Bridge
		// row does: see `FAILED_READ_RETRY_MS`.
		{ retryOnce: true },
	);
}

export function useAccountAvatar(
	version: AccountAvatarVersion | null,
	size: 64 | 256,
	options: { retryOnce?: boolean } = {},
): string | undefined {
	const retryOnce = options.retryOnce === true;
	const queryClient = useQueryClient();
	const authority = useObservedRadientAuthority();
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
		const entry: Entry = cached ?? {
			failed: false,
			listeners: new Set(),
			retried: false,
		};
		const commissionedEpoch = authority.epoch;
		const commissionedAccount = authority.accountId;
		const commission = () => {
			entry.failed = false;
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
		};
		if (!cached) {
			if (!makeRoom(store)) return;
			store.set(key, entry);
			commission();
		}
		/*
		 * M1's single retry. Checked from the listener (a read settling as failed
		 * notifies it) and once on mount (a cached entry that already failed).
		 * The timer re-checks that the entry is still this key's and the authority
		 * is still the commissioning one: a sign-out or switch clears the store,
		 * so a retry can never fetch for an account that is no longer signed in.
		 */
		let scheduledRetry = false;
		const maybeRetry = () => {
			if (!retryOnce || !entry.failed || entry.promise || entry.retried) return;
			entry.retried = true;
			scheduledRetry = true;
			entry.retryTimer = setTimeout(() => {
				entry.retryTimer = undefined;
				scheduledRetry = false;
				if (store.get(key) !== entry || !entry.failed) return;
				const current = observedRadientAuthority(queryClient);
				if (
					current.epoch !== commissionedEpoch ||
					current.accountId !== commissionedAccount
				)
					return;
				commission();
			}, FAILED_READ_RETRY_MS);
		};
		// Refresh insertion order for least-recently-mounted idle eviction.
		store.delete(key);
		store.set(key, entry);
		const listener = () => {
			maybeRetry();
			if (alive.current) render((value) => value + 1);
		};
		entry.listeners.add(listener);
		maybeRetry();
		return () => {
			entry.listeners.delete(listener);
			// A backoff this mount scheduled must not outlive it unobserved; hand
			// the retry back so the next mount (same key) can schedule it again.
			if (scheduledRetry && entry.retryTimer) {
				clearTimeout(entry.retryTimer);
				entry.retryTimer = undefined;
				entry.retried = false;
			}
			// Scrolling remounts reuse this bounded, memory-only entry. The
			// authority subscriber, not unmount, owns privacy revocation.
		};
	}, [
		authority.accountId,
		authority.epoch,
		key,
		queryClient,
		retryOnce,
		size,
		version,
	]);

	if (!key || !authority.accountId) return undefined;
	return caches.get(queryClient)?.get(key)?.url;
}
