import {
	clearWebauthnRequest,
	noteWebauthnRequest,
	replaceWebauthnRequests,
	useWebauthnRequests,
	webauthnRequestsSnapshot,
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
				if (cancelled) return;
				// The pull half opens the panel too, so it captures the same way.
				if (pending.length > 0) recordFocus(document.activeElement);
				replaceWebauthnRequests(pending);
			})
			.catch(() => {
				// A host that is not running has no pending choosers, which is the
				// empty queue this leaves in place.
			});
		const offRequest = api.onWebauthnRequest?.((request) => {
			// CAPTURE AT RAISE TIME, in the handler itself: this is the last moment at
			// which the caret is still the user's, whatever the rendering order turns
			// out to be (Radix takes focus into the dialog as it opens, and a capture
			// taken then records the dialog — measured). See `recordFocus` for why a
			// bare read is not enough on its own.
			recordFocus(document.activeElement);
			noteWebauthnRequest(request);
		});
		const offSettled = api.onWebauthnSettled?.((payload) => {
			/*
			 * THE ENDING IS SET BEFORE THE MIRROR DROPS THE REQUEST, and that order is
			 * load-bearing (UX round 3, U6). The other order makes the panel pass through
			 * `none` for one render — the request is gone and no ending is set yet — which
			 * CLOSES the dialog, and a close is what dispatches the restore: the caret was
			 * handed back when the ending APPEARED rather than when it was dismissed, with
			 * whatever `document.activeElement` happened to be at that instant, and the
			 * dismissal itself then had nothing left to give back. Measured on the old
			 * order: nine dismissals of a plain expiry ending across five boots, every one
			 * leaving the caret on `<body>`, while the door that follows an in-dialog answer
			 * (the shape the rig happened to walk) restored correctly.
			 *
			 * Only an ending the user did not cause, and only for a request the mirror was
			 * actually holding: a request raised and ended while nothing was mounted was
			 * never on screen, so there is no ending to acknowledge (the pull cannot replay
			 * a request main has already answered either).
			 */
			const held = webauthnRequestsSnapshot().some(
				(entry) => entry.requestId === payload.requestId,
			);
			const settled = held
				? endingFor(payload.requestId, payload.outcome)
				: null;
			if (settled) setEnding(settled);
			clearWebauthnRequest(payload.requestId);
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
	/*
	 * WHERE THE USER WAS, kept while no chooser is up.
	 *
	 * Two halves, because one is not enough on this machine and the other is not
	 * enough for a person:
	 *
	 *  - a READ on every render while nothing is open, which is what works in a
	 *    background window — Chromium does not dispatch `focusin` when the document
	 *    itself is unfocused, and every rig here runs `--window-mode=headless`
	 *    (measured: a listener-only version recorded nothing, and the door it exists
	 *    for failed with the caret on `<body>`);
	 *  - a `focusin` LISTENER while nothing is open, which is what keeps it fresh for
	 *    a user who tabs or clicks around without causing a render.
	 *
	 * A value is only ever WRITTEN, never cleared: an element inside the dialog, the
	 * body, and a disconnected node are all "not where the user was", so they leave
	 * the previous answer standing. That is the difference between this and the
	 * transition capture it replaces — Radix moves focus into the dialog as it opens
	 * (instrumented: a `focus()` on the first account row, inside `[role=dialog]`), so
	 * a capture taken then recorded the DIALOG and the dismissal had nothing to hand
	 * back (UX round 3, U6). The body is the same trap in a different direction: it is
	 * what Radix returns focus to, and restoring to it is what "the caret went nowhere"
	 * measured as.
	 */
	const recordFocus = useCallback((element: Element | null) => {
		if (
			element instanceof HTMLElement &&
			element !== document.body &&
			!element.closest("[role=dialog]")
		) {
			previousFocus.current = element;
		}
	}, []);

	useEffect(() => {
		if (!panelOpen) recordFocus(document.activeElement);
	});

	useEffect(() => {
		if (panelOpen) return;
		const onFocusIn = (event: FocusEvent) =>
			recordFocus(event.target as Element | null);
		document.addEventListener("focusin", onFocusIn);
		return () => document.removeEventListener("focusin", onFocusIn);
	}, [panelOpen, recordFocus]);

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
		if (element instanceof HTMLElement && element.isConnected) element.focus();
		// The capture is NOT consumed here. Radix dispatches its own
		// `autoFocusOnUnmount` inside a `setTimeout(0)`, so a close and a reopen in
		// the same tick would have the late call clear a capture the new opening had
		// just taken (agent review round 3, N3); leaving it in place makes the restore
		// idempotent and lets the next dismissal still hand the caret back. It is
		// replaced wholesale at the next open.
	}, []);

	/**
	 * Hand the caret back after the panel closes — sequenced, not raced.
	 *
	 * Radix moves focus to `<body>` as it unmounts the dialog, and it does that from
	 * its own zero-delay timer, so a restore that runs earlier is simply undone. The
	 * app's own dismissal handlers therefore schedule this rather than calling it: one
	 * frame, then one task, which is after the paint AND after Radix's timer. Measured
	 * on the unattended expiry with `HTMLElement.prototype.focus` instrumented: the
	 * only calls were Radix's own two (into the account row when the dialog opened,
	 * onto the ending's Close when it appeared), and none at the dismissal at all —
	 * the caret was left on `<body>` on every door (UX round 3, U6).
	 */
	const scheduleRestore = useCallback(() => {
		// Two nested tasks, and NO `requestAnimationFrame`: this app runs its rigs in
		// `--window-mode=headless`, where the page is never visible and rAF is
		// suspended — a chain that went through it never reached the restore at all
		// (measured: the instrumented tape showed no `focus()` call after the
		// dismissal, which is what "the caret went nowhere" looked like from inside).
		// The nesting is the sequencing: the inner task is queued after Radix's own.
		setTimeout(() => setTimeout(restoreFocus, 0), 0);
	}, [restoreFocus]);

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
			// Unconditional, deliberately. A guard that skipped the restore while
			// another panel was pending looked right and was wrong: Radix dispatches
			// this hook from its own timer, which can fire before React has committed
			// the render that closed the panel, so the guard read a stale "still open"
			// and the UNATTENDED expiry — the door UX round 3 filed U6 against — went on
			// leaving the caret on `<body>` (measured: `activeElement=BODY` on this very
			// check, while the queued door passed). Restoring when a new dialog is
			// already opening is harmless: Radix's focus trap takes the caret straight
			// back, which is what the queued door has always done.
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
				// The panel only closes if this was the last request; a queue that
				// advances keeps it up, and Radix holds the caret inside it.
				if (requests.length <= 1) scheduleRestore();
				answer(panel.request.requestId, null);
			}}
			onDismissEnding={() => {
				// An ending is only ever shown once nothing is answerable, so dismissing
				// it always closes the panel.
				scheduleRestore();
				setEnding(null);
			}}
			onCloseAutoFocus={handleCloseAutoFocus}
		/>
	);
};
