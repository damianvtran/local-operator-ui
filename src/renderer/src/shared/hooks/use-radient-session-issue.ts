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
	| { kind: "settled"; message: string; canRetry: boolean };

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
	| { kind: "settled"; message: string; canRetry: boolean };

export type UseRadientSessionIssue = {
	/** What to render, or `hidden`. */
	issue: RadientSessionIssue;
	/** Start a Radient sign-in. A no-op while one is running. */
	start: () => void;
	/** Cancel the sign-in this app started. */
	cancel: () => void;
};

export function useRadientSessionIssue(): UseRadientSessionIssue {
	const capabilities = useDesktopCapabilities();
	const queryClient = useQueryClient();
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
	});

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
					 * browser flow is a backend too old to have the route, so neither
					 * is cleared by pressing again - the copy says what clears them.
					 */
					canRetry: !isRefusalWithOwnRemedy(error),
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

	const verdict = status.data?.radient_login ?? null;
	const issue: RadientSessionIssue = (() => {
		if (phase.kind === "starting" || phase.kind === "running") {
			return { kind: "signing-in" };
		}
		if (phase.kind === "settling") return { kind: "signing-in" };
		if (phase.kind === "input-required") {
			return { kind: "input-required", message: phase.message };
		}
		if (phase.kind === "settled") {
			return {
				kind: "settled",
				message: phase.message,
				canRetry: phase.canRetry,
			};
		}
		/*
		 * `enabled` is repeated here rather than left to the query: the issue
		 * must disappear the moment the capability is withdrawn or fails, and a
		 * cached answer from before the withdrawal would otherwise keep a
		 * callout on screen that the surface can no longer refetch or act on.
		 */
		if (!enabled) return { kind: "hidden" };
		if (verdict?.state !== "login_required") return { kind: "hidden" };
		return {
			kind: "needs-sign-in",
			remedy: status.data?.tunnel_remedy ?? null,
		};
	})();

	return {
		issue,
		start,
		cancel,
	};
}

/**
 * Whether this refusal names its own remedy, and therefore must not offer the
 * surface's action again.
 *
 * Read from the STATUS and the CODE rather than from the sentence, because the
 * backend's copy is not a contract: 409 is another flow holding the one
 * loopback port, 422 is a backend that has no browser sign-in route at all.
 * Everything else - including the typed `radient_*` refusals, whose messages
 * are authored for a user - keeps the retry.
 */
function isRefusalWithOwnRemedy(error: unknown): boolean {
	const status = (error as { status?: unknown } | null)?.status;
	return status === 409 || status === 422;
}
