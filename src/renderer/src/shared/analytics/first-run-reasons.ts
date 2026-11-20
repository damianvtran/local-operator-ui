/**
 * The closed vocabularies the first-run funnel events report, in ONE file.
 *
 * WHY A FILE OF ITS OWN. Two branches instrument the same funnel at once
 * (first-run robustness and onboarding friction, 2026-11), and both need to say
 * why a send or a provider setup failed. A reason invented at each call site is
 * a second spelling of the same fact - "offline" here, "backend_down" there -
 * and a PostHog breakdown over two spellings is two funnels. Every reason a
 * product event may carry is declared here, and the events module's types only
 * accept these, so a new reason is a reviewed line in this file rather than a
 * string literal somewhere in a component.
 *
 * WHAT A REASON MAY CONTAIN: a category, never data. No message text, no error
 * sentence, no file path, no URL, no key, no model name the user typed. The
 * categorizers below read status codes and the transport classifier and return
 * one of the constants; they never pass a string through.
 */
import {
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_LOST_SIGHT_CODE,
	DESKTOP_REFUSAL_CODE,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
	SERVE_RELOAD_FENCE_CODE,
} from "../../../../shared/desktop-contract";
import { isTransientTransportFailure } from "../../../../shared/transport-failure";
import { DesktopControlError } from "../api/local-operator/desktop-api";

/** Why a chat message did not reach its session (`message_send_failed`). */
export const SEND_FAILURE_REASONS = [
	/** The local server is not attached (detached / wedged / never started). */
	"backend_unreachable",
	/** The request failed on the wire: refused, reset, DNS, timeout. */
	"transport",
	/** The app is not paired with the server it reached (401/403). */
	"unauthorized",
	/** The model provider needs credits or a plan the account lacks (402). */
	"insufficient_credits",
	/** The server or provider asked the app to slow down (429). */
	"rate_limited",
	/** The server refused this body before admitting it (400/409/413/422). */
	"refused",
	/** The conversation the message addressed no longer exists (404). */
	"conversation_gone",
	/** The server failed while handling the send (5xx). */
	"server_error",
	/**
	 * The server ANSWERED, but could not start or reach the session's runtime
	 * (`503 {"code": "runtime_unreachable"}`). Added 2026-11-20: before it, this
	 * answer was counted as `backend_unreachable`, an outage of a server that was
	 * demonstrably up. A missing provider or model arrives as this code too, with
	 * only the backend's sentence telling them apart - which this vocabulary never
	 * reads - so a configuration gap and a runtime crash both land here.
	 */
	"runtime_unavailable",
	/** Anything the categories above do not name. */
	"unknown",
] as const;
export type SendFailureReason = (typeof SEND_FAILURE_REASONS)[number];

/** Why a provider setup did not end connected (`provider_setup_failed`). */
export const PROVIDER_SETUP_FAILURE_REASONS = [
	"cancelled",
	"expired",
	"failed",
	"start_refused",
	"key_rejected",
	"transport",
	"backend_unreachable",
	"unknown",
] as const;
export type ProviderSetupFailureReason =
	(typeof PROVIDER_SETUP_FAILURE_REASONS)[number];

/** How a provider was being connected. */
export const PROVIDER_SETUP_METHODS = ["sign_in", "api_key"] as const;
export type ProviderSetupMethod = (typeof PROVIDER_SETUP_METHODS)[number];

/** The answer of a local-model reachability check (`local_model_check`). */
export const LOCAL_MODEL_CHECK_RESULTS = [
	"reachable",
	"unreachable",
	"error",
] as const;
export type LocalModelCheckResult = (typeof LOCAL_MODEL_CHECK_RESULTS)[number];

/** Why a local-model check did not answer reachable. */
export const LOCAL_MODEL_CHECK_REASONS = [
	"none",
	"not_answering",
	"backend_unreachable",
	"transport",
	"unknown",
] as const;
export type LocalModelCheckReason = (typeof LOCAL_MODEL_CHECK_REASONS)[number];

/** What happened to one onboarding tour step (`onboarding_tour_step`). */
export const TOUR_STEP_OUTCOMES = [
	"shown",
	/** Its target is not on screen, so the tour moved past it. */
	"skipped_missing_target",
	"completed",
	"cancelled",
] as const;
export type TourStepOutcome = (typeof TOUR_STEP_OUTCOMES)[number];

/**
 * Bucket an HTTP status into a send reason. Exposed on its own so a caller
 * that holds only a status (a store row's recorded code) answers the same way.
 */
export function sendFailureReasonForStatus(
	status: number | null,
): SendFailureReason {
	// `DesktopControlError.status` is null when the request never reached a
	// server at all (the IPC rejected, no response): that is the server being
	// unreachable, not a refusal.
	if (status === null) return "backend_unreachable";
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 402) return "insufficient_credits";
	if (status === 404) return "conversation_gone";
	if (status === 429) return "rate_limited";
	if (status === 503) return "backend_unreachable";
	if (status >= 500) return "server_error";
	if (status >= 400) return "refused";
	return "unknown";
}

/**
 * The reason category for a caught send failure.
 *
 * The helper the composer's catch calls (and the onboarding-friction branch's
 * send-again surface may call): it reads only the error's TYPE, status and
 * whether its text is a transport failure, and returns a constant.
 *
 * @param backendReachable pass the app's server-attached fact when the caller
 * has it: a send that failed while the server is detached is that, whatever the
 * wire said.
 */
export function categorizeSendFailure(
	error: unknown,
	backendReachable = true,
): SendFailureReason {
	if (!backendReachable) return "backend_unreachable";
	if (error instanceof DesktopControlError)
		return sendFailureReasonForStatus(error.status);
	if (isTransientTransportFailure(error)) return "transport";
	return "unknown";
}

/*
 * WHY `message_send_failed` CARRIES MORE THAN `reason_category` (2026-11-20).
 *
 * On 0.59.2 the event reported 6 `backend_unreachable` in a day, and the
 * composer's catch could not tell what that meant: `sendFailureReasonForStatus`
 * folds a null status AND every 503 into it, so main refusing to send for want
 * of a pairing token (`pairing.no-credential`, null status), a request that ran
 * out of its own budget (`deadline_exceeded`), and a daemon that answered but
 * could not reach the runtime (`runtime_unreachable`, 503 - how a missing
 * provider or model surfaces) all read as "the server is down". Every other 4xx
 * read as `refused`. The status and the structured code were on the error and
 * were thrown away, so a false outage was indistinguishable from a real one.
 *
 * The fix is additive: the exact status and the code ride as their own
 * properties, and `reason_category` is refined ONLY where the structured code
 * contradicts the status bucket. Everything without one of those codes keeps
 * the category it had, so the series continues.
 *
 * PII CONSTRAINT. Both new properties are closed allowlists, never a
 * pass-through: `DesktopControlError.code` is a string a backend chose, and a
 * future backend (or a plain `Error` with a `code` property) could put anything
 * there. A value off the list is reported as `other`, so the worst a hostile or
 * novel code can leak is the fact that it was novel. Message text is never
 * read - not even to recognise the no-provider sentence `failureCauseOf`
 * matches for the row's copy, because a sentence match is a guess that stops
 * matching when the core rewords it, and that guess must not become data.
 */

/** HTTP statuses `message_send_failed.http_status` reports as themselves. */
export const SEND_FAILURE_HTTP_STATUSES = [
	400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504,
] as const;
/**
 * A send failure's status: an allowlisted number, `none` when the request
 * never produced a response (null status, or not a `DesktopControlError`), and
 * `other` for any status off the list.
 */
export type SendFailureHttpStatus =
	| (typeof SEND_FAILURE_HTTP_STATUSES)[number]
	| "none"
	| "other";

/**
 * The structured codes `message_send_failed.error_code` reports as themselves.
 *
 * Built from the contract's own constants so a renamed code cannot drift away
 * from what the transport raises. These are the codes the send path's
 * transport and daemon can attach to a `DesktopControlError` (main's refusal
 * table, the deadline, the daemon's hop failure and its busy/retiring/reload
 * answers); any other is `other`, and an absent code is `none`.
 */
export const SEND_FAILURE_ERROR_CODES = [
	DESKTOP_REFUSAL_CODE.noCredential,
	DESKTOP_REFUSAL_CODE.refused,
	DESKTOP_REFUSAL_CODE.planeClosed,
	DESKTOP_REFUSAL_CODE.transportFailed,
	DESKTOP_REFUSAL_CODE.serverUpdating,
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
	SERVE_RELOAD_FENCE_CODE,
] as const;
export type SendFailureErrorCode =
	| (typeof SEND_FAILURE_ERROR_CODES)[number]
	| "none"
	| "other";

/** The properties `message_send_failed` carries; see the block above. */
export interface SendFailureDiagnosis {
	reason_category: SendFailureReason;
	http_status: SendFailureHttpStatus;
	error_code: SendFailureErrorCode;
}

function sendFailureHttpStatus(status: unknown): SendFailureHttpStatus {
	if (status === null || status === undefined) return "none";
	return (SEND_FAILURE_HTTP_STATUSES as readonly unknown[]).includes(status)
		? (status as SendFailureHttpStatus)
		: "other";
}

function sendFailureErrorCode(code: unknown): SendFailureErrorCode {
	if (code === null || code === undefined || code === "") return "none";
	return (SEND_FAILURE_ERROR_CODES as readonly unknown[]).includes(code)
		? (code as SendFailureErrorCode)
		: "other";
}

/**
 * Where a structured code proves the status bucket wrong, the category it
 * proves instead; `null` keeps the status bucket.
 *
 * Only codes whose meaning is fixed by this app's contract are here. The
 * pairing codes say the app is not paired (a configuration problem: the
 * daemon is there, this app holds no accepted token); the deadline and main's
 * transport failure are the wire, not the server; the hop failure is a server
 * that answered. The busy/retiring/reload codes keep their status bucket - a
 * category for them would be a new reading nobody has asked for yet, and
 * `error_code` already separates them.
 */
function reasonForCode(code: SendFailureErrorCode): SendFailureReason | null {
	switch (code) {
		case DESKTOP_REFUSAL_CODE.noCredential:
		case DESKTOP_REFUSAL_CODE.refused:
		case DESKTOP_REFUSAL_CODE.planeClosed:
			return "unauthorized";
		case DESKTOP_REFUSAL_CODE.transportFailed:
		case DESKTOP_DEADLINE_EXCEEDED_CODE:
			return "transport";
		case DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable:
			return "runtime_unavailable";
		default:
			return null;
	}
}

/**
 * Every property the composer's catch reports for a failed send.
 *
 * Reads only the error's type, status and code - never `message` - and every
 * value it returns is a member of a closed list above.
 */
export function diagnoseSendFailure(
	error: unknown,
	backendReachable = true,
): SendFailureDiagnosis {
	const base = categorizeSendFailure(error, backendReachable);
	if (!(error instanceof DesktopControlError))
		return { reason_category: base, http_status: "none", error_code: "none" };
	const error_code = sendFailureErrorCode(error.code);
	return {
		// A detached server outranks the code, as it does in `categorizeSendFailure`.
		reason_category: backendReachable
			? (reasonForCode(error_code) ?? base)
			: base,
		http_status: sendFailureHttpStatus(error.status),
		error_code,
	};
}

/** The reason category for a failed provider API-key save or sign-in start. */
export function categorizeProviderFailure(
	error: unknown,
	stage: "start" | "key",
): ProviderSetupFailureReason {
	const send = categorizeSendFailure(error);
	if (send === "transport") return "transport";
	if (send === "backend_unreachable") return "backend_unreachable";
	if (error instanceof DesktopControlError) {
		return stage === "key" ? "key_rejected" : "start_refused";
	}
	return "unknown";
}
