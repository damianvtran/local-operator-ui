/**
 * @file use-radient-session-issue.ts
 * @description
 * Whether this machine's Radient sign-in still works, and the one action that
 * starts it again.
 *
 * ## The incident this exists for
 *
 * The operator's Radient login died (`401 Token refresh failed: refresh token
 * is expired or revoked`) and nothing said so. The tunnel connector then
 * crash-looped 870 times while `lop tunnel status` kept answering "active",
 * the phone portal 503'd, and every surface the operator looked at asserted
 * health. The TUI half of the fix ships in the backend (a toast plus a status
 * band reading the connector's park state); this is the desktop half, which
 * has to reach the operator where they are working.
 *
 * ## Where the answer comes from, and why it is not a push frame
 *
 * `GET /v1/auth/status` carries `radient_login` (the tunnel-owning login's
 * verdict: `ok`, `login_required`, `unknown`) beside the stored accounts it
 * already returned. The backend's own route documentation says why there is no
 * event frame for it: this state changes when a person signs in or edits a
 * console, so a frame would carry news that is minutes old. The app therefore
 * polls it, and refetches when a sign-in it started settles.
 *
 * ## `unknown` is not `login_required`, and that is load-bearing
 *
 * The verdict is decided from this device's own credential store. A refresh
 * that could not REACH the token endpoint reports `unknown`, because sending
 * an offline machine to a sign-in it does not need is the same class of
 * misdirection this surface exists to remove. No surface here ever treats
 * `unknown` (or an absent key, which is every backend older than the route) as
 * "the login is dead".
 *
 * ## The remedy is the action, not a command
 *
 * The backend's route is read-only by design: its `remedy` is the terminal
 * command that clears the condition (`lop login radient`), which the UI SHOWS
 * rather than runs. The action this surface offers is the desktop's own
 * sign-in route, `POST /v1/auth/login {provider: "radient"}`, which the backend
 * already serves and which re-arms a parked connector once it completes
 * (`AuthStore.upsert_credential` calls `tunnels.install.rearm_if_parked`).
 */

import {
	isTerminalAuthState,
	pollAuthOperation,
} from "@shared/api/local-operator/auth-operation";
import {
	desktopResult,
	openAuthorization,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import type { AuthOperation } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How often the verdict is re-read while the window is in the foreground.
 *
 * A minute, because the condition changes on human timescales (a login, a
 * console edit) and this read is one local HTTP call with no upstream leg -
 * `GET /v1/auth/status` deliberately does not probe the loopback gateway or
 * call Radient. Deliberately NOT `refetchIntervalInBackground`: the capability
 * watch polls in the background because a shut gate heals on nothing else,
 * whereas here a user who is not looking does not need a nag, and returning to
 * the window refetches on focus anyway.
 */
export const TUNNEL_VERDICT_POLL_MS = 60_000;

/**
 * The provider id the tunnel owns its login under.
 *
 * `POST /v1/auth/login` takes the registry's provider id, so this is both what
 * the sign-in is started with and the identity the backend's verdict is about.
 */
export const TUNNEL_LOGIN_PROVIDER = "radient";

/** The tunnel-owning login's state, as the backend decides it. */
export type RadientLoginState = "ok" | "login_required" | "unknown";

export type RadientLoginVerdict = {
	credential_id: number | null;
	state: RadientLoginState;
};

/** The command that clears the condition, or `null` when none exists. */
export type TunnelRemedy = { command: string; url: string } | null;

/**
 * The tunnel half of `GET /v1/auth/status`.
 *
 * Both keys are OPTIONAL on purpose: the route already answered without them
 * on every backend older than the tunnel surface, and an absent key must read
 * as "nothing known" rather than as a healthy tunnel.
 */
export type AuthStatusResult = {
	accounts?: unknown;
	radient_login?: RadientLoginVerdict | null;
	tunnel_remedy?: TunnelRemedy;
};

/**
 * The verdict's query, keyed UNDER `desktopKeys.accounts`.
 *
 * A separate cache entry is required because the payload differs from the
 * logout picker's (which maps the same route to `accounts` alone, and two
 * queries sharing one key would fight over one cache slot). Keying under the
 * accounts key rather than beside it is what makes an existing invalidation
 * do the right thing for free: signing out removes the Radient credential, so
 * `invalidateQueries({queryKey: desktopKeys.accounts})` - which both the
 * sign-out mutation and the logout picker already call - must also refresh
 * this verdict, and it does, by prefix.
 */
export const radientSessionIssueKey = [
	...desktopKeys.accounts,
	"session-issue",
] as const;

/**
 * The two refusals that name their own remedy, and therefore keep no retry.
 *
 * Carried as a discriminant rather than re-read from the sentence, on the same
 * rule `refusalKind` states below: the backend's copy is not a contract. The
 * surface owes each one a different thing - `sign-in-active` can say where the
 * flow holding the loopback port can be finished, and `no-browser-flow` has
 * nowhere to send the user, because the route it names is what is missing.
 */
export type RadientRefusal = "sign-in-active" | "no-browser-flow";

/**
 * What the surface should say, or that it should not be there at all.
 *
 * `hidden` is the healthy state and the overwhelmingly common one, so it is a
 * member of the union rather than a separate boolean: a caller that renders on
 * `issue.kind !== "hidden"` cannot forget one of the two ways to be silent
 * (a healthy verdict, and a verdict this backend cannot give).
 */
export type RadientSessionIssue =
	| { kind: "hidden" }
	| { kind: "needs-sign-in"; remedy: TunnelRemedy }
	| { kind: "signing-in" }
	| { kind: "input-required"; message: string }
	| {
			kind: "settled";
			message: string;
			canRetry: boolean;
			/**
			 * Set only for the refusals the surface cannot clear itself: it is what
			 * lets the callout offer an exit (a dismissal) where it offers no action,
			 * and it is how the callout knows WHICH refusal this is without reading
			 * the backend's sentence.
			 */
			refusal?: RadientRefusal;
	  };

/**
 * What the sign-in flow is doing, if anything.
 *
 * Held separately from the verdict because the two answer different questions:
 * the verdict is what the backend says about the stored credential, and this is
 * what the flow THIS app started is doing. A flow in flight must keep its state
 * even while the verdict still reads `login_required`, which is exactly what
 * happens between the consent click and the connector re-arming.
 */
type Phase =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "running" }
	/**
	 * The flow wants a code pasted back, which this surface cannot take.
	 *
	 * Its own phase rather than a flag BESIDE the running one: the two are
	 * mutually exclusive states of the same flow, and a flag left set while a
	 * later read reported `waiting` would have kept this surface saying "paste
	 * the code" over a flow that had moved on.
	 */
	| { kind: "input-required"; message: string }
	/** The login completed; the verdict has not caught up yet. */
	| { kind: "settling" }
	/**
	 * What the operation ended as, and - for the refusals - which one it was.
	 * See `RadientSessionIssue`'s `settled` member: the two carry the same
	 * `refusal`, and this is where it is decided (it is read from the refusal's
	 * STATUS where the operation is started).
	 */
	| {
			kind: "settled";
			message: string;
			canRetry: boolean;
			refusal?: RadientRefusal;
	  };

export type UseRadientSessionIssue = {
	/** What to render, or `hidden`. */
	issue: RadientSessionIssue;
	/** Start a Radient sign-in. A no-op while one is running. */
	start: () => void;
	/** Cancel the sign-in this app started. */
	cancel: () => void;
	/**
	 * Clear a settled refusal this surface cannot act on.
	 *
	 * The refusals that name their own remedy keep no retry, and nothing else
	 * clears them: the phase outlives the operation it reports. Without this the
	 * 409/422 block is a standing sentence with no control at all - a dead end
	 * reachable from Settings, which starts the same `auth.start` flow (agent
	 * review round 1, M-1). Dismissing returns the surface to the state that
	 * describes the login, which is where the operator's next move belongs.
	 */
	dismiss: () => void;
};

/**
 * The ONE read of `GET /v1/auth/status` for the tunnel's login verdict, and its
 * capability gate.
 *
 * Shared rather than restated because two surfaces render this verdict - the
 * composer's callout (below) and the provider chip in Settings
 * (`provider-grid.tsx`, `provider-detail.tsx`) - and the chip exists to agree
 * with the callout. Two queries over the same route would be two cache entries
 * polled on two clocks, and for up to a poll interval they could answer
 * differently at the same instant, which is the contradiction both surfaces
 * were built to remove. One key means React Query dedupes the request and every
 * reader sees the same answer.
 *
 * `settling` is true until this read can say anything: while the capability
 * answer is still out, and then while the gated read is. A DISABLED query stays
 * `isPending` forever in React Query v5, so a caller that held its paint on the
 * query's own `isPending` would hang on every backend without `tunnel`; this
 * flag ends there instead, with no verdict.
 *
 * `settling` IS THE FIRST ANSWER ONLY, never "a read is out" (QA round 3, Q-8).
 * A query that FAILED holds no data, and React Query puts a data-less query
 * back to `status: "pending"` for every later attempt (`query-core@5.73.3`
 * `fetchState`: `data === undefined` resets `status` to `"pending"`), so while
 * the route is failing, `isPending` is true again on every poll, window focus,
 * `refreshProviders` invalidation and observer mount. The grid holds its whole
 * card list - detail panel included - on this flag, so reading `isPending` here
 * turned each re-attempt into an unmount of the panel, and the panel's own
 * remount into the next attempt: ~70 requests a second and a grid that never
 * left "Loading providers". `isFetched` (the query has answered at least once,
 * data OR error) is what D6's hold is actually about - the first painted card
 * must not carry a claim the first answer is about to correct - and after that
 * answer a re-read keeps the list on screen exactly as a re-read of a SUCCESSFUL
 * verdict always has. The capability arm gets the same rule for the same
 * reason: it is `retry: false` with its own renegotiation interval, so a failed
 * capability read is re-asked on a timer too.
 *
 * `retryOnMount` is the caller's, and the default is React Query's own (`true`):
 * see `RadientLoginVerdictOptions` for which surfaces must turn it off.
 */
function useRadientAuthStatus({
	retryOnMount = true,
}: RadientLoginVerdictOptions = {}) {
	const capabilities = useDesktopCapabilities();
	/*
	 * Fail closed on the capability, which is a NEW key the backend advertises
	 * only once it answers `radient_login` at all. A backend that predates it
	 * would return a payload with no verdict, and reading that absence as "the
	 * login is fine" is the one thing the key was added to prevent - so with no
	 * `tunnel` feature there is no read and no callout, rather than a callout
	 * that can never appear.
	 */
	const enabled = desktopFeatureEnabled(capabilities.data, "tunnel");

	const status = useQuery({
		queryKey: radientSessionIssueKey,
		queryFn: () => desktopResult<AuthStatusResult>({ op: "accounts.list" }),
		enabled,
		staleTime: TUNNEL_VERDICT_POLL_MS,
		refetchInterval: TUNNEL_VERDICT_POLL_MS,
		refetchOnWindowFocus: true,
		/*
		 * No retry: a refusal here is a state to render rather than a transient
		 * to hammer, and a read that failed has already told the caller nothing
		 * about the login - which renders as `hidden` either way.
		 */
		retry: false,
		/*
		 * Per OBSERVER in React Query (`shouldLoadOnMount` reads the mounting
		 * observer's options), so one caller's choice cannot change another's.
		 */
		retryOnMount,
	});

	return {
		status,
		enabled,
		settling:
			(capabilities.isPending && !capabilities.isFetched) ||
			(enabled && status.isPending && !status.isFetched),
	};
}

/**
 * The part of the verdict read a caller may change.
 *
 * `retryOnMount` decides whether a NEW observer mounting on a verdict read that
 * has already FAILED (and so holds no data) may start another read:
 * `shouldLoadOnMount` is
 * `enabled && data === undefined && !(status === "error" && retryOnMount === false)`
 * (`@tanstack/query-core@5.73.3`, `queryObserver.js`). It is the same trap, and
 * the same remedy, as the account read's `RadientUserQueryOptions` (round 2's
 * D7/Q-5), found this time on this key (QA round 3, Q-8): the provider panel
 * mounts this read for every provider, so on a failing `GET /v1/auth/status`
 * each panel mount re-commissioned it. The loop was measured at 1,579 requests in
 * 20 s from the Radient card and 1,459 from OpenAI's; one option on the panel's
 * call took it to 1.
 *
 * The inline-options hypothesis is not the cause here either: React Query hashes
 * `queryKey` by value and only a MOUNT (or an `enabled` flip) reaches
 * `shouldLoadOnMount`, which is why the fix is an option and not a hoisted key.
 */
export type RadientLoginVerdictOptions = {
	/**
	 * Whether mounting this observer may re-ask a verdict read that has failed.
	 *
	 * `true` (the default) is right for a surface that OWNS the read: the
	 * composer's callout, which lives as long as the chat and is the surface that
	 * should re-ask on its next mount, and the provider grid, which is the read's
	 * owner in Settings and onboarding. `false` is for an observer that only
	 * REPORTS a read its host is already taking - the provider detail panel, which
	 * only ever mounts beneath the grid or the account section. It still starts
	 * the FIRST read when nothing has asked yet, and it still receives every
	 * poll, focus refetch and invalidation; it only stops a remount from
	 * re-commissioning a failure.
	 */
	retryOnMount?: boolean;
};

/**
 * The verdict alone, for a surface that renders it but does not start a sign-in
 * (the provider chip).
 *
 * `data` is `null` whenever nothing is known: no `tunnel` capability, a failed
 * read, or a payload without the key. Gating on the capability costs the chip
 * nothing it could otherwise have learned, because the backend shipped the
 * `tunnel` key and the `radient_login` field in one change (backend `5ebd6a53`,
 * `v0.61.2`): every runtime that can answer the verdict advertises the key. A
 * runtime without it is exactly the chip's absent-verdict floor, which
 * `loginState` in `provider-labels.ts` handles from the app's own account read.
 *
 * `enabled` is re-applied to `data` for the reason the callout re-applies it: a
 * cached answer from before a withdrawal must not outlive the capability.
 */
export function useRadientLoginVerdict(
	options: RadientLoginVerdictOptions = {},
): {
	data: RadientLoginVerdict | null;
	isPending: boolean;
} {
	const { status, enabled, settling } = useRadientAuthStatus(options);
	return {
		data: enabled ? (status.data?.radient_login ?? null) : null,
		isPending: settling,
	};
}

export function useRadientSessionIssue(): UseRadientSessionIssue {
	const queryClient = useQueryClient();
	const { status, enabled } = useRadientAuthStatus();

	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	/** The sign-in this hook started; the poll and the cancel both need it. */
	const operationRef = useRef<string | null>(null);
	const stopPollRef = useRef<(() => void) | null>(null);
	/**
	 * Whether the browser hand-off has already been made for the current
	 * operation. Main dedupes a repeat of the same URL itself, so this only
	 * saves a round trip - but it is also what keeps a poll that reports the
	 * same URL from re-entering the open path on every tick.
	 */
	const openedRef = useRef(false);

	// A poll must not outlive the surface that owns it. The flow itself belongs
	// to the backend, which is why this stops polling rather than cancelling.
	useEffect(
		() => () => {
			stopPollRef.current?.();
		},
		[],
	);

	const refreshVerdict = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: radientSessionIssueKey });
	}, [queryClient]);

	const onOperation = useCallback(
		async (update: AuthOperation) => {
			if (update.state === "input_required") {
				// Radient's desktop flow has no paste step of its own, but the
				// callback server falls back to one when its loopback port cannot
				// be bound - so this state is reachable and must not be a dead end.
				setPhase({ kind: "input-required", message: update.message });
				return;
			}
			if (!isTerminalAuthState(update.state)) {
				/*
				 * Open the sign-in page the moment the backend offers it.
				 *
				 * NOT at start: the desktop route deliberately opens no browser
				 * (`open_browser=lambda _url: None`) and sets `auth_url` from the
				 * flow's own first step, so the URL can arrive on a later read
				 * than the one that started the operation. Opening only on the
				 * start reply would leave the user with a flow in flight and no
				 * page to complete it on. Main fetches the URL from the backend
				 * itself and never takes one from the renderer, and it dedupes a
				 * repeat of the same target.
				 */
				if (update.auth_url && !openedRef.current) {
					openedRef.current = true;
					try {
						await openAuthorization(update.id);
					} catch (error) {
						// A URL the backend did offer and this app could not open is a
						// real failure of the flow, not a transient: retrying the
						// ACTION starts a fresh operation, which is the remedy.
						stopPollRef.current?.();
						setPhase({
							kind: "settled",
							message: userFacingMessage(
								error,
								"The sign-in page could not be opened. Try again.",
							),
							canRetry: true,
						});
					}
				}
				return;
			}
			if (update.state === "succeeded") {
				/*
				 * Hold the "signing in" state until the verdict answers. The
				 * credential is written, but the connector re-arms from that
				 * write and the verdict is read from the store, so clearing the
				 * callout on the operation alone would flash "needs sign-in"
				 * back on screen for the second the refetch takes - and a
				 * successful sign-in that immediately re-demands a sign-in is
				 * the exact false alarm this surface exists to end.
				 */
				setPhase({ kind: "settling" });
				operationRef.current = null;
				await refreshVerdict();
				setPhase({ kind: "idle" });
				return;
			}
			// `failed`, `expired` and `cancelled` each carry the backend's own
			// sentence, which is reused rather than paraphrased: it is written
			// where the state is decided.
			operationRef.current = null;
			setPhase({
				kind: "settled",
				message: update.message,
				canRetry: true,
			});
		},
		[refreshVerdict],
	);

	const start = useCallback(() => {
		if (phase.kind === "starting" || phase.kind === "running") return;
		setPhase({ kind: "starting" });
		openedRef.current = false;
		stopPollRef.current?.();
		void (async () => {
			try {
				const started = await desktopResult<AuthOperation>({
					op: "auth.start",
					provider: TUNNEL_LOGIN_PROVIDER,
				});
				operationRef.current = started.id;
				setPhase({ kind: "running" });
				stopPollRef.current = pollAuthOperation(started.id, (update) => {
					void onOperation(update);
				});
			} catch (error) {
				const refusal = refusalKind(error);
				setPhase({
					kind: "settled",
					// The backend's own refusal sentence, verbatim: a 409 ("A sign-in
					// is already active. Finish or cancel it first.") and a 422 ("This
					// provider has no browser sign-in flow.") are different states
					// with different remedies, and both already say which they are.
					message: userFacingMessage(
						error,
						"The sign-in could not be started. Try again.",
					),
					/*
					 * A refusal is retryable only when retrying can differ. A conflict
					 * is another flow's hold on the one loopback port and a missing
					 * browser flow is a backend with no such route, so neither is
					 * cleared by pressing again - the sentence says what clears them,
					 * and `refusal` is what lets the callout offer the exit that is
					 * not "press again".
					 */
					canRetry: refusal === null,
					refusal: refusal ?? undefined,
				});
			}
		})();
	}, [onOperation, phase.kind]);

	const cancel = useCallback(() => {
		const id = operationRef.current;
		stopPollRef.current?.();
		stopPollRef.current = null;
		operationRef.current = null;
		if (!id) {
			setPhase({ kind: "idle" });
			return;
		}
		void (async () => {
			try {
				await desktopResult({ op: "auth.cancel", id });
			} catch {
				// The flow may already be terminal; the local state closes either way.
			}
			setPhase({ kind: "idle" });
		})();
	}, []);

	/**
	 * The exit for a refusal this surface cannot act on.
	 *
	 * It clears the phase and nothing else: the verdict is untouched, so the
	 * surface falls back to what it can say about the login, which is where the
	 * operator's next move belongs. It deliberately does NOT reach the other
	 * flow - that one holds the machine's one loopback port and is not this
	 * app's to cancel; `refusal: "sign-in-active"` is what tells the callout
	 * where that flow can be finished.
	 */
	const dismiss = useCallback(() => {
		setPhase({ kind: "idle" });
	}, []);

	const verdict = status.data?.radient_login ?? null;
	const issue: RadientSessionIssue = (() => {
		/*
		 * THE PHASES THAT DESCRIBE THIS APP'S OWN FLOW COME FIRST, and they are
		 * deliberately NOT gated on the verdict. A flow in flight is an action the
		 * user is in the middle of: withdrawing the capability, or a verdict that
		 * has not caught up yet, must not erase the operation they started or the
		 * pasted-code step it is waiting on.
		 */
		if (
			phase.kind === "starting" ||
			phase.kind === "running" ||
			phase.kind === "settling"
		) {
			return { kind: "signing-in" };
		}
		if (phase.kind === "input-required") {
			return { kind: "input-required", message: phase.message };
		}
		/*
		 * EVERYTHING BELOW IS A CLAIM ABOUT THE LOGIN, so both gates cover all of
		 * it - a SETTLED phase included, which used to be returned above them and
		 * therefore outlived the condition it reports (agent review round 1, M-1).
		 *
		 * `enabled` is repeated here rather than left to the query: the issue must
		 * disappear the moment the capability is withdrawn or fails, and a cached
		 * answer from before the withdrawal would otherwise keep a callout on
		 * screen that the surface can no longer refetch or act on.
		 *
		 * AND THE VERDICT WINS OVER A SETTLED PHASE. Nothing clears that phase but
		 * a further `start()` or a `cancel()`, so while this branch was
		 * unconditional two dead ends were reachable: a failure left a stale
		 * "Sign-in failed" line - with a retry - over a login that had healed, and
		 * the 409/422 refusals, which keep no retry, left a standing sentence with
		 * no control at all. The phase is this app's memory of one operation; the
		 * verdict is what the backend says about the credential, and a block that
		 * STANDS may only repeat the second. A refusal's own exit is `dismiss()`.
		 */
		if (!enabled) return { kind: "hidden" };
		if (verdict?.state !== "login_required") return { kind: "hidden" };
		if (phase.kind === "settled") {
			return {
				kind: "settled",
				message: phase.message,
				canRetry: phase.canRetry,
				refusal: phase.refusal,
			};
		}
		return {
			kind: "needs-sign-in",
			remedy: status.data?.tunnel_remedy ?? null,
		};
	})();

	return {
		issue,
		start,
		cancel,
		dismiss,
	};
}

/**
 * Which refusal this is, for the two that name their own remedy and therefore
 * must not offer the surface's action again.
 *
 * Read from the STATUS rather than from the sentence, because the backend's copy
 * is not a contract: 409 is another flow holding the one loopback port, 422 is a
 * backend that has no browser sign-in route at all. Everything else - including
 * the typed `radient_*` refusals, whose messages are authored for a user - keeps
 * the retry, and answers `null` here.
 *
 * The two are told apart because the surface owes each a different thing, and
 * the difference is where the user can go: `sign-in-active` has a flow they can
 * finish or release, in Settings, under Providers; `no-browser-flow` has
 * nowhere, because the route it names is what is missing.
 */
function refusalKind(error: unknown): RadientRefusal | null {
	const status = (error as { status?: unknown } | null)?.status;
	if (status === 409) return "sign-in-active";
	if (status === 422) return "no-browser-flow";
	return null;
}
