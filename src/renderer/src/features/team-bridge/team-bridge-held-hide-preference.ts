import { useSyncExternalStore } from "react";
import {
	type HoldsPage,
	actionableHoldCount,
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
	const commit = (next: ReadonlySet<string>, recovered = false) => {
		try {
			storage().setItem(HELD_HIDE_STORAGE_KEY, JSON.stringify([...next]));
		} catch {
			// A user action must be durable before the UI claims it worked. But
			// recovery has precedence over a stale hide even when disk is blocked.
			if (!recovered) return false;
		}
		revisions = next;
		for (const listener of listeners) listener();
		return true;
	};
	return {
		snapshot: () => revisions,
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
			if (next.size !== revisions.size) commit(next, true);
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

export function visibleHeldCount(
	page: HoldsPage | undefined,
	revisions: ReadonlySet<string>,
) {
	return actionableHoldCount(
		page && {
			items: page.items.filter((item) => !isHoldHiddenLocally(item, revisions)),
		},
	);
}

export function useVisibleHeldCount(page: HoldsPage | undefined) {
	return visibleHeldCount(page, useHeldHideRevisions());
}
