import { useObservedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import {
	type HoldsPage,
	actionableHoldCount,
	holdInboxRevision,
	isHoldHiddenLocally,
} from "./team-bridge-holds-model";

export const HELD_HIDE_STORAGE_KEY = "lop.team-bridge.held-hide.v1";
// Same per-device entry budget as the Team Bridge mention draft store. Do not
// evict a previous hide to make room: that would undo an unrelated choice.
const MAX_HIDES = 50;
const REVISION = /^[0-9a-f]{64}$/;
const EMPTY: ReadonlySet<string> = new Set();

type HideStorage = Pick<Storage, "getItem" | "setItem">;

export function createHeldHidePreference(storage: () => HideStorage) {
	let revisions = EMPTY;
	try {
		const raw = storage().getItem(HELD_HIDE_STORAGE_KEY);
		// A JSON array of fixed-size hashes needs at most 67 bytes per hash plus brackets.
		if (raw && raw.length <= 2 + 67 * MAX_HIDES) {
			const decoded: unknown = JSON.parse(raw);
			if (Array.isArray(decoded) && decoded.length <= MAX_HIDES)
				revisions = new Set(
					decoded.filter(
						(value): value is string =>
							typeof value === "string" && REVISION.test(value),
					),
				);
		}
	} catch {
		// Missing, malformed or blocked preferences must leave all holds visible.
	}
	const listeners = new Set<() => void>();
	let recoveryPending = false;
	const publish = (next: ReadonlySet<string>, pending: boolean) => {
		revisions = next;
		recoveryPending = pending;
		for (const listener of listeners) listener();
	};
	const commit = (next: ReadonlySet<string>) => {
		try {
			storage().setItem(HELD_HIDE_STORAGE_KEY, JSON.stringify([...next]));
		} catch {
			return false;
		}
		publish(next, false);
		return true;
	};
	return {
		snapshot: () => revisions,
		recoveryPending: () => recoveryPending,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		hide(revision: string) {
			if (revisions.has(revision)) return true;
			if (revisions.size >= MAX_HIDES || !REVISION.test(revision)) return false;
			return commit(new Set([...revisions, revision]));
		},
		restore(revision: string) {
			if (!revisions.has(revision)) return true;
			const next = new Set(revisions);
			next.delete(revision);
			return commit(next);
		},
		revealRecovered(recovered: readonly string[]) {
			const next = new Set(revisions);
			for (const revision of recovered) next.delete(revision);
			// Recovery wins in memory even if storage still holds the old hide.
			// Keep the effective state dirty until a later save actually succeeds.
			if (next.size !== revisions.size && !commit(next)) publish(next, true);
		},
		flushRecovery() {
			if (recoveryPending) commit(revisions);
		},
	};
}

export const heldHidePreference = createHeldHidePreference(
	() => window.localStorage,
);

export function useHeldHideRevisions() {
	return useSyncExternalStore(
		heldHidePreference.subscribe,
		heldHidePreference.snapshot,
		() => EMPTY,
	);
}

export function useHeldHideRecoveryPending() {
	return useSyncExternalStore(
		heldHidePreference.subscribe,
		heldHidePreference.recoveryPending,
		() => false,
	);
}

export function visibleHeldCount(
	page: HoldsPage | undefined,
	revisions: ReadonlySet<string>,
	excluded: ReadonlySet<string> = EMPTY,
) {
	return actionableHoldCount(
		page && {
			items: page.items.filter(
				(item) =>
					!isHoldHiddenLocally(item, revisions) &&
					!excluded.has(holdInboxRevision(item)),
			),
		},
	);
}

type InboxProjection = {
	accountId: string | undefined;
	epoch: number;
	excluded: ReadonlySet<string>;
};

// The badge is a synchronous reader of the inbox projection, not an audit
// query. React Query batches observer notifications; using a disabled query
// for this local state left one painted frame with History updated but the
// attention badge unchanged. Keep it per QueryClient and authority instead.
const inboxProjections = new WeakMap<
	QueryClient,
	ReturnType<typeof createInboxProjection>
>();
function createInboxProjection() {
	let current: InboxProjection | undefined;
	const listeners = new Set<() => void>();
	const read = (accountId: string | undefined, epoch: number) =>
		current && current.accountId === accountId && current.epoch === epoch
			? current.excluded
			: EMPTY;
	return {
		read,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		publish(
			accountId: string,
			epoch: number,
			project: (before: ReadonlySet<string>) => ReadonlySet<string>,
		) {
			const before = read(accountId, epoch);
			const excluded = project(before);
			if (
				before.size === excluded.size &&
				[...excluded].every((key) => before.has(key))
			)
				return;
			current = { accountId, epoch, excluded };
			for (const listener of listeners) listener();
		},
	};
}
function inboxProjection(client: QueryClient) {
	let store = inboxProjections.get(client);
	if (!store) {
		store = createInboxProjection();
		inboxProjections.set(client, store);
	}
	return store;
}

export function publishHoldInboxProjection(
	client: QueryClient,
	accountId: string,
	epoch: number,
	project: (before: ReadonlySet<string>) => ReadonlySet<string>,
) {
	inboxProjection(client).publish(accountId, epoch, project);
}

export function useVisibleHeldCount(page: HoldsPage | undefined) {
	const { accountId, epoch } = useObservedRadientAuthority();
	const store = inboxProjection(useQueryClient());
	const snapshot = useCallback(
		() => store.read(accountId, epoch),
		[store, accountId, epoch],
	);
	const excluded = useSyncExternalStore(store.subscribe, snapshot, () => EMPTY);
	return visibleHeldCount(page, useHeldHideRevisions(), excluded);
}
