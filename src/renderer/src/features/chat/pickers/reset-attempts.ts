/**
 * @file reset-attempts.ts
 * @description
 * Every account's reset attempt, held OUTSIDE the panel that renders it, plus the
 * hook the panel attaches through.
 *
 * `useSyncExternalStore` rather than `useState` because the state has to outlive
 * the component that shows it. `/usage` closes by unmounting (`panel-outlet.tsx`
 * calls `setPanel(null)`), and the pending `redeem_request_id` living in view
 * state died with it: a `failed` attempt -> close -> reopen -> Confirm minted a
 * FRESH id, and the vendor only joins two attempts on an identical
 * `(provider, target, redeem_request_id)`. A distinct id on the same login is a
 * second spend -- the one thing this machine exists to prevent (review round 1,
 * B2).
 *
 * Keyed by `resetAccountKey` (provider + credential ref), because "one attempt
 * at a time" is a property of the login being charged, not of the panel. Two
 * stored logins on one provider therefore keep independent attempts, and a
 * settle reaches its own account only.
 *
 * Memory is bounded by the ACCOUNTS, not by use: at most one entry per provider
 * account the user has touched, and only a DEFINITIVE outcome drops an attempt's
 * id (see `settleReset`), never a close.
 *
 * The transitions themselves stay in `usage-view-model.ts`; this module owns
 * only where the resulting map lives and how a component reads it.
 */

import { useSyncExternalStore } from "react";
import {
	type AccountResetState,
	type ResetAccount,
	type ResetStates,
	resetStateFor,
	withResetState,
} from "./usage-view-model";

/**
 * The whole map. ONE object, replaced on every write, so a component can compare
 * identity to decide whether anything it reads changed.
 */
let states: ResetStates = {};

const listeners = new Set<() => void>();

const emit = (): void => {
	for (const listener of listeners) listener();
};

/** The map as it stands, for a reader that is not a component. */
export const peekResetStates = (): ResetStates => states;

/** Subscribe to writes; returns the unsubscribe. */
export const subscribeResetStates = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/**
 * Replace one account's state from that account's CURRENT state.
 *
 * `next` is a transition, not a value: the caller must not decide from a
 * render-time snapshot, because another write (a settle arriving from a promise,
 * or the user pressing Confirm twice) may have landed in between. Returning the
 * same object means "no move" and writes nothing, which is what keeps `busy`
 * inert without a second check at the call site.
 *
 * Returns the state now held, so the caller can act on the transition it just
 * made (Confirm sends only when it actually reached `busy`).
 */
export const setResetState = (
	account: ResetAccount,
	next: (current: AccountResetState) => AccountResetState,
): AccountResetState => {
	const current = resetStateFor(states, account);
	const resolved = next(current);
	if (resolved === current) return current;
	states = withResetState(states, account, resolved);
	emit();
	return resolved;
};

/** The state this account holds right now, idle when it has none. */
export const peekResetState = (
	account: ResetAccount | null,
): AccountResetState => resetStateFor(states, account);

/**
 * Test hook: forget every attempt between cases.
 *
 * Module-level state is shared by every mount in the process, which is the
 * point, so a test that asserts "a fresh panel mints a fresh id" has to be able
 * to start from none.
 */
export const resetResetAttempts = (): void => {
	states = {};
	emit();
};

/** The whole map, re-rendering the caller on every write. */
export const useResetStates = (): ResetStates =>
	useSyncExternalStore(subscribeResetStates, peekResetStates, peekResetStates);
