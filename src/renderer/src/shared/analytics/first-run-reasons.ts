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
