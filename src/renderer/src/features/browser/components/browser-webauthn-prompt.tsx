import {
	clearWebauthnRequest,
	noteWebauthnRequest,
	replaceWebauthnRequests,
	useWebauthnRequests,
} from "@shared/browser-webauthn-queue";
import { showErrorToast } from "@shared/utils/toast-manager";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { settledChooserCopy } from "../model/webauthn-chooser";
import { BrowserWebauthnDialog } from "./browser-webauthn-dialog";

/**
 * The passkey chooser, owned by the APP SHELL.
 *
 * WHY IT IS HERE AND NOT IN THE BROWSER SURFACE. It used to be rendered by
 * `BrowserSurface`, which is mounted only on the `/browser` route or as the chat
 * side pane — so a `credentials.get()` that matched several passkeys while the
 * user was anywhere else raised a request **nobody was listening for**. Main held
 * it for the full 60 s and then cancelled it with `NotAllowedError`, and leaving
 * and returning to the surface did not bring it back either (agent review round 1,
 * finding 1 MAJOR; UX round 1, U2 MAJOR). This is the same defect the consent band
 * paid for once already, and it has the same fix: the subscription and the
 * rendering move up to the component that is mounted on every route
 * (`shared/browser-consent-attention.ts` records the consent half).
 *
 * THE QUEUE IS MAIN'S, NOT THIS COMPONENT'S. Two things keep the two agreeing:
 * the pull (`pendingWebauthnRequests`) on mount, which recovers a request raised
 * while nothing was mounted, and the settle push, which removes a request main has
 * already answered so no dead dialog is left offering a choice that cannot be
 * made. Requests are offered OLDEST FIRST and the ones behind are named, rather
 * than the newest silently replacing the one it displaced.
 *
 * IT IS A DIALOG IN THE APP'S OWN UI, AND THE WINDOW IS NEVER TOUCHED. A passkey
 * request is a modal question with a deadline, so unlike a consent request there
 * is no quieter place to put it — but nothing here raises, focuses or activates a
 * window: `src/main/window-raise.ts` stays the only module that decides that, and
 * this component only draws.
 */
export const BrowserWebauthnPrompt: FC = () => {
	const requests = useWebauthnRequests();
	const [answering, setAnswering] = useState(false);
	const [notice, setNotice] = useState<{ title: string; body: string } | null>(
		null,
	);
	/**
	 * Where focus was before the chooser appeared.
	 *
	 * A modal raised by an event rather than by a click has no trigger for
	 * Radix to hand focus back to, so the dialog used to close onto `<body>` and
	 * leave a keyboard user with no position (UX round 1, U5). Capturing the
	 * element the user was on is the app-side equivalent of giving focus back to
	 * the control that opened it.
	 */
	const previousFocus = useRef<Element | null>(null);

	const current = requests[0] ?? null;
	const currentId = current?.requestId ?? null;

	useEffect(() => {
		const api = window.api?.browser;
		if (!api) return;
		let cancelled = false;
		// The pull half: main knows what is still waiting, and a push that arrived
		// before this component mounted cannot be replayed to it.
		void api
			.pendingWebauthnRequests?.()
			.then((pending) => {
				if (!cancelled) replaceWebauthnRequests(pending);
			})
			.catch(() => {
				// A host that is not running has no pending choosers, which is the
				// empty queue this leaves in place.
			});
		const offRequest = api.onWebauthnRequest?.(noteWebauthnRequest);
		const offSettled = api.onWebauthnSettled?.((payload) => {
			const removed = clearWebauthnRequest(payload.requestId);
			const copy = settledChooserCopy(payload.outcome);
			// Only explain an ending the user did not cause, and only for a request
			// this surface was actually showing.
			if (copy && removed) setNotice(copy);
		});
		return () => {
			cancelled = true;
			offRequest?.();
			offSettled?.();
		};
	}, []);

	useEffect(() => {
		if (!currentId) return;
		previousFocus.current = document.activeElement;
	}, [currentId]);

	/**
	 * Answer main and drop the request from the mirror at once.
	 *
	 * Dropping it optimistically is what makes the queue advance immediately; main
	 * confirms with its own settle push, which is why a failed answer has to be
	 * reported rather than swallowed — the request is already off the screen by
	 * then.
	 */
	const answer = useCallback(
		(requestId: string, credentialId: string | null) => {
			setAnswering(true);
			clearWebauthnRequest(requestId);
			void (async () => {
				try {
					await window.api?.browser?.respondToWebauthn?.(
						requestId,
						credentialId,
					);
				} catch (error) {
					showErrorToast(
						`The passkey request could not be answered: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				} finally {
					setAnswering(false);
				}
			})();
		},
		[],
	);

	const restoreFocus = useCallback(() => {
		const element = previousFocus.current;
		previousFocus.current = null;
		if (element instanceof HTMLElement && element.isConnected) element.focus();
	}, []);

	/*
	 * Give focus back when the last chooser goes.
	 *
	 * Measured before this: focus sat on `<body>` after the dialog closed, which
	 * leaves a keyboard user with no position at all (UX round 1, U5). The
	 * transition is what is tracked rather than "no requests": a queue that empties
	 * and refills would otherwise move focus out from under the dialog that is
	 * already up.
	 */
	const wasOpen = useRef(false);
	useEffect(() => {
		if (requests.length === 0 && notice === null && wasOpen.current) {
			restoreFocus();
		}
		wasOpen.current = requests.length > 0 || notice !== null;
	}, [requests.length, notice, restoreFocus]);

	const open = current !== null || notice !== null;

	return (
		<BrowserWebauthnDialog
			open={open}
			request={current}
			waitingBehind={Math.max(0, requests.length - 1)}
			answering={answering}
			notice={notice}
			onDismiss={() => {
				if (current) answer(current.requestId, null);
				if (notice) setNotice(null);
			}}
			onChoose={(credentialId) => {
				if (!current) return;
				answer(current.requestId, credentialId);
			}}
		/>
	);
};
