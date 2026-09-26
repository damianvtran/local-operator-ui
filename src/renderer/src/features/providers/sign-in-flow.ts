/**
 * @file sign-in-flow.ts
 * @description
 * One provider sign-in, from the button press to a settled state, as a plain
 * state machine with no React in it.
 *
 * ## Why this is its own module
 *
 * The browser used to open only on a SECOND click. `provider-detail.tsx` opened
 * the sign-in page only when the `POST /v1/auth/login` reply already carried
 * `auth_url`, and on every released backend it never does: `DesktopAuth.start`
 * returns the operation in `starting` and the URL is published 0.13-1.18 s
 * later by the background task (measured per provider in the UX walk). The
 * poll that did receive the URL only repainted, so the one caller of the
 * opener was the "Reopen" button. The rules that fix it -- open on the FIRST
 * snapshot of any reply that carries a URL while the flow is still running,
 * once per operation and URL -- are exactly the kind of thing a component
 * body hides and a unit test can pin, so they live here and the component
 * only renders the state this emits.
 *
 * ## The rules, each one a measured failure
 *
 * - **Open on the first URL, from whichever reply carries it.** A newer backend
 *   waits for the URL before answering the start; an older one publishes it on
 *   a poll. Both paths call the same `observe`, so neither can be forgotten.
 * - **Once per (operation, URL).** Main already dedups the same pair
 *   (`desktop-ipc.ts`, the `opened` map), so this saves the IPC round trip and,
 *   more importantly, keeps `opened` true only after an open that SUCCEEDED --
 *   which is what lets the panel say "Reopen" only after something opened.
 * - **A 404 is the end of the flow.** The backend no longer holds the
 *   operation (restart, or aged out of its table); polling it again cannot
 *   change the answer, so the flow settles as `expired` instead of spinning.
 * - **A 409 on start is an older backend's single-flight guard.** Newer
 *   backends supersede the old operation themselves. On an older one, the live
 *   operation this renderer knows about is ADOPTED when it is the same provider
 *   and still running (the user is already mid-sign-in for it) and CANCELLED
 *   then retried once otherwise. If this renderer never started it, the
 *   backend's own sentence is shown: there is no route to name another flow.
 * - **Supersede is a cancellation with its own sentence.** When another window
 *   starts a sign-in, the backend ends this one as `cancelled` with "Replaced by
 *   a new sign-in."; it is rendered as that, not as a failure.
 * - **A device flow does not open the page by itself.** The page asks the user to
 *   ENTER a code they have not seen yet, so an automatic open lands them on it
 *   with nothing to type; the press that copies the code opens it, in that order
 *   (design § 3, UX U7, QA Q4).
 * - **A failed open is not retried by the poll.** Main is asked again only when
 *   the user presses the manual "Open sign-in page", not on every tick: a machine
 *   with no handler for the scheme answers a failed open with an OS dialog, and
 *   one per 1.5 s poll is a flood (UX U5).
 * - **A start that was superseded before it began never begins.** `start` awaits
 *   its own previous operation's cancel, which is where the user can close the
 *   panel or pick another provider; the token is re-checked after that await for
 *   the same reason `resolveConflict` checks it (code round 1, m2).
 */

import { isTerminalAuthState } from "@shared/api/local-operator/auth-operation";
import type { PollAuthOperationOptions } from "@shared/api/local-operator/auth-operation";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type { AuthOperation } from "@shared/api/local-operator/desktop-api";
import { deviceCodeOf } from "./provider-catalog";

/** Where the flow is, as the panel renders it. */
export type SignInPhase =
	/** Nothing started, or the flow was cancelled by this surface. */
	| "idle"
	/** The start request is in flight; no operation exists yet. */
	| "starting"
	/** An operation is running on the backend. */
	| "active"
	/** The operation reached a terminal state, or the start was refused. */
	| "settled";

export type SignInState = {
	phase: SignInPhase;
	/** The latest snapshot, or a synthetic `expired` one after a 404. */
	operation: AuthOperation | null;
	/** Whether the sign-in page was opened for the CURRENT operation and URL. */
	opened: boolean;
	/** Set when the app could not hand the page to the browser. */
	openFailed: boolean;
	/** A refused start (or a failed cancel-and-retry), in the backend's words. */
	error: string | null;
};

export const INITIAL_SIGN_IN_STATE: SignInState = {
	phase: "idle",
	operation: null,
	opened: false,
	openFailed: false,
	error: null,
};

/** The side effects the flow needs, injected so tests can drive every rule. */
export type SignInDeps = {
	start: (provider: string) => Promise<AuthOperation>;
	read: (id: string) => Promise<AuthOperation>;
	cancel: (id: string) => Promise<unknown>;
	open: (id: string, reopen: boolean) => Promise<void>;
	poll: (
		id: string,
		onUpdate: (operation: AuthOperation) => void,
		options: PollAuthOperationOptions,
	) => () => void;
	onChange: (state: SignInState) => void;
	onSucceeded?: (operation: AuthOperation) => void;
};

/**
 * The operation this renderer most recently started, across every panel.
 *
 * Module-level on purpose: a panel that unmounts mid-flow (the user went Back
 * to the list, or closed the dialog) stops polling but leaves the flow running
 * on the backend, and the NEXT start from any panel is the one an older
 * backend refuses with 409. Knowing the id is what lets that start adopt or
 * cancel it instead of stranding the user behind "A sign-in is already
 * active". It is memory only: a reload forgets it, which degrades to showing
 * the backend's sentence.
 */
let lastStarted: { id: string; provider: string } | null = null;

/** Test hook: forget the cross-panel record between cases. */
export function resetSignInRegistry(): void {
	lastStarted = null;
}

/**
 * The terminal sentences a RELEASED backend writes (`DesktopAuth._run`), keyed
 * to the state they belong to.
 *
 * On released backends a flow with a paste fallback (Anthropic, Z.AI) can end
 * with its state regressed to `waiting`: the paste future's `finally` rewrites
 * the state after the run has already settled, so the snapshot says "waiting"
 * while its message says "Sign-in complete." Polling that forever is the
 * stranded spinner the backend fix (#1507) removes at the source; this is the
 * renderer's half for every backend already installed.
 */
const TERMINAL_MESSAGES: ReadonlyArray<[RegExp, AuthOperation["state"]]> = [
	[/^Sign-in complete\.?$/, "succeeded"],
	[/^Sign-in cancelled\.?$/, "cancelled"],
	[/^Replaced by a new sign-in\.?$/, "cancelled"],
	[/^Sign-in expired\b/, "expired"],
	[/^Sign-in failed\b/, "failed"],
];

/**
 * The snapshot's real state: a terminal message or a spent deadline on a
 * non-terminal state means the operation is over, whatever `state` says.
 */
export function effectiveOperation(operation: AuthOperation): AuthOperation {
	if (isTerminalAuthState(operation.state)) return operation;
	for (const [pattern, state] of TERMINAL_MESSAGES) {
		if (pattern.test(operation.message)) return { ...operation, state };
	}
	// `expires_in` counts down to the backend's own deadline; at zero the flow
	// is dead even if the snapshot has not caught up. `starting` is exempt: a
	// fresh operation can legitimately report 0 before its clock is set on
	// some builds, and it is never polled long in that state.
	if (operation.state !== "starting" && operation.expires_in <= 0)
		return { ...operation, state: "expired" };
	return operation;
}

/** A snapshot standing in for an operation the backend no longer holds. */
function goneSnapshot(id: string, provider: string): AuthOperation {
	return {
		id,
		provider,
		state: "expired",
		message: "This sign-in is no longer available. Start again.",
		auth_url: null,
		instructions: null,
		input_required: false,
		prompt_id: null,
		expires_in: 0,
	};
}

function messageOf(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export type SignInFlow = {
	start: (provider: string) => Promise<void>;
	cancel: () => Promise<void>;
	reopen: () => Promise<void>;
	/** Forget the settled state so the panel returns to its idle view. */
	reset: () => void;
	/** Stop polling without cancelling: the flow belongs to the backend. */
	dispose: () => void;
	/** Stop polling and keep the state, so a remounting panel can attach to it. */
	pause: () => void;
	/** Re-attach to a live operation that pausing left alone. */
	resume: () => void;
	getState: () => SignInState;
};

export function createSignInFlow(deps: SignInDeps): SignInFlow {
	let state: SignInState = INITIAL_SIGN_IN_STATE;
	let stopPoll: (() => void) | null = null;
	/** `${id}|${url}` of the last page handed to the browser. */
	let openedKey: string | null = null;
	/** Bumped by every start/cancel/reset so a late reply cannot repaint. */
	let generation = 0;
	let disposed = false;

	const emit = (next: Partial<SignInState>) => {
		state = { ...state, ...next };
		if (!disposed) deps.onChange(state);
	};

	const stop = () => {
		stopPoll?.();
		stopPoll = null;
	};

	const tryOpen = async (operation: AuthOperation, token: number) => {
		const url = operation.auth_url;
		if (!url) return;
		/*
		 * The device page is not auto-opened: it asks the user to type a code that is
		 * still in the app, so the primary press that copies the code is what opens
		 * it (design § 3, UX U7).
		 */
		if (deviceCodeOf(operation)) return;
		const key = `${operation.id}|${url}`;
		if (openedKey === key) return;
		// Claimed BEFORE the await, so the start reply and a poll that land in
		// the same tick cannot both ask main to open the page.
		openedKey = key;
		try {
			await deps.open(operation.id, false);
			if (token === generation) emit({ opened: true, openFailed: false });
		} catch {
			// The flow is still running and the link is still copyable, so this
			// is a fallback to offer rather than a failure to settle on, and the
			// claim above is KEPT so the poll does not ask main again on every tick:
			// a machine with no handler for the scheme answers each ask with an OS
			// dialog, so the user's manual press is the retry (UX U5).
			if (token === generation) emit({ opened: false, openFailed: true });
		}
	};

	const observe = (raw: AuthOperation, token: number) => {
		if (token !== generation) return;
		const operation = effectiveOperation(raw);
		// A new URL for the same operation (a provider that re-issues it) is a
		// page the user has not seen, so "opened" is re-earned.
		const sameUrl =
			openedKey !== null &&
			openedKey === `${operation.id}|${operation.auth_url}`;
		if (isTerminalAuthState(operation.state)) {
			stop();
			if (lastStarted?.id === operation.id) lastStarted = null;
			emit({ phase: "settled", operation, opened: sameUrl && state.opened });
			if (operation.state === "succeeded") deps.onSucceeded?.(operation);
			return;
		}
		emit({
			phase: "active",
			operation,
			opened: sameUrl ? state.opened : false,
		});
		void tryOpen(operation, token);
	};

	const follow = (operation: AuthOperation, token: number) => {
		observe(operation, token);
		if (
			isTerminalAuthState(effectiveOperation(operation).state) ||
			token !== generation
		)
			return;
		stop();
		stopPoll = deps.poll(operation.id, (update) => observe(update, token), {
			onGone: () => {
				if (token !== generation) return;
				stopPoll = null;
				if (lastStarted?.id === operation.id) lastStarted = null;
				emit({
					phase: "settled",
					operation: goneSnapshot(operation.id, operation.provider),
				});
			},
		});
	};

	/**
	 * The older backend's 409, handled with the one fact this renderer has.
	 * Returns true when it resolved the conflict (adopted, or cancelled and
	 * restarted), false when the caller should show the refusal.
	 */
	const resolveConflict = async (
		provider: string,
		token: number,
	): Promise<boolean> => {
		const known = lastStarted;
		if (!known) return false;
		let live: AuthOperation | null = null;
		try {
			live = await deps.read(known.id);
		} catch {
			live = null;
		}
		if (token !== generation) return true;
		if (
			live &&
			!isTerminalAuthState(live.state) &&
			known.provider === provider
		) {
			follow(live, token);
			return true;
		}
		if (live && !isTerminalAuthState(live.state)) {
			try {
				await deps.cancel(known.id);
			} catch {
				// Already terminal; the retry below says whether the slot is free.
			}
		}
		lastStarted = null;
		if (token !== generation) return true;
		const started = await deps.start(provider);
		lastStarted = { id: started.id, provider };
		follow(started, token);
		return true;
	};

	return {
		async start(provider) {
			generation += 1;
			const token = generation;
			stop();
			const previous = state.operation;
			openedKey = null;
			emit({
				phase: "starting",
				operation: null,
				opened: false,
				openFailed: false,
				error: null,
			});
			// A retry from this panel ends its own previous flow first: a newer
			// backend would supersede it anyway, and an older one would refuse
			// the new start while it runs.
			if (previous && !isTerminalAuthState(previous.state)) {
				try {
					await deps.cancel(previous.id);
				} catch {
					// Terminal already, or gone; either way it no longer holds the slot.
				}
				/*
				 * That await is a window, and the user is in it: closing the panel
				 * or picking another provider during the cancel must stop this
				 * start from ever happening. A backend start nothing is watching
				 * is the state this guard exists to prevent - and on a newer
				 * backend the start would supersede another window's flow (code
				 * round 1, m2).
				 */
				if (token !== generation) return;
			}
			try {
				const started = await deps.start(provider);
				lastStarted = { id: started.id, provider };
				follow(started, token);
			} catch (error) {
				if (token !== generation) return;
				if (error instanceof DesktopControlError && error.status === 409) {
					try {
						if (await resolveConflict(provider, token)) return;
					} catch (retryError) {
						if (token !== generation) return;
						emit({
							phase: "settled",
							error: messageOf(retryError, "Sign-in could not start."),
						});
						return;
					}
				}
				emit({
					phase: "settled",
					error: messageOf(error, "Sign-in could not start."),
				});
			}
		},
		async cancel() {
			const current = state.operation;
			generation += 1;
			stop();
			openedKey = null;
			emit({ ...INITIAL_SIGN_IN_STATE });
			if (!current || isTerminalAuthState(current.state)) return;
			if (lastStarted?.id === current.id) lastStarted = null;
			try {
				await deps.cancel(current.id);
			} catch {
				// The flow may already be terminal; the panel closes either way.
			}
		},
		async reopen() {
			const current = state.operation;
			if (!current?.auth_url) return;
			const token = generation;
			try {
				await deps.open(current.id, true);
				openedKey = `${current.id}|${current.auth_url}`;
				if (token === generation) emit({ opened: true, openFailed: false });
			} catch {
				if (token === generation) emit({ openFailed: true });
			}
		},
		pause() {
			/*
			 * Stop polling without forgetting. The flow belongs to the backend and
			 * the state belongs to the user's view of it: a panel that unmounts (the
			 * row it lived on moved into Connected, or the user went Back to the
			 * list) must not lose a settled receipt or a live sign-in, because both
			 * are what the panel that comes back has to show (design round 1 Q1,
			 * UX U3-U4).
			 */
			generation += 1;
			stop();
		},
		resume() {
			const operation = state.operation;
			if (!operation) return;
			if (isTerminalAuthState(effectiveOperation(operation).state)) return;
			generation += 1;
			follow(operation, generation);
		},
		reset() {
			generation += 1;
			stop();
			openedKey = null;
			emit({ ...INITIAL_SIGN_IN_STATE });
		},
		dispose() {
			disposed = true;
			generation += 1;
			stop();
		},
		getState: () => state,
	};
}
