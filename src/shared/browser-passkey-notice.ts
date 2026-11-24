/**
 * The passkey notice's wire shape, shared by main (which raises it) and the
 * renderer (which paints it).
 *
 * Design: docs/design/browser-challenges-and-passkeys.md section 3.6. Raising,
 * rate-limiting and attribution live in `src/main/browser/passkey-notice.ts`;
 * this file is only the part both sides must agree on, so the renderer imports no
 * main-process module.
 */

export type PasskeyCall = "create" | "get";

/**
 * How long a notice stays eligible to be shown, from the host's own `at`.
 * A notice about a request the user returned to minutes later would describe a
 * state that may be gone, so BOTH sides age it by this one number (main when it
 * projects, the renderer on its own clock, because nothing pushes a projection
 * at the moment of expiry).
 */
export const PASSKEY_NOTICE_TTL_MS = 120_000;

/** What the renderer is told. Every field is main's fact, none is page text:
 * `origin` is the requesting FRAME's browser-side origin, `ownerKind` is the
 * registry's record, and `at` is the host clock (also the notice's identity for
 * a dismissal or an open, so a click on a superseded notice is refused). */
export interface PasskeyNoticeView {
	tabId: number;
	/** The requesting frame's origin, `scheme://host[:port]`. */
	origin: string;
	/** The request came from a frame embedded in the page, not the page itself,
	 * so the site the user sees in the address bar is not the one that asked. */
	embedded: boolean;
	kind: PasskeyCall;
	/** Absent means the original pending notice. NotAllowedError is ambiguous:
	 * cancellation, unavailable credential and provider refusal share this name. */
	outcome?: "not-allowed";
	at: number;
	/** Who owns the tab, as the registry records it. */
	ownerKind: "user" | "agent";
	/** Signals for this tab dropped by the rate limit since the last notice. */
	suppressed: number;
}

/**
 * A pending authentication request, when a tab has one
 * (`main/browser/extensions/auth-request.ts`): a password manager's or the
 * platform's passkey prompt is live in an agent-driven tab a person engaged.
 * The tab is NOT held: `requestId` identifies THIS request, so a dismissal of an
 * earlier request's notice cannot touch a later one, and only the actions that
 * would destroy the request are refused (`close`, `navigate`, driving the
 * provider's own prompt document).
 */
export interface PendingAuthRequestView {
	requestId: string;
	tabId: number;
	/** When the request began (host clock): the notice's identity. */
	at: number;
	kind: "ceremony";
	/** Presentation only: the person closed the notice. */
	dismissed: boolean;
}
