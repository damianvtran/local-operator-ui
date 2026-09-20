/**
 * @file use-radient-user-query.ts
 * @description
 * Radient account state through the backend proxy.
 *
 * The backend AuthStore owns the Radient credential and its refresh; this
 * hook only asks the proxy who the signed-in account is. There is no renderer
 * session, no local token, no refresh mutation: a 409 from the proxy means no
 * Radient credential is stored, which is the signed-out state. Signing out
 * removes the stored provider account through the auth accounts route.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { radientProxy } from "@shared/api/radient/proxy";
import type { UserInfoResult } from "@shared/api/radient/types";
import { useUserStore } from "@shared/store/user-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

// Query keys for Radient user data
export const radientUserKeys = {
	all: ["radient-user"] as const,
	user: () => [...radientUserKeys.all, "user"] as const,
};

/**
 * What the Radient account read currently says, for every surface that renders
 * it.
 *
 * ONE READING, FOUR SURFACES. The same fact decides the settings page's profile
 * fields, the account section's sentence, the rail's account row and the
 * client's own retry policy, and those used to disagree: the hook asked whether
 * the failure's PROSE read "sign in to radient", the section asked whether the
 * STATUS was 401 or 403, the page asked whether there was an error at all. A
 * backend that reworded one sentence reclassified the fault -- a 401 whose text
 * happened to say "sign in to Radient" would have become the ordinary
 * signed-out state and the refusal would have vanished from the screen -- and
 * no two of the three could be asserted to agree.
 *
 * WHY THE CODE AND NOT THE STATUS. The same status means opposite things on this
 * route: Radient refusing the ACCOUNT's credential (401/403/429, the reader
 * signs in again) versus the desktop plane refusing this APP's own bearer (401
 * with no `radient_` code, whose remedy is a restart or a re-pair, and which
 * `backend-error.ts` owns). `DesktopControlError.code` carries the backend's own
 * class -- `radient_no_credential`, `radient_credential_refused`,
 * `radient_upstream_failed` -- so the reading is structural, and `unknown` is
 * the honest answer for a status the app cannot classify rather than a guess at
 * one.
 */
export type RadientAccountRead =
	/** In flight, with nothing to render yet. */
	| "checking"
	/** Answered with an account. */
	| "ready"
	/** Answered: no Radient credential is stored, which is not a fault. */
	| "signed-out"
	/** Radient refused the credential this app holds: sign in again. */
	| "refused"
	/** Radient could not be reached, or the proxy could not serve it: retry. */
	| "unavailable"
	/** Failed for a reason this app cannot classify: retry, assert no cause. */
	| "unknown";

/** The classes of `RadientAccountRead` that are a fault rather than an answer. */
export function isRadientAccountFailure(read: RadientAccountRead): boolean {
	return read === "refused" || read === "unavailable" || read === "unknown";
}

/** The `RadientAccountRead` values that mean "the read came back without an answer". */
type RadientAccountReadFailure = Exclude<
	RadientAccountRead,
	"checking" | "ready"
>;

/**
 * The refusal classes, as the backend states them in `desktop_radient.py`.
 *
 * Not exported as a bag of codes for callers to match on: the ONE consumer is
 * `classifyRadientAccountFailure` below, so that a second surface cannot
 * `endsWith("refused")` its own way into a different reading of the same answer.
 */
const RADIENT_NO_CREDENTIAL_CODE = "radient_no_credential";
const RADIENT_CREDENTIAL_REFUSED_CODE = "radient_credential_refused";
const RADIENT_UPSTREAM_FAILED_CODE = "radient_upstream_failed";

/**
 * What a FAILED account read means, by the code the backend put on it.
 *
 * `signed-out` is the one class that also has a pre-code spelling, and that is
 * the whole reason a prose test exists here at all: the daemon in the field
 * answers the no-credential case from its single-op path with a bare string
 * detail (`HTTPException(409, "Sign in to Radient to access your account")`), so
 * no code reaches the renderer for it. The sentence is therefore read ONE
 * place, narrowed to the status it belongs to -- a 401 that happened to say the
 * same words must not become "not signed in", which is exactly the reading this
 * function exists to prevent.
 */
export function classifyRadientAccountFailure(
	error: unknown,
): Exclude<RadientAccountRead, "checking" | "ready"> {
	if (error instanceof DesktopControlError) {
		if (error.code === RADIENT_NO_CREDENTIAL_CODE) return "signed-out";
		if (error.code === RADIENT_CREDENTIAL_REFUSED_CODE) return "refused";
		if (error.code === RADIENT_UPSTREAM_FAILED_CODE) return "unavailable";
		if (error.status === 409 && /sign in to radient/i.test(error.message)) {
			return "signed-out";
		}
	}
	return "unknown";
}

type StoredAccount = {
	id: number;
	provider: string;
	type: string;
	identity_label: string;
	source: string;
	state: string;
};

function isSignedOut(error: unknown): boolean {
	// The no-credential answer is the ordinary signed-out state, not a failure to
	// surface. It is classified with every other failure so that the client's
	// retry policy and the surfaces' copy cannot read one answer two ways.
	return classifyRadientAccountFailure(error) === "signed-out";
}

/** The account read's key, as the string this module's bookkeeping is held under. */
const ACCOUNT_READ_KEY = JSON.stringify(radientUserKeys.user());

/**
 * The class each account-read failure was last produced with, held until a read
 * ANSWERS, or until the query it describes is removed.
 *
 * WHY THIS EXISTS AT ALL, measured against the built app on 2026-09-19 with one
 * refused (typed 401) read:
 *
 *  - React Query clears `error` the moment a retry starts, so an explanation
 *    derived from it alone unmounts on the press that caused it: the warning
 *    vanished on a real press of the Retry beneath it, the fields then moved
 *    65px up under the cursor, and the reader was told the fault was gone by the
 *    act of asking again (design round 1, D4);
 *  - two surfaces reading the SAME query disagreed about the same fault - the
 *    rail rendered "Account unavailable" while the settings page still said
 *    "Checking your Radient account…" - because an instance only learns of the
 *    failure from a render in which `error` is non-null, and the retry that
 *    clears it can begin before every consumer's next render (measured at
 *    t=1000ms in the rig, one account read in);
 *  - and a class recovered from a later render FLICKERS: the sentence's remedy
 *    clause would read "Retry." for one cycle and "Retry, or sign in to Radient
 *    again." once some consumer happened to observe the error (measured in the
 *    same rig run's 500ms frame).
 *
 * So the class is recorded where it is PRODUCED - the query function's own catch
 * - and every reader of the key gets it.
 *
 * WHY IT IS NOT HELD BY `failureCount`, WHICH IS WHAT THE FIRST VERSION USED
 * (review round 2, B1). `failureCount` reads like the cache's own record that an
 * attempt failed - it is in every instance's snapshot and only a success resets
 * it - but on the pinned React Query (5.73.3) a NEW fetch resets it in the same
 * breath as it clears `error`: `Query.prototype.fetch` spreads `fetchState()`
 * into the state, and for a query with no data that is
 * `{fetchFailureCount: 0, error: null}` with `status` back to `pending`
 * (`query-core/build/modern/query.js`, the `fetchState()` spread). Measured with
 * one client and a mounted observer, one refused read and then the app's own
 * press path (`invalidateQueries` via `refreshUser`):
 *
 *   after the failure  : {status: "error",   fetchFailureCount: 1, error: <401>}
 *   while the re-read
 *   is out             : {status: "pending", fetchFailureCount: 0, error: null}
 *
 * so a rule gated on `failureCount` says NOTHING for the whole first attempt -
 * ~21s for the never-answering read, the transport's own per-op deadline - and
 * the reader who pressed Retry is told the fault is gone by the act of asking
 * again, which is design round 1's D4 over again. Nothing about starting a fetch
 * touches this record: it is written by the query function's catch and cleared
 * by its ANSWER, and by the query's removal.
 *
 * AND WHY IT IS A SUBSCRIBED STORE RATHER THAN A BARE MAP (qa round 3, Q2). A map
 * is invisible to React, and React Query notifies an observer only when a prop
 * THAT OBSERVER TRACKED changes - a failed attempt dispatches `failed`, which
 * moves `fetchFailureCount`/`fetchFailureReason` and nothing a caller reads, so
 * no surface re-rendered when the class was recorded. Measured consequence: for
 * the whole first attempt after a timed-out read the settings page (which
 * re-renders for reasons of its own) stated the failure while the rail kept
 * "Checking account…", a cold remount fixed it and a props change did not - i.e.
 * a stale render, not two readings. So the record is read through
 * `useSyncExternalStore`: writing it, or clearing it, re-renders every reader of
 * the key at once, which is the property "one reading, four surfaces" was always
 * claiming.
 */
const accountFailureKinds = new Map<string, RadientAccountReadFailure>();

/**
 * Everyone rendering the recorded class, told when it changes.
 *
 * Deliberately no filtering by key: one key exists today, the set is a handful
 * of components, and a listener that re-renders on another key's change is
 * cheaper to accept than a second key-shaped cache to keep consistent.
 */
const accountFailureListeners = new Set<() => void>();

function announceAccountFailureChange(): void {
	for (const listener of accountFailureListeners) listener();
}

/** The recorded class for the key, as the value every reader renders from. */
function recordedAccountFailure(): RadientAccountReadFailure | null {
	return accountFailureKinds.get(ACCOUNT_READ_KEY) ?? null;
}

/** Subscribe to changes of the recorded class, for `useSyncExternalStore`. */
function subscribeToAccountFailure(listener: () => void): () => void {
	accountFailureListeners.add(listener);
	return () => {
		accountFailureListeners.delete(listener);
	};
}

/** Record the class this attempt failed with, and tell every surface. */
function recordAccountReadFailure(kind: RadientAccountReadFailure): void {
	if (recordedAccountFailure() === kind) return;
	accountFailureKinds.set(ACCOUNT_READ_KEY, kind);
	announceAccountFailureChange();
}

/**
 * Drop the recorded class, because the read it describes has been answered (or
 * the query holding it has been removed).
 *
 * One function rather than four `delete`s so the rule has one home: a recorded
 * failure may only be forgotten by an ANSWER, never by the start of the next
 * attempt - which is the defect this whole map exists to avoid (`failureCount`).
 */
function forgetAccountReadFailure(): void {
	if (!accountFailureKinds.delete(ACCOUNT_READ_KEY)) return;
	announceAccountFailureChange();
}

/**
 * Hook for the current Radient account, resolved by the backend.
 *
 * @returns Query result with user data, loading state, error state, and sign-out
 */
export const useRadientUserQuery = () => {
	const queryClient = useQueryClient();
	const { setIsSigningOut } = useUserStore();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "radient");

	const userQuery = useQuery<UserInfoResult | null, Error>({
		queryKey: radientUserKeys.user(),
		queryFn: async () => {
			try {
				const account = await radientProxy<UserInfoResult>({
					operation: "account",
				});
				/*
				 * An ANSWER is the only thing that clears a recorded failure - never the
				 * start of the next attempt, which is what React Query resets
				 * (`failureCount` and `error`) and what the press beneath the alert
				 * used to erase the fault with. See `accountFailureKinds`.
				 */
				forgetAccountReadFailure();
				return account;
			} catch (error) {
				if (isSignedOut(error)) {
					// No stored credential is an ANSWER rather than a fault, so it
					// clears the record instead of being kept as one: nothing about a
					// previous episode may survive a re-classification of this key.
					forgetAccountReadFailure();
					return null;
				}
				// Recorded HERE rather than from a render, so the class is known for
				// every reader of this key from the first failure on - see
				// `accountFailureKinds`.
				recordAccountReadFailure(classifyRadientAccountFailure(error));
				throw error;
			}
		},
		enabled,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: true,
		/*
		 * THREE attempts, and this is the only thing that decides that number. What
		 * the backend sees as a read "cadence" is this policy plus React Query's own
		 * backoff, never a polling interval: a refused read is 3 attempts in ~3.0s,
		 * and a read that never answers is 3 attempts ~21000ms and ~22000ms apart and
		 * then silence (measured at the backend by qa round 3; those gaps are the
		 * TRANSPORT's `DESKTOP_CONTROL_DEADLINE_MS` 20s plus the 1s/2s backoff). The
		 * renderer's own bound is 5s longer - `desktopRequestTimeoutMs` = 20s + the
		 * `DESKTOP_DEADLINE_MARGIN_MS` 5s, measured at 25.06s - and it is the one that
		 * fires when main never replies at all, which is a different anchor from a
		 * stalled backend read.
		 */
		retry: (failureCount, error) => !isSignedOut(error) && failureCount < 2,
	});

	const isAuthenticated = !!userQuery.data && !userQuery.isLoading;
	// Kept for callers that distinguished "restoring" from "loading"; the
	// backend resolves the credential synchronously so the two collapse.
	const hasLocalSession = isAuthenticated;

	/*
	 * The class the read is failing with, and the one value the surfaces render
	 * from. `data` is the account when the backend resolved one; a read that is
	 * neither answered nor failed is `checking`, and an unanswered read must not
	 * be reported as an answer -- presenting the user store's placeholder name as
	 * the reader's own was the defect the settings surface reported.
	 *
	 * A RESOLVED ACCOUNT OUTRANKS A FAILURE (review round 2, B3). React Query keeps
	 * `data` across a failed refetch -- measured: `{data: {...}, error: "Radient
	 * could not complete this operation", status: "error"}` -- and
	 * `refetchOnWindowFocus` with `staleTime: 30s` puts that state in front of any
	 * signed-in session whose credential expires after a first success. The
	 * previous rule let the failure win there, so ONE render read "the name and
	 * email below are placeholders rather than your account details" while the
	 * account section said "Connected" and the rail showed the account's real name:
	 * the D1 defect (two statements about one fault), except this time the
	 * placeholder claim was also false, because a resolved account's name and email
	 * ARE the account's. So the failure is the reading only while there is no
	 * account to read; with one resolved, every surface states what the account is.
	 *
	 * `error` first (the class of the failure in hand), then the class RECORDED at
	 * the failure's source, which is what keeps the failure on screen while the
	 * next attempt is in flight. A key with nothing recorded reads as no failure
	 * rather than as `unknown`: `unknown` is a class the backend's own answers
	 * produce, never a default for silence.
	 *
	 * The recorded class is read through `useSyncExternalStore`, so writing it
	 * re-renders this hook in every surface that renders it (see
	 * `accountFailureKinds`); the third argument is the value a server render sees,
	 * which is the same module state rather than a second reading of it.
	 */
	const recordedFailure = useSyncExternalStore(
		subscribeToAccountFailure,
		recordedAccountFailure,
		recordedAccountFailure,
	);
	const hasResolvedAccount = !!userQuery.data;
	const failureKind = hasResolvedAccount
		? null
		: userQuery.error
			? classifyRadientAccountFailure(userQuery.error)
			: recordedFailure;
	const accountRead: RadientAccountRead =
		failureKind && failureKind !== "signed-out"
			? failureKind
			: hasResolvedAccount
				? "ready"
				: userQuery.isLoading
					? "checking"
					: "signed-out";

	const signOutMutation = useMutation({
		onMutate: () => {
			setIsSigningOut(true);
		},
		mutationFn: async () => {
			const status = await desktopResult<{ accounts: StoredAccount[] }>({
				op: "accounts.list",
			});
			const radientAccounts = status.accounts.filter(
				(account) => account.provider === "radient",
			);
			for (const account of radientAccounts) {
				await desktopResult({
					op: "accounts.remove",
					accountId: account.id,
					confirmed: true,
				});
			}
			return true;
		},
		onSuccess: () => {
			queryClient.removeQueries({ queryKey: radientUserKeys.all });
			/*
			 * The recorded failure goes with the query it describes. Without this a
			 * fault from before the sign-out would outlive the query it was recorded
			 * against, and the next silent mount would render it as current.
			 */
			forgetAccountReadFailure();
			queryClient.invalidateQueries({ queryKey: desktopKeys.accounts });
			showSuccessToast("Successfully signed out");
			setIsSigningOut(false);
		},
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			showErrorToast(`Failed to sign out: ${errorMessage}`);
			setIsSigningOut(false);
		},
	});

	const refreshUserMutation = useMutation({
		mutationFn: async () => {
			/*
			 * AWAITED, so the mutation's own pending state means "the re-read this press
			 * began is still running" rather than "the invalidation was requested".
			 * That is what a control reporting a press has to say (qa round 3, Q1: with
			 * the unawaited version the page reported `isFetching`, which is true for
			 * the retries React Query runs on its own, so the control read "Retrying"
			 * while nobody had pressed anything). `invalidateQueries` resolves when the
			 * refetch it starts settles - including that refetch's own retry chain -
			 * and rejects nothing, so a read that never answers keeps this pending for
			 * as long as the chain runs.
			 */
			await queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
			return true;
		},
	});

	return {
		user: userQuery.data ?? undefined,
		isLoading: userQuery.isLoading,
		isRefetching: userQuery.isRefetching,
		/**
		 * Whether a fetch is in flight RIGHT NOW, including the retries React Query
		 * runs itself. A surface's retry control reads this rather than `isLoading`:
		 * refetching an errored query leaves `status: "error"`, so `isLoading` stays
		 * false for the whole retry and the frame after a press would be identical
		 * to the frame before it -- the config branch above records that same defect
		 * (issue 89) and this mirrors its fix.
		 */
		isFetching: userQuery.isFetching,
		/**
		 * Whether the RE-READ A PRESS ASKED FOR is still running, which is the only
		 * thing a control reporting a press may claim: `isFetching` is also true for
		 * the retries React Query runs on its own, so a surface that read it said
		 * "Retrying" beside a read nobody had asked to retry (qa round 3, Q1).
		 */
		isRefreshing: refreshUserMutation.isPending,
		/** The classification every surface renders from; see `RadientAccountRead`. */
		accountRead,
		error: userQuery.error,
		hasLocalSession,
		isAuthenticated,
		/** True when the backend cannot serve Radient at all (old backend). */
		unavailable: capabilities.isSuccess && !enabled,
		signOut: signOutMutation.mutate,
		refreshUser: refreshUserMutation.mutate,
		userQuery,
	};
};
