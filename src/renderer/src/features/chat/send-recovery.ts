/**
 * What the user can DO about a send that cannot happen, or one that failed.
 *
 * ## Why this module exists (onboarding friction, 2026-11)
 *
 * PostHog, 30 days of external desktop users: only 42% ever sent a message.
 * 62 users pressed "Send again" under a failed message and ~32 rage-clicked an
 * empty composer, some of them on the plain-text hint "Connect a provider to
 * send.", which was not a control. Two gaps sat under those numbers:
 *
 * 1. The composer said WHY it could not send only after a refused press, for
 *    five seconds, as text with no way out; and a backend that was not
 *    answering said nothing in the composer at all.
 * 2. A failed send's row offered "Send again" for causes a resend cannot fix:
 *    no provider configured, no model selected, or the app's own background
 *    service not answering. The classified sentence was there, the fix was
 *    not.
 *
 * Both surfaces now ask this one module, so the composer's pre-send line and
 * the failed row's remedy cannot name different fixes for the same cause.
 *
 * ## Where the facts come from
 *
 * - `noProvider` / `noModel` are `useProviderStatus()`'s verdict, the same
 *   gate that already disables Send.
 * - `serverOffline` is `useConnectivityStatus().isServerOnline === false`, the
 *   reading `ChatStatusStrip` already states at the top of the pane.
 * - For a FAILED send, the code the store kept (`draft.errorCode`) and the
 *   sentence it classified (`draft.error`). The three configuration sentences
 *   are the backend's VETTED startup reasons (core
 *   `session/runtime/launch.py::_ACTIONABLE_STARTUP_REASONS`), delivered as the
 *   `message` of a `runtime_unreachable` refusal with no code of their own.
 *   Matching their prefix is the contract the shipped app already relies on
 *   (`NO_PROVIDER_NOTICE` in `connect-provider-store.ts`); the core route's own
 *   comment says that prefix must keep rendering, so it is stable by design.
 *   Anything unmatched yields `null` and the row keeps its existing controls.
 */

import { NO_PROVIDER_NOTICE } from "@features/providers/connect-provider-store";
import { DESKTOP_REFUSAL_CODE } from "../../../../shared/desktop-contract";

/** The one fix a blocked or failed send is offered. */
export type SendRecovery = "connect_provider" | "choose_model" | "reconnect";

/** Why the composer cannot send right now, before any press. */
export type SendBlock = "offline" | "no_provider" | "no_model";

/*
 * `HostingUnknownError` and `ModelNotConfiguredError`, by the sentence the core
 * vets for them. Module-scope because biome's `useTopLevelRegex` is an error
 * in this repository.
 */
const HOSTING_UNKNOWN_NOTICE = /model provider is not recognised/;
const MODEL_NOT_CONFIGURED_NOTICE = /No model is selected for this session/;

/**
 * The composer's pre-send verdict.
 *
 * OFFLINE OUTRANKS the provider facts: with the background service down, the
 * provider census is a stale read (`useProviderStatus` reports nothing it could
 * not fetch), and "connect a provider" would send the user to a dialog that
 * cannot load either.
 */
export function sendBlockFor(input: {
	noProvider: boolean;
	noModel: boolean;
	serverOffline: boolean;
}): SendBlock | null {
	if (input.serverOffline) return "offline";
	if (input.noProvider) return "no_provider";
	if (input.noModel) return "no_model";
	return null;
}

/** The fix for a pre-send block: one to one, kept here so both surfaces agree. */
export function recoveryForBlock(block: SendBlock): SendRecovery {
	if (block === "offline") return "reconnect";
	if (block === "no_provider") return "connect_provider";
	return "choose_model";
}

/**
 * The fix for a send that FAILED, from the code and sentence the store kept,
 * with the composer's live verdict as the tie-breaker.
 *
 * The live verdict wins when it names a block: a row that failed for an unknown
 * reason while the service is down right now is fixed by reconnecting, not by
 * the same press again.
 */
export function recoveryForFailure(input: {
	code?: string;
	message?: string;
	block?: SendBlock | null;
}): SendRecovery | null {
	if (input.block) return recoveryForBlock(input.block);
	const message = input.message ?? "";
	if (NO_PROVIDER_NOTICE.test(message) || HOSTING_UNKNOWN_NOTICE.test(message))
		return "connect_provider";
	if (MODEL_NOT_CONFIGURED_NOTICE.test(message)) return "choose_model";
	/*
	 * `transport.failed` is main's verdict that the daemon did not answer at all;
	 * the reconnect IPC is the one control that re-dials it. Not
	 * `runtime_unreachable`: that is the daemon answering that ONE conversation's
	 * runtime could not be reached, which a re-dial of the daemon does not fix.
	 */
	if (input.code === DESKTOP_REFUSAL_CODE.transportFailed) return "reconnect";
	return null;
}

/**
 * Whether a failed row should still offer "Send again" beside the fix.
 *
 * A configuration cause makes the resend a guaranteed repeat of the same
 * failure until the fix is applied, so the row offers the fix INSTEAD; a
 * reconnect is offered BESIDE it, because once the service answers, the press
 * is exactly what the user wants and the request id makes it safe.
 */
export function keepsSendAgain(recovery: SendRecovery | null): boolean {
	return recovery === null || recovery === "reconnect";
}
