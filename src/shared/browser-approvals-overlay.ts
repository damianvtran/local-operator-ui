/**
 * S6b: the approvals card's trust boundary, in one module.
 *
 * WHY THIS FILE EXISTS. The card is the first purpose-built preload on a native
 * child view, so the surface it exposes is a security boundary rather than a
 * convenience. Both sides — the preload that exposes it and the main process
 * that consumes it — import from here, so a channel name or a decision enum
 * cannot be written twice and drift.
 *
 * EXACTLY TWO CHANNELS CROSS FROM THE CARD: `dismiss` and `decide`. The model
 * (what to paint) travels the other way through `executeJavaScript`, the same
 * seam S6a proved for the count; there is no model channel and no general
 * `ipcRenderer` in the document's world. `More options` and `Review all` are
 * local view changes, so two of the four card verbs never reach main at all.
 *
 * EVERY ACTION CARRIES THE `seq` IT WAS RENDERED FROM. Main drops an action
 * whose `seq` is not the model it last pushed (the S2 list's proven rule): a
 * click on a stale card cannot decide a request the user has not seen.
 */

/** Card → main: "close this card, decide nothing". */
export const APPROVALS_CARD_DISMISS_CHANNEL =
	"browser-approvals-card-dismiss" as const;

/** Card → main: "answer the request this card was rendered from". */
export const APPROVALS_CARD_DECIDE_CHANNEL =
	"browser-approvals-card-decide" as const;

/**
 * The five decisions the queue understands. The card may only ever name one of
 * these; main re-validates against the live entry, never against the card's
 * claim about the origin or the scope.
 */
export const APPROVALS_CARD_DECISIONS = [
	"once",
	"session",
	"site",
	"domain",
	"deny",
] as const;

export type ApprovalsCardDecision = (typeof APPROVALS_CARD_DECISIONS)[number];

export function isApprovalsCardDecision(
	value: unknown,
): value is ApprovalsCardDecision {
	return (
		typeof value === "string" &&
		(APPROVALS_CARD_DECISIONS as readonly string[]).includes(value)
	);
}

/** One live request, as the card paints it. */
export interface ApprovalsCardRequest {
	entryId: string;
	/** The exact origin, scheme/host/port preserved. */
	origin: string;
	/**
	 * The requester's DISPLAY label, resolved by the app renderer from the queue's
	 * `requesterSessionId` (the conversation title, or "An agent"). Never the
	 * queue's `requester` field, which is an authority boundary, and never
	 * `displayAuthority`, which is the requested site's host.
	 */
	requester: string;
	/** The locale-independent epoch the card turns into "Expires in 9 min". */
	expiresAt: number;
	/**
	 * The registrable domain the queue's broad grant would cover, present only
	 * when the entry carries one. The card omits the domain decision when it is
	 * absent (fail closed, the same rule the consent card follows).
	 */
	broadKey?: string;
}

/** The whole card document state. Text is resolved by the document's catalogue. */
export interface ApprovalsCardModel {
	v: 1;
	/** Monotonic per controller; every action echoes it. */
	seq: number;
	/** The resolved app locale and direction (UX U2: the card follows the app). */
	locale: string;
	dir: "ltr" | "rtl";
	theme: "light" | "dark";
	/**
	 * The app's exact palette name (`data-theme`), so the card paints in the
	 * user's palette rather than a mode default. Null means the mode default.
	 */
	palette: string | null;
	view: "request" | "list";
	/** Ask the document to focus its dialog after painting (explicit open only). */
	focus: boolean;
	count: number;
	busy: boolean;
	/** Present when the card has a request to show. */
	request: ApprovalsCardRequest | null;
	/** The live queue, oldest first; "Review all" renders this locally. */
	pending: ApprovalsCardRequest[];
	/** A failure the card must state inline; never implies success. */
	error: "stale" | "unavailable" | null;
}

/** The action payloads, shared by the preload and the main handler. */
export interface ApprovalsCardDismissPayload {
	seq: number;
	entryId: string;
}

export interface ApprovalsCardDecidePayload {
	seq: number;
	entryId: string;
	decision: ApprovalsCardDecision;
}

export const APPROVALS_CARD_MODEL_LIMITS = {
	entryId: 128,
	origin: 2048,
	requester: 256,
	pending: 20,
	totalBytes: 32 * 1024,
} as const;
