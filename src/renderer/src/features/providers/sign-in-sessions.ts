/**
 * @file sign-in-sessions.ts
 * @description
 * One sign-in flow per provider, held OUTSIDE the panel that renders it, plus
 * the hook a panel attaches through.
 *
 * ## Why the flow cannot live in the panel
 *
 * It did, and the row it lived on MOVES when the flow succeeds: a provider that
 * connects leaves the "Add a provider" list and is re-rendered inside "Connected"
 * (design § 2). That is a different list item, so React unmounts the panel and
 * mounts a new, idle one -- the receipt, the success line and the settled state
 * were all destroyed by the transition that was supposed to show them. Measured
 * on both backends: the user completes a sign-in and the panel goes back to
 * "Continue in browser", inviting them to do it again (QA round 1 Q1, UX U3).
 *
 * The same unmount is what made leaving mid-sign-in lose it: the operation keeps
 * running on the backend for its full deadline while the panel that returns shows
 * an idle view with no sign that a browser is still waiting (UX U4).
 *
 * So the flow is keyed by provider id in a module-level map, and a panel
 * ATTACHES to it. Three consequences, each the fix for one of those findings:
 *
 * - A re-attach re-reads the session's state, so a receipt survives the row move.
 * - Detaching PAUSES rather than disposes: polling stops with the panel but the
 *   whole state stays -- a settled receipt AND a settled refusal -- and the next
 *   attach resumes a still-running operation. Only `start()` and `reset()` clear
 *   it.
 *
 * The attach/detach halves are plain functions rather than a hook, so the rules
 * above are testable without a renderer (see `scripts/provider-sign-in-flow.test.mjs`,
 * the same split the flow module uses). Memory is bounded by the registry, not by
 * use: at most one session per provider id.
 */

import { useEffect, useRef, useState } from "react";
import type { AuthOperation } from "@shared/api/local-operator/desktop-api";
import {
	INITIAL_SIGN_IN_STATE,
	type SignInDeps,
	type SignInFlow,
	type SignInState,
	createSignInFlow,
} from "./sign-in-flow";

type Listener = (state: SignInState) => void;

type Session = {
	flow: SignInFlow;
	state: SignInState;
	listeners: Set<Listener>;
	/**
	 * The current attach's side effects. Refreshed on every attach, so a flow
	 * created by an earlier mount still calls the newest closures -- the query
	 * client a success has to invalidate, and the `onConnected` callback that
	 * belongs to the surface it is rendering in.
	 */
	deps: Omit<SignInDeps, "onChange">;
};

const sessions = new Map<string, Session>();

/** The state the session for this provider holds right now, idle when new. */
export function peekSignInState(providerId: string): SignInState {
	return sessions.get(providerId)?.state ?? INITIAL_SIGN_IN_STATE;
}

/** Test hook: forget every session between cases. */
export function resetSignInSessions(): void {
	for (const session of sessions.values()) session.flow.dispose();
	sessions.clear();
}

export type SignInAttachment = {
	flow: SignInFlow;
	getState: () => SignInState;
	setDeps: (deps: Omit<SignInDeps, "onChange">) => void;
	/** Re-attach to a live operation; a settled one has nothing to poll. */
	resume: () => void;
	detach: () => void;
};

/**
 * Attach a listener to this provider's session, creating the flow if needed.
 *
 * `listener` is called with every state the flow emits from now on; the caller
 * reads the current state through `getState()` because a session may already
 * hold one (that is the whole point).
 */
export function attachSignInSession(
	providerId: string,
	deps: Omit<SignInDeps, "onChange">,
	listener: Listener,
	onSucceeded?: (operation: AuthOperation) => void,
): SignInAttachment {
	const existing = sessions.get(providerId);
	const session: Session =
		existing ??
		(() => {
			const created: Session = {
				// Assigned immediately below; the flow's `onChange` needs `created`.
				flow: null as unknown as SignInFlow,
				state: INITIAL_SIGN_IN_STATE,
				listeners: new Set(),
				deps,
			};
			created.flow = createSignInFlow({
				start: (id) => created.deps.start(id),
				read: (id) => created.deps.read(id),
				cancel: (id) => created.deps.cancel(id),
				open: (id, reopen) => created.deps.open(id, reopen),
				poll: (id, onUpdate, options) =>
					created.deps.poll(id, onUpdate, options),
				onChange: (state) => {
					created.state = state;
					for (const target of created.listeners) target(state);
				},
				onSucceeded: (operation) => created.deps.onSucceeded?.(operation),
			});
			sessions.set(providerId, created);
			return created;
		})();

	session.deps = { ...deps, onSucceeded: onSucceeded ?? deps.onSucceeded };
	session.listeners.add(listener);

	return {
		flow: session.flow,
		getState: () => session.state,
		setDeps: (next) => {
			session.deps = { ...next, onSucceeded: next.onSucceeded };
		},
		resume: () => session.flow.resume(),
		detach: () => {
			/*
			 * Pause, and keep everything: a settled state stays until the user acts
			 * (Done/Continue, Cancel, or another Start), including a refusal -- the
			 * panel that comes back is where the reason was, and clearing it here
			 * also wiped the state on any re-render that remounts the panel (the
			 * terminal frames' own captures caught that: the panel fell back to its
			 * idle view before the shutter). `start()` and `reset()` are what clear.
			 */
			session.listeners.delete(listener);
			session.flow.pause();
		},
	};
}

/** The hook a panel attaches through. */
export function useSignInSession(
	providerId: string,
	makeDeps: () => Omit<SignInDeps, "onChange">,
): { flow: SignInFlow; state: SignInState } {
	const depsRef = useRef(makeDeps);
	depsRef.current = makeDeps;
	const [state, setState] = useState(() => peekSignInState(providerId));
	const [attachment] = useState(() =>
		attachSignInSession(providerId, depsRef.current(), setState),
	);

	useEffect(() => {
		// The newest closures for this attach, then the state the session already
		// holds: a re-attach after a row move sees the receipt it was about to lose.
		attachment.setDeps(depsRef.current());
		setState(attachment.getState());
		attachment.resume();
		return () => attachment.detach();
	}, [attachment]);

	return { flow: attachment.flow, state };
}
