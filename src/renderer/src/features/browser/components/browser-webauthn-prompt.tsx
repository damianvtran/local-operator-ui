import {
	clearWebauthnRequest,
	noteWebauthnRequest,
	replaceWebauthnRequests,
	useWebauthnRequests,
} from "@shared/browser-webauthn-queue";
import { showErrorToast } from "@shared/utils/toast-manager";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
	type WebauthnEnding,
	chooserPanel,
	endingFor,
} from "../model/webauthn-panel";
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
 *
 * THE ENDING IS A SECOND THING THE PANEL CAN BE, NOT A SECOND FLAG BESIDE IT.
 * Round 1 kept a `notice` slot beside the queue and let the two disagree: with two
 * requests queued, the oldest expiring rendered the ending *instead of* the live
 * one, and its one button cancelled the request the user had never seen (agent
 * review round 2, R1). The panel is now a single discriminated value
 * (`model/webauthn-panel.ts`) where a live request always wins, an ending is only
 * shown once nothing is answerable, and the ending branch carries no request for a
 * dismissal to settle.
 */
export const BrowserWebauthnPrompt: FC = () => {
	const requests = useWebauthnRequests();
	const [answering, setAnswering] = useState(false);
	const [ending, setEnding] = useState<WebauthnEnding | null>(null);
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
	/** Whether the chooser was already up on the previous render, so the focus
	 * capture above fires once per opening rather than once per offered request. */
	const wasOpen = useRef(false);

	const panel = chooserPanel({ requests, ending, answering });
	const panelOpen = panel.kind !== "none";

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
			// Only explain an ending the user did not cause, and only for a request
			// the mirror was actually holding: a request raised and ended while
			// nothing was mounted was never on screen, so there is no ending to
			// acknowledge (the pull cannot replay a request main has already
			// answered either).
			if (!removed) return;
			const settled = endingFor(payload.requestId, payload.outcome);
			if (settled) setEnding(settled);
		});
		return () => {
			cancelled = true;
			offRequest?.();
			offSettled?.();
		};
	}, []);

	/*
	 * Capture where focus was when the chooser OPENS, once per opening.
	 *
	 * Re-capturing on every change of the offered request looks equivalent and is
	 * not: after the first of two queued requests is answered, Radix has already
	 * moved focus into the dialog, so the second capture records the dialog's own
	 * content and the restore at the end targets a disconnected node — a silent
	 * no-op that leaves a keyboard user on `<body>` (agent review round 2, R5). The
	 * closed-to-open transition is the moment the element the user was on is still
	 * the active one.
	 */
	useEffect(() => {
		if (!panelOpen) {
			wasOpen.current = false;
			return;
		}
		if (wasOpen.current) return;
		wasOpen.current = true;
		const active = document.activeElement;
		previousFocus.current =
			active instanceof HTMLElement && !active.closest("[role=dialog]")
				? active
				: null;
	}, [panelOpen]);

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
	 * Give focus back when the panel closes FOR GOOD.
	 *
	 * Measured before this: focus sat on `<body>` after the dialog closed, which
	 * leaves a keyboard user with no position at all (UX round 1, U5). Restoring it
	 * from an effect lost a race with Radix's own return-to-`body`, which is why the
	 * ENDING's dismissal left the caret on the body while answering and cancelling
	 * did not (UX round 2, U6): `onCloseAutoFocus` is Radix's own hook for exactly
	 * this, so the restore happens as part of the close, in the close's own order,
	 * and only when the dialog really closes — a queue that advances keeps it open
	 * and never moves focus out from under itself.
	 */
	const handleCloseAutoFocus = useCallback(
		(event: Event) => {
			event.preventDefault();
			restoreFocus();
		},
		[restoreFocus],
	);

	return (
		<BrowserWebauthnDialog
			open={panelOpen}
			panel={panel}
			onChoose={(credentialId) => {
				if (panel.kind !== "request") return;
				answer(panel.request.requestId, credentialId);
			}}
			onCancelRequest={() => {
				if (panel.kind !== "request") return;
				answer(panel.request.requestId, null);
			}}
			onDismissEnding={() => setEnding(null)}
			onCloseAutoFocus={handleCloseAutoFocus}
		/>
	);
};
