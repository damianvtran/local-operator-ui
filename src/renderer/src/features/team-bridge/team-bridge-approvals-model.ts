/**
 * Team Bridge approvals: the pure rules behind the Requests panel, the nav
 * badge and the Touch ID prompt notice.
 *
 * WHY THIS EXISTS. A teammate's agent can send this operator an approval
 * request. Before this surface the only way to answer one was its ask card, so
 * a pile of them could not be decided together and nobody could see what had
 * been decided (the production audit found approvals never used). The daemon
 * side shipped in local-operator #4099; this module holds the decisions the UI
 * makes on top of it, kept free of React so `scripts/team-bridge-approvals.test.mjs`
 * can run them from the shipped source.
 *
 * THE CONSTRAINTS IT ENCODES, each from #4099's "For the UI slice":
 * - A selection is the person's EXPLICIT list, at most 50 items (the route's
 *   `BATCH_MAX`); there is no "all" on the wire, only "every row I can see and
 *   may decide", capped.
 * - A row whose earlier signed decision the hub never confirmed
 *   (`unsent_decision`) is LOCKED to that word: offering the other one would be
 *   refused whole with `earlier_decision_unconfirmed`, and silently flipping a
 *   signed answer is exactly what that refusal prevents.
 * - The Touch ID prompt is raised by the daemon, and any local process holding
 *   the bearer can ask for one. The daemon publishes what each prompt would sign
 *   on the feed; this renderer labels a prompt it did not start "not started in
 *   this window". That label is the security control (security S-6). A
 *   `client_ref` counts as ours only while OUR authorize call is in flight and
 *   only for the first prompt that carries it (see `beginOwnPrompt`), because
 *   the ref is published on a feed any bearer holder can read and replay.
 * - No message body or screening rationale is ever shown: rows carry only the
 *   already-screened card `excerpt`, and refusals map to fixed copy rather than
 *   the daemon's sentence.
 */
import { currentLocale } from "../../../../i18n/locale";
import { t } from "../../../../i18n/messages";
import { TEAM_BRIDGE_APPROVAL_BATCH_MAX } from "../../../../shared/desktop-contract";
import type { TeamBridgeAuthorizeFramePayload } from "../../../../shared/desktop-session-contract";

export { TEAM_BRIDGE_APPROVAL_BATCH_MAX };

export type ApprovalWord = "approve" | "deny";

export type ApprovalRequestRow = {
	message_id: string;
	thread_id: string | null;
	created_at: string | null;
	excerpt: string | null;
	request: { state: string | null; expires_at: string | null };
	sender: {
		account_id: string | null;
		endpoint_id: string | null;
		name: string | null;
		email: string | null;
	};
	ask: { session_id: string; ask_id: string; status: string } | null;
	decidable: boolean;
	unsent_decision: ApprovalWord | null;
};

export type ApprovalRequestsPage = {
	tenant_id: string;
	items: ApprovalRequestRow[];
	pending_count: number;
	next_cursor: string | null;
	has_more: boolean;
};

export type ApprovalDecisionRow = {
	request_id: string;
	thread_id: string | null;
	decision: string | null;
	decided_at: string | null;
	requested_by: Person;
	decided_by: Person;
	decided_via_claimed: string | null;
	ask_id: string | null;
};

type Person = {
	account_id: string | null;
	name: string | null;
	email: string | null;
};

export type ApprovalDecideResult = {
	message_id: string;
	decision: ApprovalWord;
	sent: boolean;
	ask_settled: boolean;
	status?: string;
	error?: string;
};

export type ApprovalSelectionItem = {
	message_id: string;
	decision: ApprovalWord;
};

// -- the nav badge ------------------------------------------------------------

/**
 * "1 request waiting" / "N requests waiting" (agent-server docs/TEAM-BRIDGE.md
 * §2.5 `request.badge`: "waiting", not "pending approvals"; singular and plural
 * from ONE label function, D33). Zero has no label: a quiet row shows nothing.
 */
export function requestsWaitingLabel(count: number): string | null {
	if (!Number.isFinite(count) || count <= 0) return null;
	return t("ui.teamBridge.approvals.waiting", { count });
}

// -- what a row allows --------------------------------------------------------

/** Why a listed request cannot be decided here; `null` when it can. */
export type NotDecidableReason = "no_card" | "not_open";

export function notDecidableReason(
	row: ApprovalRequestRow,
): NotDecidableReason | null {
	if (row.decidable) return null;
	// No local ask: the request reached the hub but no card was raised on THIS
	// device (another device holds it, or this device's screener did not admit
	// it - a HELD message is listed, and decided, in the "Held messages"
	// section below, never here). Otherwise the card exists but is not open
	// (snoozed, expired, cancelled).
	return row.ask === null ? "no_card" : "not_open";
}

/**
 * The words a row may be decided with. A locked row (`unsent_decision`) offers
 * ONLY its signed word; a non-decidable row offers none.
 */
export function allowedWords(row: ApprovalRequestRow): ApprovalWord[] {
	if (!row.decidable) return [];
	if (row.unsent_decision) return [row.unsent_decision];
	return ["approve", "deny"];
}

export function rowAllows(
	row: ApprovalRequestRow,
	word: ApprovalWord,
): boolean {
	return allowedWords(row).includes(word);
}

/** Rows a checkbox may be drawn for: decidable ones only. */
export function selectableRows(rows: readonly ApprovalRequestRow[]) {
	return rows.filter((row) => row.decidable);
}

/**
 * Toggle one id in a selection, refusing to grow it past the batch cap. The
 * cap is enforced HERE, at the moment of selection, so the person never builds
 * a selection the route would refuse by size; `capped` tells the panel to say
 * why the click did nothing.
 */
export function toggleSelected(
	selected: ReadonlySet<string>,
	messageId: string,
): { next: Set<string>; capped: boolean } {
	const next = new Set(selected);
	if (next.has(messageId)) {
		next.delete(messageId);
		return { next, capped: false };
	}
	if (next.size >= TEAM_BRIDGE_APPROVAL_BATCH_MAX)
		return { next, capped: true };
	next.add(messageId);
	return { next, capped: false };
}

/**
 * "Select all" over what is listed: the first 50 decidable rows in list order,
 * never more. `capped` says some decidable rows were left out.
 */
export function selectAllDecidable(rows: readonly ApprovalRequestRow[]): {
	next: Set<string>;
	capped: boolean;
} {
	const decidable = selectableRows(rows);
	return {
		next: new Set(
			decidable
				.slice(0, TEAM_BRIDGE_APPROVAL_BATCH_MAX)
				.map((row) => row.message_id),
		),
		capped: decidable.length > TEAM_BRIDGE_APPROVAL_BATCH_MAX,
	};
}

/**
 * Build the wire selection for "Approve selected" / "Deny selected".
 *
 * Items whose row does not allow `word` (locked to the other word, or no
 * longer decidable after a refresh) are LEFT OUT and returned in `excluded`,
 * never re-worded: a batch must only ever carry the word the person pressed.
 * Rows that vanished from the list are dropped too. The result is capped at 50
 * even if a caller hands in more ids.
 */
export function buildSelection(
	rows: readonly ApprovalRequestRow[],
	selected: ReadonlySet<string>,
	word: ApprovalWord,
): { items: ApprovalSelectionItem[]; excluded: ApprovalRequestRow[] } {
	const items: ApprovalSelectionItem[] = [];
	const excluded: ApprovalRequestRow[] = [];
	for (const row of rows) {
		if (!selected.has(row.message_id)) continue;
		if (!rowAllows(row, word)) {
			excluded.push(row);
			continue;
		}
		if (items.length >= TEAM_BRIDGE_APPROVAL_BATCH_MAX) break;
		items.push({ message_id: row.message_id, decision: word });
	}
	return { items, excluded };
}

// -- client_ref: which prompts THIS renderer started --------------------------

/*
 * WHY A REF IS OURS ONLY WHILE OUR CALL IS IN FLIGHT, AND ONLY ONCE (security
 * S-1, agent review R1-01). The daemon echoes each `client_ref` verbatim on
 * `/v1/desktop/events`, which any local process holding the desktop bearer can
 * read, and the authorize route accepts any hex ref without checking it is
 * unique. A ref that stayed "ours" after its prompt (the earlier design kept
 * the last 32) could therefore be read off the feed and replayed with an
 * attacker's selection, and the notice would show no warning.
 *
 * So a ref is PENDING from just before our authorize call until that call
 * answers (`runApprovalFlow`'s `finally`), and the FIRST `prompting` frame that
 * carries it BINDS it to that frame's `authorize_id`. A frame is ours only if
 * its ref is pending and either unbound or bound to this same `authorize_id`.
 * The daemon's single-flight prompt gate means no other prompt can be up while
 * ours is pending, and the ref is not public until our own `prompting` frame
 * is published, so our frame is always the first to carry it; any later
 * prompt with that ref - before or after ours settles - is foreign.
 *
 * Failure direction: if a feed lag delivered our own `prompting` frame after
 * the call had answered, it would be labelled foreign. That errs toward the
 * warning, never toward silence. The ref is module state in THIS renderer,
 * never persisted or shared: a prompt started in another window is labelled
 * foreign there (known decision (b); moving it to main is a follow-up).
 */
const pendingRefs = new Map<string, string | null>();

function randomRef(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A fresh random `client_ref` (16 random bytes as 32 lowercase hex, the route's
 * own grammar `^[0-9a-f]{1,32}$`), registered as pending until `endOwnPrompt`.
 * Random rather than a counter so another process cannot predict the next one.
 */
export function beginOwnPrompt(): string {
	const ref = randomRef();
	pendingRefs.set(ref, null);
	return ref;
}

/** Retire a ref: no frame carrying it is ours from now on. */
export function endOwnPrompt(ref: string): void {
	pendingRefs.delete(ref);
}

/**
 * Whether the prompt `authorizeId` carrying `ref` is one this renderer
 * started. Binds a pending, unbound ref to the first `authorizeId` asked about,
 * which is why only `applyAuthorizeFrame` calls it, for `prompting` frames.
 */
function claimOwnPrompt(
	ref: string | null | undefined,
	authorizeId: string,
): boolean {
	if (typeof ref !== "string" || !pendingRefs.has(ref)) return false;
	const bound = pendingRefs.get(ref);
	if (bound === null) {
		pendingRefs.set(ref, authorizeId);
		return true;
	}
	return bound === authorizeId;
}

/*
 * A sentinel binding no frame can carry: `parseAuthorizeFrame` admits only
 * `authorize_id`s matching `ID_PATTERN` (1-128 chars), so the empty string
 * never equals one and a ref bound to it can never be claimed again.
 */
const RETIRED_REF = "";

/**
 * Feed dropped (security S-7 / review R2-01): our own `prompting` frame may
 * have been published while we were not listening, and the feed is live-only,
 * so it is never redelivered. An UNBOUND pending ref would then bind to the
 * first frame this renderer sees carrying it - which, after the drop, could be
 * a replay of the ref read off another subscription. Retiring every unbound
 * pending ref fails safe: the flow still ends it in its `finally`, and our
 * own frame, if it does arrive late, is labelled foreign (the warning side).
 * A ref already bound keeps its binding: that frame was seen, so it is ours.
 */
export function retireUnboundOwnRefs(): void {
	for (const [ref, bound] of pendingRefs)
		if (bound === null) pendingRefs.set(ref, RETIRED_REF);
}

/** Test seam: forget every pending ref. */
export function resetClientRefsForTests(): void {
	pendingRefs.clear();
}

// -- the prompt notice: live `team_bridge_authorize` frames -------------------

/** A frame item as the notice renders it; `word` is null when unrecognised. */
export type AuthorizeNoticeItem = {
	message_id: string;
	word: ApprovalWord | null;
	sender: string | null;
	excerpt: string | null;
};

export type AuthorizePromptNotice = {
	authorizeId: string;
	/** True when THIS renderer did not start the prompt: the security label. */
	foreign: boolean;
	approveCount: number;
	denyCount: number;
	items: AuthorizeNoticeItem[];
};

/** How a prompt this window did not start ended (UX review U7). */
export type ForeignPromptTrace = {
	authorizeId: string;
	count: number;
	ended: "signed" | "dismissed" | "refused";
	at: number;
};

const AUTHORIZE_STATES = new Set([
	"prompting",
	"signed",
	"dismissed",
	"refused",
]);
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function textOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parse a `team_bridge_authorize` payload at the feed boundary (security S-5):
 * the rest of this surface is "parsed, not cast", and the notice is the one
 * place a mis-read word would tell the person the opposite of what Touch ID
 * signs. A frame without a usable `authorize_id` or `state` is dropped (it
 * names no prompt). An item whose `word` is neither `approve` nor `deny` is
 * KEPT with `word: null` and rendered as an unrecognised decision, never
 * guessed: dropping it would hide something the sheet is about to sign.
 */
export type ParsedAuthorizeFrame = Omit<
	TeamBridgeAuthorizeFramePayload,
	"items"
> & { items: AuthorizeNoticeItem[] };

export function parseAuthorizeFrame(raw: unknown): ParsedAuthorizeFrame | null {
	if (!raw || typeof raw !== "object") return null;
	const frame = raw as Record<string, unknown>;
	const id = frame.authorize_id;
	const state = frame.state;
	if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
	if (typeof state !== "string" || !AUTHORIZE_STATES.has(state)) return null;
	const items = Array.isArray(frame.items) ? frame.items : [];
	return {
		authorize_id: id,
		client_ref: textOrNull(frame.client_ref),
		state: state as TeamBridgeAuthorizeFramePayload["state"],
		items: items
			.filter(
				(item): item is Record<string, unknown> =>
					!!item && typeof item === "object",
			)
			.map((item) => ({
				message_id: textOrNull(item.message_id) ?? "",
				word:
					item.word === "approve" || item.word === "deny" ? item.word : null,
				sender: textOrNull(item.sender),
				excerpt: textOrNull(item.excerpt),
			})),
	};
}

const prompting = new Map<string, AuthorizePromptNotice>();
let snapshot: AuthorizePromptNotice[] = [];
/*
 * Ended foreign prompts, newest first. A person who glanced away, or touched
 * the sensor out of habit, otherwise has nothing to show a prompt happened
 * (UX review U7). Five is a display ceiling: the panel shows them as lines,
 * and a burst beyond that is already the story.
 */
const TRACE_LIMIT = 5;
let traces: ForeignPromptTrace[] = [];
const listeners = new Set<() => void>();
let lastFrameKey: string | null = null;

function notify() {
	for (const listener of listeners) listener();
}

function noticeFromFrame(payload: ParsedAuthorizeFrame): AuthorizePromptNotice {
	const { items } = payload;
	return {
		authorizeId: payload.authorize_id,
		foreign: !claimOwnPrompt(payload.client_ref, payload.authorize_id),
		approveCount: items.filter((item) => item.word === "approve").length,
		denyCount: items.filter((item) => item.word === "deny").length,
		items,
	};
}

/**
 * Apply one feed frame. `prompting` shows a notice; every other state clears
 * the notice for that `authorize_id` (leaving a trace if it was foreign).
 * `frameKey` (`epoch:seq`) collapses the one delivery per mounted feed hook
 * into a single application, the way the avatar frame is applied. The raw
 * payload is parsed here, so a caller cannot skip the boundary check.
 */
export function applyAuthorizeFrame(raw: unknown, frameKey?: string): void {
	if (frameKey !== undefined) {
		if (frameKey === lastFrameKey) return;
		lastFrameKey = frameKey;
	}
	const payload = parseAuthorizeFrame(raw);
	if (!payload) return;
	if (payload.state === "prompting") {
		// A repeated `prompting` for a prompt already shown keeps its label: the
		// claim happened once, on first sight.
		if (!prompting.has(payload.authorize_id))
			prompting.set(payload.authorize_id, noticeFromFrame(payload));
	} else {
		const closed = prompting.get(payload.authorize_id);
		if (!closed) return;
		prompting.delete(payload.authorize_id);
		if (closed.foreign) {
			traces = [
				{
					authorizeId: closed.authorizeId,
					count: closed.items.length,
					ended: payload.state,
					at: Date.now(),
				},
				...traces,
			].slice(0, TRACE_LIMIT);
		}
	}
	snapshot = Array.from(prompting.values());
	notify();
}

/**
 * Feed reconnect: the feed is live-only and a prompt lasts seconds, so a
 * notice whose closing frame was lost would otherwise stand forever. The
 * caller clears on a dropped transport. No trace is left: how it ended is
 * unknown, and a guess would be a false record.
 */
export function clearAuthorizeNotices(): void {
	// Before the early return: a drop with no notice standing is exactly the
	// case where our own frame was the one lost.
	retireUnboundOwnRefs();
	if (prompting.size === 0) return;
	prompting.clear();
	snapshot = [];
	notify();
}

export function subscribeAuthorizeNotices(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function authorizeNoticesSnapshot(): AuthorizePromptNotice[] {
	return snapshot;
}

export function foreignPromptTraces(): ForeignPromptTrace[] {
	return traces;
}

export function dismissForeignPromptTrace(authorizeId: string): void {
	const next = traces.filter((trace) => trace.authorizeId !== authorizeId);
	if (next.length === traces.length) return;
	traces = next;
	notify();
}

/** Test seam: forget notices, traces and the dedupe key. */
export function resetAuthorizeNoticesForTests(): void {
	prompting.clear();
	snapshot = [];
	traces = [];
	lastFrameKey = null;
}

// -- refusals -> calm copy -----------------------------------------------------

export type ApprovalRefusal =
	| { kind: "in_flight"; message: string }
	| { kind: "cooldown"; message: string; retryAfterS: number }
	| {
			kind: "locked";
			message: string;
			items: Array<{ message_id: string; unsent_decision: ApprovalWord }>;
	  }
	| { kind: "presence_required"; message: string }
	| { kind: "dismissed"; message: string }
	| { kind: "expired"; message: string }
	| { kind: "challenge_limit"; message: string }
	| { kind: "unconfirmed"; message: string }
	| { kind: "other"; message: string };

type RefusalLike = {
	code?: string;
	status?: number | null;
	retryAfterMs?: number;
	detail?: unknown;
};

function refusalDetails(error: RefusalLike): Record<string, unknown> {
	const detail = error.detail;
	if (!detail || typeof detail !== "object") return {};
	const details = (detail as { details?: unknown }).details;
	return details && typeof details === "object"
		? (details as Record<string, unknown>)
		: {};
}

/**
 * Map an authorize/decide refusal to fixed, neutral copy.
 *
 * The daemon's own sentence is NOT shown: it is written for the API, and this
 * surface promises "nothing was decided" in one register. `names` resolves a
 * locked item's id to the sender shown on its row, so the copy can say WHICH
 * requests are locked rather than how many.
 *
 * `stage` says which call failed. A server or transport failure of the DECIDE
 * call (after Touch ID confirmed) may have reached the hub or not, and the row
 * re-reads as "not sent yet" if it did not: the copy says so (QA Q4) instead of
 * the generic line, which is for failures before anything could be sent.
 */
export function mapApprovalRefusal(
	error: unknown,
	names: (messageId: string) => string | null = () => null,
	stage: "authorize" | "decide" = "authorize",
): ApprovalRefusal {
	const e = (error ?? {}) as RefusalLike;
	const code = typeof e.code === "string" ? e.code : "";
	const details = refusalDetails(e);
	switch (code) {
		/* Refused before any prompt (#4099's per-process challenge ceiling), so
		   nothing was signed or sent (agent review R1-04). */
		case "operator_challenge_limit":
			return {
				kind: "challenge_limit",
				message: t("ui.teamBridge.approvals.refusal.challenge_limit"),
			};
		case "operator_prompt_in_flight":
			return {
				kind: "in_flight",
				message: t("ui.teamBridge.approvals.refusal.in_flight"),
			};
		case "operator_prompt_cooldown": {
			const raw = details.retry_after_s;
			const fromMs =
				typeof e.retryAfterMs === "number" ? e.retryAfterMs / 1000 : Number.NaN;
			const seconds = Math.max(
				1,
				Math.ceil(
					typeof raw === "number" && Number.isFinite(raw)
						? raw
						: Number.isFinite(fromMs)
							? fromMs
							: 5,
				),
			);
			return {
				kind: "cooldown",
				retryAfterS: seconds,
				message: t("ui.teamBridge.approvals.refusal.cooldown", { seconds }),
			};
		}
		case "earlier_decision_unconfirmed": {
			const items = (Array.isArray(details.items) ? details.items : [])
				.filter(
					(
						item,
					): item is { message_id: string; unsent_decision: ApprovalWord } =>
						!!item &&
						typeof item.message_id === "string" &&
						(item.unsent_decision === "approve" ||
							item.unsent_decision === "deny"),
				)
				.map((item) => ({
					message_id: item.message_id,
					unsent_decision: item.unsent_decision,
				}));
			const named = Array.from(
				new Set(
					items
						.map((item) => names(item.message_id))
						.filter((name): name is string => !!name),
				),
			);
			return {
				kind: "locked",
				items,
				message:
					named.length > 0
						? t("ui.teamBridge.approvals.refusal.locked_named", {
								count: items.length,
								names: joinNames(named),
							})
						: t("ui.teamBridge.approvals.refusal.locked"),
			};
		}
		case "operator_presence_required":
			return {
				kind: "presence_required",
				message: t("ui.teamBridge.approvals.refusal.presence_required"),
			};
		case "operator_signature_unavailable":
			return {
				kind: "dismissed",
				message: t("ui.teamBridge.approvals.refusal.dismissed"),
			};
		case "operator_signature_expired":
		case "operator_signature_invalid":
		case "operator_signature_required":
			return {
				kind: "expired",
				message: t("ui.teamBridge.approvals.refusal.expired"),
			};
		default: {
			const status = typeof e.status === "number" ? e.status : null;
			if (stage === "decide" && (status === null || status >= 500))
				return {
					kind: "unconfirmed",
					message: t("ui.teamBridge.approvals.refusal.unconfirmed"),
				};
			return {
				kind: "other",
				message: t("ui.teamBridge.approvals.refusal.other"),
			};
		}
	}
}

// -- per-item results ---------------------------------------------------------

export type ResultTone = "done" | "not_sent";

/** One decide result as a line the panel can render. */
export function resultLine(result: ApprovalDecideResult): {
	tone: ResultTone;
	label: string;
} {
	if (result.status === "approved")
		return {
			tone: "done",
			label: t("ui.teamBridge.approvals.result.approved"),
		};
	if (result.status === "denied")
		return { tone: "done", label: t("ui.teamBridge.approvals.result.denied") };
	switch (result.error) {
		case "request_already_decided":
		case "answered_on_card":
			return {
				tone: "done",
				label: t("ui.teamBridge.approvals.result.already_answered"),
			};
		case "no_open_ask":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.no_card"),
			};
		case "earlier_decision_unconfirmed":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.locked"),
			};
		case "messaging_unavailable":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.unconfirmed"),
			};
		/* The local authority fence refused the item before it was sent (#4099
		   `authority_fence`); each says what changed (QA Q5). */
		case "not_designated":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.not_designated"),
			};
		case "owner_changed":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.owner_changed"),
			};
		case "feature_off":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.feature_off"),
			};
		case "consent_revoked":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.consent_revoked"),
			};
		default:
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.not_sent"),
			};
	}
}

/** The display name for a row's sender: name, else email, else a fixed word. */
export function senderLabel(sender: {
	name: string | null;
	email: string | null;
}): string {
	return (
		sender.name || sender.email || t("ui.teamBridge.approvals.unknown_sender")
	);
}

/*
 * The renderer's TypeScript lib predates `Intl.ListFormat` (the same cast
 * `team-bridge-reactions.tsx` makes); Chromium has shipped it for years.
 */
type ListFormatCtor = new (
	locale: string,
	options: { style: "long"; type: "conjunction" },
) => { format: (items: readonly string[]) => string };

/**
 * Names joined the way a sentence lists people: "Lena and Omar", "Lena, Omar,
 * and Sam" in en, with each locale's own conjunction (copy review C6: a bare
 * ", " join read "the request from Lena, Omar").
 */
export function joinNames(names: readonly string[]): string {
	const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor })
		.ListFormat;
	if (!ListFormat) return names.join(", ");
	return new ListFormat(currentLocale(), {
		style: "long",
		type: "conjunction",
	}).format(names);
}

// -- what this machine remembers about its own decisions ----------------------

/**
 * What the panel captured about a request at the moment the person decided it:
 * the sender as their row showed them, the card's already-screened excerpt and
 * the chat session holding the card. Never a body or a rationale - the row
 * never had either.
 */
export type DecidedSnapshot = {
	sender: string;
	excerpt: string | null;
	sessionId: string | null;
};

/*
 * WHY THIS EXISTS (UX review U2). The hub's decision ledger carries who, which
 * word and when, but not WHAT was decided (by design: the ledger holds
 * references, never content), so two decisions on requests from one teammate
 * read identically. This renderer saw the excerpt when the person decided, so
 * it keeps it for the history rows of decisions made here.
 *
 * In memory only, for the life of this renderer: the excerpt is chat content,
 * and persisting it would put request text on disk outside the session log
 * that already owns it. A reload therefore shows history without excerpts,
 * which is the same as a decision made on another device. The bound is a
 * memory ceiling, not a behaviour: the history page shows at most 50 rows, so
 * 200 decisions in one sitting keep every visible row covered.
 */
const DECIDED_LIMIT = 200;
const decided = new Map<string, DecidedSnapshot>();
/*
 * The account the remembered excerpts were captured under (review R2-02).
 * The excerpts are chat content that account was shown; they go when the
 * account does - on a switch or a sign-out - the same moment its rows leave
 * the screen, rather than lingering in renderer memory until a reload.
 */
let decidedOwner: string | null = null;

/** Drop every remembered excerpt. */
export function forgetDecided(): void {
	decided.clear();
	decidedOwner = null;
}

/**
 * Keep the store only while `accountId` is the account it was written for;
 * `undefined` (signed out, or the account not yet resolved) forgets it too,
 * which errs toward losing an excerpt, never toward showing it to another
 * account.
 */
export function retainDecidedFor(accountId: string | undefined): void {
	if (accountId === undefined || accountId !== decidedOwner) forgetDecided();
	if (accountId !== undefined) decidedOwner = accountId;
}

export function rememberDecided(
	accountId: string,
	messageId: string,
	snapshot: DecidedSnapshot,
): void {
	/* A write for an account other than the store's owner is DROPPED, not
	   adopted (security S-8): a decide that settles after a switch still
	   carries the previous account, and adopting it would re-seed that
	   account's excerpts under the next one. The owner is set by
	   `retainDecidedFor` on every account transition, so a current account's
	   write always matches; only an ownerless store (cold start, sign-out)
	   adopts its first writer. */
	if (decidedOwner !== null && decidedOwner !== accountId) return;
	decidedOwner = accountId;
	decided.delete(messageId);
	decided.set(messageId, snapshot);
	while (decided.size > DECIDED_LIMIT) {
		const oldest = decided.keys().next().value;
		if (oldest === undefined) break;
		decided.delete(oldest);
	}
}

export function decidedSnapshot(messageId: string): DecidedSnapshot | null {
	return decided.get(messageId) ?? null;
}

/** Test seam. */
export function resetDecidedForTests(): void {
	forgetDecided();
}

// -- the authorize -> decide flow, without React ------------------------------

export type ApprovalFlowOutcome<P> =
	| { ok: true; results: ApprovalDecideResult[]; proof?: P }
	| { ok: false; error: unknown; stage: "authorize" | "decide" };

/**
 * Authorize once, then decide once with EXACTLY the proof the daemon returned.
 *
 * Kept out of the hook so the two properties a person relies on are testable
 * from the shipped source (agent review R1-05): nothing is retried (a second
 * Touch ID sheet must never appear that the person did not ask for), and the
 * proof is passed through untouched, with the same items and account the
 * authorize signed. The `client_ref` is registered as ours for exactly the
 * span of the authorize call and retired in `finally`, whatever happens
 * (security S-1).
 */
export async function runApprovalFlow<P>(deps: {
	accountId: string;
	items: ApprovalSelectionItem[];
	authorize: (
		accountId: string,
		items: ApprovalSelectionItem[],
		clientRef: string,
	) => Promise<{ operator_proof: P }>;
	decide: (
		accountId: string,
		items: ApprovalSelectionItem[],
		proof: P,
	) => Promise<ApprovalDecideResult[]>;
	onDeciding?: () => void;
}): Promise<ApprovalFlowOutcome<P>> {
	const { accountId, items } = deps;
	const clientRef = beginOwnPrompt();
	let proof: P;
	try {
		proof = (await deps.authorize(accountId, items, clientRef)).operator_proof;
	} catch (error) {
		return { ok: false, error, stage: "authorize" };
	} finally {
		// The prompt is over once authorize answers: the ref is never ours again.
		endOwnPrompt(clientRef);
	}
	deps.onDeciding?.();
	try {
		const results = await deps.decide(accountId, items, proof);
		return { ok: true, results };
	} catch (error) {
		return { ok: false, error, stage: "decide" };
	}
}

// -- the batch bar's preview ---------------------------------------------------

/**
 * What each batch button would send from the current selection, BEFORE the
 * person presses it (UX review U6): a locked row selected beside others is
 * left out of the other word, and the button says so ("Deny 1 of 2") rather
 * than reporting it afterwards.
 */
export function selectionPreview(
	rows: readonly ApprovalRequestRow[],
	selected: ReadonlySet<string>,
): Record<ApprovalWord, { send: number; left: number }> {
	const approve = buildSelection(rows, selected, "approve");
	const deny = buildSelection(rows, selected, "deny");
	return {
		approve: { send: approve.items.length, left: approve.excluded.length },
		deny: { send: deny.items.length, left: deny.excluded.length },
	};
}

/** "2 sent · 1 not sent": the counts for the Results heading (design D7). */
export function resultsSummary(results: readonly ApprovalDecideResult[]): {
	done: number;
	notSent: number;
} {
	let done = 0;
	for (const result of results) if (resultLine(result).tone === "done") done++;
	return { done, notSent: results.length - done };
}
