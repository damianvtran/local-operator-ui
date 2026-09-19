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

/**
 * The class each account-read failure was last produced with, held until a read
 * succeeds.
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
 * - and every reader of the key gets it. `failureCount` is the cache's record
 * that an attempt failed: it is in every instance's snapshot, it survives the
 * retry that clears `error`, and only a SUCCESS resets it, so a failure is never
 * invisible to a surface and never differs between two of them.
 */
const accountFailureKinds = new Map<string, RadientAccountReadFailure>();

/** The account read's key, as the string this module's bookkeeping is held under. */
const ACCOUNT_READ_KEY = JSON.stringify(radientUserKeys.user());

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
				return await radientProxy<UserInfoResult>({ operation: "account" });
			} catch (error) {
				// Recorded HERE rather than from a render, so the class is known for
				// every reader of this key from the first failure on - see
				// `accountFailureKinds`.
				accountFailureKinds.set(
					ACCOUNT_READ_KEY,
					classifyRadientAccountFailure(error),
				);
				if (isSignedOut(error)) return null;
				throw error;
			}
		},
		enabled,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: true,
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
	 * `error` first (the class of the failure in hand), then the cache's own
	 * `failureCount` with the class recorded at the failure's source, so a retry
	 * window keeps the class it started from rather than dropping to `unknown`.
	 */
	const failureKind = userQuery.error
		? classifyRadientAccountFailure(userQuery.error)
		: userQuery.failureCount > 0
			? (accountFailureKinds.get(ACCOUNT_READ_KEY) ?? "unknown")
			: null;
	const accountRead: RadientAccountRead =
		failureKind && failureKind !== "signed-out"
			? failureKind
			: userQuery.data
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
			queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
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
