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
 * Where dismissals live.
 *
 * `localStorage`, like the app's other surface-local dismissals
 * (`transcript-display-mode.ts`, `sidebar-split.ts`): a dismissal is per
 * MACHINE, not per account, and must survive a restart without a backend
 * round trip.
 */
export const QUOTA_NOTICE_DISMISSAL_KEY =
	"local-operator.quota-notice.dismissed";

/**
 * The stored shape: PROVIDER -> the state the reader dismissed for it.
 *
 * A MAP rather than one string (review round 1, R1-M2 / U3 / D-N3). The single
 * slot had two defects that pull in opposite directions: dismissing provider B
 * overwrote provider A's dismissal (so two providers could not both stay
 * dismissed), and — the one that defeats the notice's purpose — nothing ever
 * cleared an entry when the account RECOVERED, so a reader who dismissed
 * `depleted` once never saw that warning again however many times the balance
 * ran dry. The map fixes the first; `advanceQuotaNoticeDismissals` fixes the
 * second by clearing an entry the moment its provider reads a different state.
 *
 * The value is the STATE, not a boolean, because that is what the re-arm rule
 * compares: a dismissal is a statement about the verdict the reader dismissed,
 * and only the state leaving that verdict re-arms it (the design's own "returns
 * when the state changes").
 */
export type QuotaNoticeDismissals = Record<string, string>;

/**
 * Parse the stored value into the map, or `{}`.
 *
 * `localStorage` is not a setter's path out, so a tampered, truncated or
 * legacy value (the pre-review format was `"provider\nstate"`) is judged HERE
 * rather than trusted from a type: anything that is not a JSON object of
 * string values reads as "nothing dismissed". Reading a corrupt store as
 * dismissals would hide a warning on the strength of garbage.
 */
export function parseQuotaNoticeDismissals(
	stored: unknown,
): QuotaNoticeDismissals {
	if (typeof stored !== "string" || stored.length === 0) return {};
	try {
		const parsed: unknown = JSON.parse(stored);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const out: QuotaNoticeDismissals = {};
		for (const [provider, state] of Object.entries(parsed)) {
			if (provider.length > 0 && typeof state === "string" && state.length > 0)
				out[provider] = state;
		}
		return out;
	} catch {
		return {};
	}
}

/** The stored dismissals, or `{}` when unreadable or absent. */
export function readQuotaNoticeDismissals(): QuotaNoticeDismissals {
	if (typeof window === "undefined") return {};
	try {
		return parseQuotaNoticeDismissals(
			window.localStorage.getItem(QUOTA_NOTICE_DISMISSAL_KEY),
		);
	} catch {
		/* Blocked storage: the dismissal then lives for this mount only. */
		return {};
	}
}

/** Persist the map; a blocked store keeps it for this mount only. */
export function writeQuotaNoticeDismissals(map: QuotaNoticeDismissals): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			QUOTA_NOTICE_DISMISSAL_KEY,
			JSON.stringify(map),
		);
	} catch {
		/* See readQuotaNoticeDismissals. */
	}
}

/** Whether this exact pair is dismissed by `map`. */
export function quotaNoticeDismissed(
	map: QuotaNoticeDismissals,
	provider: string,
	state: string,
): boolean {
	return provider.length > 0 && map[provider] === state;
}

/**
 * `map` advanced for one OBSERVED answer: the re-arm rule, in one place.
 *
 * Called with every fresh answer the hook sees — including the non-shown
 * states — for one provider:
 *
 * - the entry names a DIFFERENT state than the one just read: the verdict
 *   moved, so the dismissal is spent and the entry is REMOVED. This is what
 *   lets `depleted -> ok -> depleted` show the line again (R1-M2/U3): the `ok`
 *   answer clears the entry, and the second depletion has nothing to hide it.
 * - the entry names the SAME state: the reader dismissed this episode and it
 *   has not left it — the entry stays. Navigating away and back with the
 *   verdict unchanged is not a new episode.
 * - no entry: unchanged.
 *
 * Returns the SAME object when nothing changed, so a caller can use identity
 * to skip a write and a re-render.
 */
export function advanceQuotaNoticeDismissals(
	map: QuotaNoticeDismissals,
	provider: string,
	state: string,
): QuotaNoticeDismissals {
	if (provider.length === 0 || state.length === 0) return map;
	if (!(provider in map) || map[provider] === state) return map;
	const next = { ...map };
	delete next[provider];
	return next;
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
	"Sent. Check your inbox and spam folder.";

/**
 * What the press says while the op is in flight.
 *
 * The `sending` phase used to grey the button with no word at all (review U8 /
 * design N2: in-flight read like cooldown). It borrows the rate-limited
 * sentence's slot instead, so every phase that disables the control says why.
 */
export const QUOTA_RESEND_SENDING_SENTENCE = "Sending…";

/**
 * What the press says when it failed and can be tried again.
 *
 * The `retryable` arm used to reset to `idle` with NO sentence (review U1):
 * a press then looked ignored — the button flickered disabled and came back,
 * and nothing said whether a mail went out. One sentence in the same
 * `<output>` slot as the other outcomes, and the button stays offered.
 */
export const QUOTA_RESEND_FAILED_SENTENCE = "Could not send. Try again.";

/** What the press says when the server's own cooldown refused it. */
export const QUOTA_RESEND_RATE_LIMITED_SENTENCE =
	"Requested recently. Try again in about 2 minutes.";

/**
 * The resend press's own lifecycle. `degraded` is terminal for the mount: the
 * button cannot work here (see the classification below), so the line falls
 * back to the verification-page link it already carries.
 *
 * `failed` is the retryable arm: still offered, with the failure sentence
 * beside it (U1). Both `failed` and the cooldown arms are reset by the next
 * press or by the notice's state changing (U4 — a sentence must not outlive
 * the action it describes).
 */
export type QuotaResendState =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "sent"; until: number }
	| { kind: "rate_limited"; until: number }
	| { kind: "failed" }
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
			return {
				disabled: true,
				sentence: QUOTA_RESEND_SENDING_SENTENCE,
				offered: true,
			};
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
		case "failed":
			return {
				disabled: false,
				sentence: QUOTA_RESEND_FAILED_SENTENCE,
				offered: true,
			};
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

/*
 * THE REFRESH PRESS'S OWN CUE (review U2).
 *
 * "I topped up" and "I verified" are presses whose ANSWER is usually "still
 * the same": the route is cache-first with its own floor upstream (#2128), so
 * an immediate re-read often returns the verdict the user was trying to leave.
 * Silence there reads as a broken control — 20 samples of identical text — so
 * every settled outcome of the press gets a sentence, in the same `<output>`
 * slot the resend outcomes use.
 */
export const QUOTA_REFRESH_CHECKING_SENTENCE = "Checking…";
export const QUOTA_REFRESH_UNCHANGED_SENTENCE =
	"Checked just now — no change yet.";
export const QUOTA_REFRESH_FAILED_SENTENCE = "Could not check. Try again.";

/** The refresh press's phase, beside the resend press's. */
export type QuotaRefreshCue = "idle" | "checking" | "unchanged" | "failed";

/** The sentence for a cue, or null for `idle` (nothing to say). */
export function quotaRefreshSentence(cue: QuotaRefreshCue): string | null {
	switch (cue) {
		case "idle":
			return null;
		case "checking":
			return QUOTA_REFRESH_CHECKING_SENTENCE;
		case "unchanged":
			return QUOTA_REFRESH_UNCHANGED_SENTENCE;
		case "failed":
			return QUOTA_REFRESH_FAILED_SENTENCE;
	}
}

/**
 * The last settled resend episode per provider, surviving the mount (U8).
 *
 * WHY MODULE STATE RATHER THAN THE COMPONENT'S OWN. The resend press's answer
 * and the server's 120 s cooldown outlive the composer: QA's own sequence —
 * press Resend (200), open another chat, New chat — re-enabled the button and
 * let a second press through to a second request, where only the server's 429
 * stopped it. The composer's lifecycle is the wrong one for a fact about
 * (provider, mail) — and the sentence the press produced must survive the
 * remount for the same reason. One entry per provider, the same key space the
 * dismissal map uses, pruned on read once its deadline has passed so the map
 * cannot grow past the provider count.
 *
 * In-flight presses are deliberately NOT stored: a promise dies with the
 * component that called it, and a remount mid-flight should show the button
 * again (a live press is unobservable from here, so claiming one would be a
 * lie the user cannot clear).
 */
export type QuotaResendEpisode =
	| { kind: "sent"; until: number }
	| { kind: "rate_limited"; until: number }
	| { kind: "failed" };

const resendEpisodes = new Map<string, QuotaResendEpisode>();

/** Remember the press's settled outcome for a provider. */
export function rememberQuotaResendEpisode(
	provider: string,
	episode: QuotaResendEpisode,
): void {
	if (provider.length === 0) return;
	resendEpisodes.set(provider, episode);
}

/** The live episode for a provider, or null (`failed` never expires on its own). */
export function quotaResendEpisodeFor(
	provider: string,
	now: number,
): QuotaResendEpisode | null {
	if (provider.length === 0) return null;
	const episode = resendEpisodes.get(provider);
	if (!episode) return null;
	if (episode.kind !== "failed" && episode.until <= now) {
		/* Expired: read as gone, and dropped so the map tracks live episodes. */
		resendEpisodes.delete(provider);
		return null;
	}
	return episode;
}

/** A test seam, the one caller that may clear every provider's episode. */
export function __resetQuotaResendEpisodes(): void {
	resendEpisodes.clear();
}

/**
 * Drop a provider's episode. Called when the notice's state MOVES: the
 * remembered press outcome describes the episode that just ended, and keeping
 * it would re-adopt a sentence the state change had already cleared (review
 * U4 vs U8 — the two rules meet here, and this is the seam where they do not
 * contradict: a cooldown survives a REMOUNT, never a state change).
 */
export function forgetQuotaResendEpisode(provider: string): void {
	if (provider.length === 0) return;
	resendEpisodes.delete(provider);
}
