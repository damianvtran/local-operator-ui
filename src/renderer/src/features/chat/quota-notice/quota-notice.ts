/**
 * @file quota-notice.ts
 * @description
 * The pure half of the pre-emptive "no quota" notice: which wire states show
 * it, the locally stored dismissal's signature, and the resend button's
 * classification, phases and copy.
 *
 * WHY THIS SURFACE EXISTS. An empty session's first send can be refused for a
 * reason the user could have seen BEFORE typing: the account behind the
 * selected model has no credit left, or its plan window is spent. The backend
 * answers that as a verdict on `GET /v1/desktop/quota-notice` (the sibling
 * core PRs), including the sentence and the calls to action, so NOTHING here
 * authors copy for a wire state. What is local to the renderer, and therefore
 * what this module owns: the states that are shown, a dismissal that must
 * survive a restart, and the resend action's own phases (`signup.resend` is a
 * proxy op the notice offers; see `desktop_radient.py`'s refusal mapping).
 *
 * WHY A MODULE RATHER THAN CALL-SITE EXPRESSIONS. The dismissal signature is
 * the storage FORMAT, and the read and the write have to agree on it forever;
 * the resend classification is what keeps a 429 ("requested recently") from
 * being read as a dead credential, and one home for it is what stops a second
 * surface from classifying its own way. Both rules are testable without a
 * React tree, which is why they live here rather than in the hook.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type {
	QuotaNotice,
	QuotaNoticeAction,
} from "../../../../../shared/desktop-contract";

/**
 * The wire states that make the line visible.
 *
 * A POSITIVE LIST rather than "not ok/unknown", deliberately: the wire adds
 * diagnostic states over time (`ok`, `unknown` and `not_applicable` are all
 * "show nothing"), and a future state must not start showing a notice merely
 * because it is not one of those three. The three here are the ones the core
 * verdict produces with copy and actions attached.
 */
export const QUOTA_NOTICE_SHOWN_STATES = [
	"depleted",
	"limit_reached",
	"unverified",
] as const;

export type QuotaNoticeShownState = (typeof QUOTA_NOTICE_SHOWN_STATES)[number];

/** Whether this answer is one the line shows, and its state if so. */
export function quotaNoticeShows(
	notice: QuotaNotice | null | undefined,
): notice is QuotaNotice & { state: QuotaNoticeShownState } {
	return (
		notice !== null &&
		notice !== undefined &&
		(QUOTA_NOTICE_SHOWN_STATES as readonly string[]).includes(notice.state)
	);
}

/**
 * Where a dismissal lives.
 *
 * `localStorage`, like the app's other surface-local dismissals
 * (`transcript-display-mode.ts`, `sidebar-split.ts`): the dismissal is per
 * MACHINE, not per account, and must survive a restart without a backend
 * round trip.
 */
export const QUOTA_NOTICE_DISMISSAL_KEY =
	"local-operator.quota-notice.dismissed";

/**
 * The signature of one dismissible state: provider and state, newline-joined.
 *
 * THE KEY IS (provider, state), NOT A BOOLEAN, following `builtin-offer.ts`'s
 * precedent: a dismissal is a statement about the state the reader dismissed,
 * so a DIFFERENT state re-arms the line — that is "the notice returns when the
 * state changes", and it needs no code beyond this signature's identity. The
 * newline separator is the same collision guard that module states: no
 * provider id or wire state carries a newline, so two pairs cannot fold into
 * one string.
 */
export const quotaNoticeSignature = (provider: string, state: string): string =>
	`${provider}\n${state}`;

/**
 * Whether the stored value dismisses THIS signature.
 *
 * The read side validates as it decides: the value arrives from
 * `localStorage`, which is not a setter's path out, so a tampered or
 * hand-edited value is judged HERE rather than trusted from a type. The empty
 * guard is the degenerate case: with no notice on screen there is no state to
 * have dismissed, so a stored `""` must not read as one.
 */
export const quotaNoticeDismissed = (
	stored: unknown,
	signature: string,
): boolean =>
	typeof stored === "string" && signature.length > 0 && stored === signature;

/** The stored dismissal, or null when unreadable or absent. */
export function readQuotaNoticeDismissal(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem(QUOTA_NOTICE_DISMISSAL_KEY);
	} catch {
		/* Blocked storage: the dismissal then lives for this mount only. */
		return null;
	}
}

/** Persist one dismissal; a blocked store keeps it for this mount only. */
export function writeQuotaNoticeDismissal(signature: string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(QUOTA_NOTICE_DISMISSAL_KEY, signature);
	} catch {
		/* See readQuotaNoticeDismissal. */
	}
}

/*
 * `signup.resend`'s refusal vocabulary, as `desktop_radient.py` states it.
 *
 * Local constants rather than an imported bag, the same shape
 * `use-radient-user-query.ts` uses for the account codes: the only consumer is
 * `classifyResendFailure` below, so a second surface cannot match on a
 * prefix of its own.
 */
const RESEND_RATE_LIMITED_CODE = "signup_resend_rate_limited";
const RESEND_NOTHING_TO_RESEND_CODE = "signup_resend_nothing_to_resend";
const RADIENT_NO_CREDENTIAL_CODE = "radient_no_credential";
const RADIENT_CREDENTIAL_REFUSED_CODE = "radient_credential_refused";

/**
 * How long the resend press stays spent, whether it succeeded or was refused
 * for being too recent.
 *
 * The design's own number (120 s), and deliberately the SERVER'S cadence rather
 * than a client invention: the upstream allows one link per 2 minutes per
 * account, so a press inside the window could only earn the same 429. The
 * client-side cooldown is a courtesy, never the defence — the server's limits
 * are authoritative.
 */
export const QUOTA_RESEND_COOLDOWN_MS = 120_000;

/** What the press says after the server took it. */
export const QUOTA_RESEND_SENT_SENTENCE =
	"Sent. Check your inbox and spam folder";

/** What the press says when the server's own cooldown refused it. */
export const QUOTA_RESEND_RATE_LIMITED_SENTENCE =
	"Requested recently. Try again in about 2 minutes.";

/**
 * The resend press's own lifecycle. `degraded` is terminal for the mount: the
 * button cannot work here (see the classification below), so the line falls
 * back to the verification-page link it already carries.
 */
export type QuotaResendState =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "sent"; until: number }
	| { kind: "rate_limited"; until: number }
	| { kind: "degraded" };

/**
 * What a FAILED resend means, by the code the backend put on it.
 *
 * Classified on `code`, never on status (`DESKTOP_CONTROLS.md`: "every refusal
 * of that proxy answers {code, message, details} in detail, and code is what
 * separates the remedies").
 *
 * - `rate_limited`: the credential WORKED and the server's cooldown refused a
 *   second mail; the remedy is the sentence below, and it must never read as
 *   "sign in again" — which is exactly the reading the core's own refusal
 *   mapping exists to prevent.
 * - `nothing_to_resend`: no ticket is waiting — the account verified, or never
 *   had a grant. The caller re-reads the notice, which is where the verified,
 *   no-grant copy lives (one authority: the server authors it).
 * - `degraded`: the button cannot work here. Two causes, one remedy: an
 *   OLDER BACKEND answers an op it does not know with a masked 422 ("The
 *   request has invalid fields."), and an API-key credential is refused by the
 *   upstream route, which accepts a Radient OAuth JWT only (401/403, and the
 *   proxy's own `radient_no_credential`). Both fall back to the
 *   verification-page link the notice already offers.
 * - `retryable`: anything else (a transport blip, `radient_upstream_failed`, a
 *   pairing refusal that is not the account's). Pressing again is the remedy,
 *   so the button stays.
 */
export type QuotaResendFailure =
	| { kind: "rate_limited" }
	| { kind: "nothing_to_resend" }
	| { kind: "degraded" }
	| { kind: "retryable" };

export function classifyResendFailure(error: unknown): QuotaResendFailure {
	if (error instanceof DesktopControlError) {
		if (error.code === RESEND_RATE_LIMITED_CODE)
			return { kind: "rate_limited" };
		if (error.code === RESEND_NOTHING_TO_RESEND_CODE)
			return { kind: "nothing_to_resend" };
		if (
			/*
			 * A masked 422 is the older backend's answer to the op itself; the
			 * two codes are the account's credential being unusable for this
			 * route. The desktop plane's own refusals (a pairing code, a 503)
			 * are NOT here on purpose: those prove nothing about the account.
			 */
			error.status === 422 ||
			error.code === RADIENT_CREDENTIAL_REFUSED_CODE ||
			error.code === RADIENT_NO_CREDENTIAL_CODE
		)
			return { kind: "degraded" };
	}
	return { kind: "retryable" };
}

/** The resend affordance's rendered facts for one instant. */
export type QuotaResendView = {
	/** The press is in flight, or inside a cooldown: the button stays disabled. */
	disabled: boolean;
	/** The one sentence the phase shows beside the button, or none. */
	sentence: string | null;
	/** Whether the resend action is offered at all (false after a degrade). */
	offered: boolean;
};

/**
 * Derive the rendered resend facts. Pure over `now` so the 120 s deadlines are
 * testable without waiting them out: an expired state reads exactly as `idle`.
 */
export function quotaResendView(
	state: QuotaResendState,
	now: number,
): QuotaResendView {
	switch (state.kind) {
		case "idle":
			return { disabled: false, sentence: null, offered: true };
		case "sending":
			return { disabled: true, sentence: null, offered: true };
		case "sent":
			return state.until > now
				? {
						disabled: true,
						sentence: QUOTA_RESEND_SENT_SENTENCE,
						offered: true,
					}
				: { disabled: false, sentence: null, offered: true };
		case "rate_limited":
			return state.until > now
				? {
						disabled: true,
						sentence: QUOTA_RESEND_RATE_LIMITED_SENTENCE,
						offered: true,
					}
				: { disabled: false, sentence: null, offered: true };
		case "degraded":
			return { disabled: false, sentence: null, offered: false };
	}
}

/**
 * The actions to render: the wire's, minus a resend the line has degraded.
 *
 * A filter rather than a per-action branch at the call site, so the ONE rule —
 * the local degrade removes exactly the resend offer, and nothing else — is
 * stated where it can be tested. The verification-page `open_url` action is
 * deliberately kept: it is the fallback the degrade degrades TO.
 */
export function quotaNoticeActions(
	actions: readonly QuotaNoticeAction[],
	resendOffered: boolean,
): QuotaNoticeAction[] {
	return actions.filter(
		(action) => action.id !== "resend_verification" || resendOffered,
	);
}
