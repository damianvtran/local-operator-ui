/**
 * The "Request update" press flow, and the two hooks the doors call.
 *
 * ONE FLOW FOR BOTH DOORS. The board card's menu item and the detail header's
 * button both call {@link useRequestProjectUpdate}; the flow itself is a
 * module function so the two doors cannot fork on guards, copy or ids. The
 * button additionally subscribes to the shared store for its three visual
 * states ({@link useRequestUpdateState}); the menu item needs no state, because
 * the menu closes on select and the design deliberately puts no per-card state
 * on the board (design note §3.4).
 *
 * THE SEQUENCE, and why each guard sits where it does:
 *
 *  1. IN-FLIGHT, before anything: while a request for this project is pending,
 *     every press is ignored (no toast, no dial). The guard is shared, so a
 *     second door cannot start a second batch.
 *  2. COOLDOWN: a press inside the window sends NOTHING and explains itself
 *     with the cooldown sentence, computed at press time. The menu item stays
 *     enabled on purpose (a greyed item with no reason is a defect) - this
 *     branch is the reason.
 *  3. SEND: one `projects.request_update` op. The loading toast appears only
 *     if the answer has not arrived after 400 ms (a fast round trip never
 *     flashes a card), carrying the same stable id the result will use, so the
 *     result REPLACES it in place.
 *  4. ON ANSWER: the window is armed when delivered>=1 OR unconfirmed>=1 (the
 *     UX freeze condition - see `request-update.ts`), and the result toast is
 *     raised with an explicit duration: success rides the container default,
 *     the partial/all-failed/all-unconfirmed answers persist until dismissed,
 *     and the empty/cooldown answers get ~6 s.
 *  5. ON FAILURE: the route's own sentence is named, with the uncertainty kept
 *     ("could not be requested" - never "was not sent": a batch that timed out
 *     after some deliveries is exactly the case the wording must not deny).
 *     NO window is armed, so a retry is immediately possible.
 *
 * WHY THE SERVER'S COOLDOWN RE-ARMS THE LOCAL MAP: another client (or an agent)
 * can have asked first, in which case this press receives `state: "cooldown"`
 * and there is no local window to explain the button's `Requested` label or the
 * next press's sentence. Re-arming from `cooldown_remaining_s` keeps the two
 * doors honest against an answer the user did not produce themselves.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	dismissToast,
	showErrorToast,
	showInfoToast,
	showLoadingToast,
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { useCallback, useSyncExternalStore } from "react";
import type { DesktopProjectRequestUpdateResult } from "../../../../../shared/desktop-control-contract";
import { projectDisplayName } from "../project-model";
import {
	REQUEST_UPDATE_COOLDOWN_MS,
	REQUEST_UPDATE_LOADING_COPY,
	REQUEST_UPDATE_LOADING_DELAY_MS,
	REQUEST_UPDATE_TOAST_DURATION_MS,
	armRequestUpdateCooldown,
	beginRequestUpdate,
	endRequestUpdate,
	isRequestUpdateInFlight,
	requestUpdateCooldown,
	requestUpdateCooldownSentence,
	requestUpdateCooldownToastId,
	requestUpdateResultToast,
	requestUpdateSnapshot,
	requestUpdateToastId,
	subscribeRequestUpdate,
} from "../request-update";

/** What either door hands the flow: the row it was pressed on. */
export type RequestUpdateTarget = {
	id: string;
	name: string;
	title: string | null;
};

/** A message the route refused with, as a sentence that ends in punctuation. */
const endedSentence = (message: string): string =>
	/[.!?…]$/.test(message) ? message : `${message}.`;

/**
 * Arm the shared window from an answer: the route's own cooldown re-arms the
 * map (see the module comment), and a `sent` batch arms it when at least one
 * message went out OR at least one delivery could not be confirmed.
 */
function armFromAnswer(
	projectId: string,
	result: DesktopProjectRequestUpdateResult,
): void {
	const nowMs = Date.now();
	if (result.state === "cooldown") {
		const remainingMs = Math.max(0, result.cooldown_remaining_s ?? 0) * 1000;
		armRequestUpdateCooldown(
			projectId,
			nowMs - (REQUEST_UPDATE_COOLDOWN_MS - remainingMs),
			nowMs + remainingMs,
		);
		return;
	}
	if (
		result.state === "sent" &&
		(result.counts.delivered >= 1 || result.counts.unconfirmed >= 1)
	) {
		armRequestUpdateCooldown(
			projectId,
			nowMs,
			nowMs + REQUEST_UPDATE_COOLDOWN_MS,
		);
	}
}

/** The flow itself. Exported for the lane's tests, not for call sites. */
export async function sendRequestUpdate(
	target: RequestUpdateTarget,
): Promise<void> {
	const projectId = target.id;
	/* (1) One press at a time, per project, across BOTH doors. */
	if (isRequestUpdateInFlight(projectId)) return;
	/* (2) Inside the window: explain, send nothing. */
	const nowMs = Date.now();
	const cooldown = requestUpdateCooldown(projectId);
	if (cooldown && cooldown.untilMs > nowMs) {
		showInfoToast(
			requestUpdateCooldownSentence(
				projectDisplayName(target),
				cooldown.untilMs - nowMs,
			),
			{
				id: requestUpdateCooldownToastId(projectId),
				duration: REQUEST_UPDATE_TOAST_DURATION_MS,
			},
		);
		return;
	}

	beginRequestUpdate(projectId);
	const toastId = requestUpdateToastId(projectId);
	/* (3) The loading card is armed on a delay and REPLACED in place: it
	 * renders no close button, so it must never outlive the request it
	 * describes (a route failure replaces it like any other result). */
	let loadingShown = false;
	const loadingTimer = setTimeout(() => {
		loadingShown = true;
		showLoadingToast(REQUEST_UPDATE_LOADING_COPY, { id: toastId });
	}, REQUEST_UPDATE_LOADING_DELAY_MS);

	try {
		const result = await desktopResult<DesktopProjectRequestUpdateResult>({
			op: "projects.request_update",
			key: projectId,
		});
		armFromAnswer(projectId, result);
		const toast = requestUpdateResultToast(result);
		if (toast) {
			const options = {
				id: toastId,
				...(toast.duration !== undefined ? { duration: toast.duration } : {}),
			};
			switch (toast.variant) {
				case "success":
					showSuccessToast(toast.title, options);
					break;
				case "warning":
					showWarningToast(toast.title, options);
					break;
				case "error":
					showErrorToast(toast.title, options);
					break;
				default:
					showInfoToast(toast.title, options);
			}
		} else if (loadingShown) {
			/* No sentence arrived for a card already on screen: retire it rather
			 * than strand a spinner with no close button. Unreachable against
			 * the frozen vocabulary; the branch is what makes a future state
			 * unable to strand it. */
			dismissToast(toastId);
		}
	} catch (error) {
		const message =
			error instanceof Error && error.message.trim() !== ""
				? error.message.trim()
				: null;
		/* (5) Name the route's sentence, keep the uncertainty, no window. */
		showErrorToast(
			message
				? `Could not request updates: ${endedSentence(message)}`
				: "The request could not be confirmed.",
			{ id: toastId, duration: Number.POSITIVE_INFINITY },
		);
	} finally {
		clearTimeout(loadingTimer);
		endRequestUpdate(projectId);
	}
}

/** The door's action: fire the flow, keep React out of the way. */
export function useRequestProjectUpdate(): (
	target: RequestUpdateTarget,
) => void {
	return useCallback((target: RequestUpdateTarget) => {
		void sendRequestUpdate(target);
	}, []);
}

/**
 * The detail button's two visual states, read from the shared store.
 *
 * `sending` and `cooling` are DERIVED at render from the store's own records;
 * the snapshot (a version counter) is what makes the derivation re-run when an
 * answer arms or retires a window. The label speaks (`Requesting…`,
 * `Requested`), and the button is never `disabled`: focus must survive the
 * state change.
 */
export function useRequestUpdateState(projectId: string): {
	sending: boolean;
	cooling: boolean;
	/** The window's live remainder in ms, or `null` while idle. */
	cooldownRemainingMs: number | null;
} {
	useSyncExternalStore(
		subscribeRequestUpdate,
		requestUpdateSnapshot,
		requestUpdateSnapshot,
	);
	const sending = isRequestUpdateInFlight(projectId);
	const cooldown = requestUpdateCooldown(projectId);
	const remainingMs =
		cooldown !== undefined ? cooldown.untilMs - Date.now() : 0;
	const cooling = remainingMs > 0;
	return {
		sending,
		cooling,
		cooldownRemainingMs: cooling ? remainingMs : null,
	};
}
