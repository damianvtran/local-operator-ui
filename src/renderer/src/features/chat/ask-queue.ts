/**
 * The queued-ask read model: what a session's asks are, what state each is in,
 * and what a surface may say about them.
 *
 * ## Why this is a module and not a few expressions in a component
 *
 * Three surfaces read the same queue - the bar above the composer, the panel it
 * expands into, and the outstanding-asks chip on the sidebar row - and two of
 * them have to agree on a count while the third draws the individual rows. The
 * backend's own design note (`docs/design/ask-nonblocking.md` §5) puts one
 * binding constraint on all of them: **no surface may say "notified" that it
 * cannot substantiate, and agent-is-working is never "waiting for you"**. A
 * sentence composed in three places is a sentence that drifts in two of them, so
 * every string and every classification lives here and the components only
 * paint.
 *
 * ## The two rules a reader of the wire owes
 *
 * 1. **Absence is not emptiness.** The backend publishes `asks` only while its
 *    non-blocking flag is on AND the frame actually carries a row; an empty list
 *    is published as absence. So `sessionAsks` returns `null` for "this backend
 *    does not do queued asks" and `[]` only when a frame really said so - and no
 *    caller may collapse the two, because an old backend must not grow an asks
 *    affordance that can never be satisfied.
 *
 * 2. **Presence of `asks` retires the legacy mirror.** For one release the
 *    backend also projects the head open ask through the OLD single slot
 *    (`pending_gate.kind === "ask"`) so a client that predates this one still
 *    sees the question. A client that DOES read `asks` must therefore ignore an
 *    ask-shaped `pending_gate` when `asks` is present, or the same question
 *    renders twice - once as the mirror card and once as a queue row. That rule
 *    is applied here (`legacyAskMirrorSuppressed`) rather than at each mount, so
 *    the chat page and the run pane cannot disagree about it.
 *
 * ## What this module deliberately does NOT do
 *
 * It never re-derives `status` from `expires_at`. A countdown is a rendered
 * reading of the clock, and this module will format one; but whether an answer is
 * still accepted, whether a row is late, and whether the response was delivered
 * are the BACKEND's fold over the ask log, and a client that recomputed them
 * would disagree with the model the moment the two clocks differ.
 */

import {
	DESKTOP_REFUSAL_PLACEHOLDER,
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import type {
	CanonicalFrontendState,
	PendingAsk,
	PendingDesktopGate,
} from "../../../../shared/desktop-session-contract";
import { COMPOSER_TEXTAREA_SELECTOR } from "./composer-field";
import { pressLandsOnOverlay } from "./keyboard-scopes";

/**
 * The statuses the backend's fold can produce, as the one place they are
 * enumerated for a renderer.
 *
 * A plain string on the wire rather than a union, on purpose: a newer backend
 * adding a state must degrade to "unknown" on an older client rather than fail
 * validation, which is the same reason every other wire enum in this app is read
 * as a string and classified (`windowKind`, `toolStatus`).
 */
export type AskStatus =
	| "open"
	| "answered"
	| "declined"
	| "timed_out"
	| "late"
	| "dismissed"
	| "expired";

/** Unknown statuses are their own case, never silently coerced into `open`. */
export const isKnownAskStatus = (status: string): status is AskStatus =>
	status === "open" ||
	status === "answered" ||
	status === "declined" ||
	status === "timed_out" ||
	status === "late" ||
	status === "dismissed" ||
	status === "expired";

/**
 * The session's asks, or `null` when this backend does not publish them.
 *
 * See rule 1 in the module note. The distinction is load-bearing at every mount:
 * `[]` draws the empty-state affordance, `null` draws nothing at all.
 */
export const sessionAsks = (
	frontend: Pick<CanonicalFrontendState, "asks"> | null | undefined,
): PendingAsk[] | null => {
	const asks = frontend?.asks;
	if (!Array.isArray(asks)) return null;
	return asks;
};

/**
 * Whether a backend that publishes `asks` would ALSO be mirroring the head ask
 * through the old single slot, for this frame.
 *
 * The negation is what a mount needs (rule 2 above): an ask-shaped `pending_gate`
 * is shown only when the queue is NOT on the wire.
 */
/**
 * The gate every reader should use, with the legacy-mirror rule applied ONCE.
 *
 * THE RULE (design §4, client rule N3): once `asks` is on the wire, an ask-shaped
 * `pending_gate` is the backend's one-release MIRROR of an ask already in `asks[]`.
 * An approval keeps the slot.
 *
 * WHY IT IS A FUNCTION AND NOT A HABIT. The rule was applied at the dock's render
 * and at nothing else, so four other readers kept consuming the mirrored gate: the
 * composer's `awaitingAnswer` named a gate answer instead of the ask lane's
 * sentence, `secretAnswer` REFUSED ALL TYPING while a mirrored secret ask waited,
 * `send`'s gate branch answered the mirror one question at a time by index (the
 * behaviour this feature replaces), and the working line said "the agent is parked
 * on you" about a queued ask (agent review round 1, F3). Each of those is the same
 * mistake made independently, which is what a shared derivation prevents.
 */
export const effectiveGate = (
	frontend:
		| Pick<CanonicalFrontendState, "asks" | "pending_gate">
		| null
		| undefined,
): PendingDesktopGate | null =>
	legacyAskMirrorSuppressed(frontend) ? null : (frontend?.pending_gate ?? null);

/**
 * The bar's announced name: the drawn sentence plus the control it offers.
 *
 * A PURE FUNCTION for the same reason `askBarText` is one (QA round 2, Q-3): the
 * full stop was being appended unconditionally, so a question that already ended
 * in one produced `...staging cluster.. Collapse.` - a stutter only visible on a
 * sentence the round-1 frame did not carry (it was a `?`-terminated question).
 * Keeping the composition here means a rig can assert it instead of a reviewer
 * having to open a specific story.
 */
/**
 * A sentence that already ends in terminal punctuation needs no second mark.
 *
 * Hoisted rather than inline: the lint rule is right that a regex literal inside a
 * function is rebuilt per call, and this one runs on every bar render.
 */
const ENDS_TERMINALLY = /[.!?]$/;

export const askBarLabel = (
	view: AskQueueView,
	expanded: boolean,
	nowMs: number,
): string => {
	const sentence = askBarText(view);
	const stop = ENDS_TERMINALLY.test(sentence) ? "" : ".";
	/*
	 * THE TWO NEW FACTS RIDE THE NAME TOO (UX round 1's U2, design round 1's D4).
	 * The paint carries a deadline span and a warning ink; neither reached the
	 * announced name, so a screen-reader user got neither of the facts this change
	 * exists to surface without expanding - the same defect the one-sentence rule
	 * above records as fixed for the count.
	 *
	 * The urgency WORD and the amber are read from ONE predicate (`view.urgent`) so
	 * the two readers cannot diverge, exactly as the deadline text is one function.
	 */
	const facts = [
		askBarDeadline(view, nowMs),
		view.urgent ? "Urgent" : null,
	].filter((fact): fact is string => fact !== null);
	const clause = facts.length > 0 ? ` ${facts.join(". ")}.` : "";
	return `${sentence}${stop}${clause} ${expanded ? "Collapse" : "Expand to answer"}.`;
};

/**
 * Whether the composer may ANSWER from this view at all.
 *
 * ONE PREDICATE FOR THE MODE, THE SWAP AND THE ROUTE (agent review round 3, F1 and
 * F3). They had come apart: the mode read a derived flag while the swap keyed on the
 * panel flag alone, so a queue that stopped being answerable under an OPEN panel
 * flipped the mode without swapping the buffers - the ask-buffer answer stayed in
 * the box and the next Enter posted it to the conversation.
 *
 * The head must be OPEN and answerable, and at least one of its questions must be
 * one a plaintext box may fill. A SECRET question is not: its value belongs in the
 * panel's masked field, so a secret-ONLY ask is deliberately NOT this mode - the
 * `askComposerHoldsSecret` state below refuses the box instead, because the failure
 * that matters there is the user typing a credential into a chat message.
 */
export const askComposerAnswers = (view: AskQueueView): boolean => {
	const head = view.head;
	if (head === null || !head.canAnswer) return false;
	return head.ask.questions.some((question) => question.secret !== true);
};

/**
 * Whether the head open ask can ONLY be answered in the panel's masked field.
 *
 * The composer refuses input in this state (the same refusal the blocking dock's
 * secret gate uses), rather than leaving an ordinary box that would carry the
 * credential into the transcript as a chat message.
 */
export const askComposerHoldsSecret = (view: AskQueueView): boolean => {
	const head = view.head;
	if (head === null || !head.canAnswer) return false;
	const questions = head.ask.questions;
	return questions.length > 0 && questions.every((q) => q.secret === true);
};

/** The ask lane's own surfaces, marked on the root `AskSurfaces` renders. */
export const ASK_SURFACE_SELECTOR = "[data-lo-ask-surfaces]";

/*
 * Re-exported so the claim's own contract is nameable from a rig: the composer box
 * is half of what this claim covers, and a test that had to guess its selector would
 * be asserting a string rather than the element.
 */
export { COMPOSER_TEXTAREA_SELECTOR };

/**
 * Whether a press landed somewhere the ask lane speaks for.
 *
 * `true` for the ask surfaces themselves, for the composer's own textarea (the box
 * this lane answers from, via `composer-field.ts` - the same module
 * `use-interrupt-on-escape.ts` asks), and for a target with no element (the body, a
 * synthetic event, an already-unmounted source).
 */
const pressIsOurs = (target: EventTarget | null): boolean => {
	const element = target as { closest?: (selector: string) => unknown } | null;
	if (typeof element?.closest !== "function") return true;
	return (
		element.closest(ASK_SURFACE_SELECTOR) !== null ||
		element.closest(COMPOSER_TEXTAREA_SELECTOR) !== null
	);
};

/**
 * Whether the ask surface should claim an Escape press.
 *
 * A PURE FUNCTION because it is the riskiest thing this feature does with the
 * keyboard and it had only walk-through evidence (agent review round 2 N-2, round 3
 * NIT-2). Every guard is a defect this feature shipped:
 *
 *  - `defaultPrevented` - a surface that already claimed the press keeps it;
 *  - `pressLandsOnOverlay` - an open dialog/menu/listbox owns its own keys, which is
 *    the measured `Cmd-K then Escape` case where the ask panel collapsed and the
 *    palette stayed open;
 *  - `pressIsOurs` - the claim is for the ask surfaces and the composer box, not the
 *    whole window. Without it, deeper owners that cancel on Escape without calling
 *    `preventDefault` (the directory indicator, the sidebar's search, the dictation
 *    cancel) both acted AND collapsed.
 */
export const askClaimsEscape = (event: {
	key: string;
	isComposing?: boolean;
	defaultPrevented?: boolean;
	target: EventTarget | null;
}): boolean => {
	if (event.key !== "Escape" || event.isComposing === true) return false;
	if (event.defaultPrevented === true) return false;
	if (pressLandsOnOverlay(event.target)) return false;
	return pressIsOurs(event.target);
};

export const legacyAskMirrorSuppressed = (
	frontend:
		| Pick<CanonicalFrontendState, "asks" | "pending_gate">
		| null
		| undefined,
): boolean =>
	sessionAsks(frontend) !== null && frontend?.pending_gate?.kind === "ask";

/**
 * One ask's presentation, as every surface reads it.
 *
 * `canAnswer`/`canDecline` are the backend's fold read through the two questions
 * a control actually asks: may an answer still be accepted, and is there anything
 * left to decline. A settled ask cannot be declined (`declined` is settled, and
 * `answered` is somebody else's answer), while a timed-out one can be answered
 * (that is the `late` path) and therefore can also be declined.
 *
 * `late` is TERMINAL, and confusing it with `timed_out` is the one mistake that
 * reads as a live control on a closed question: `late` means "the answer arrived
 * after the deadline and the model was told", so its row shows what was answered
 * and offers nothing to press.
 */
export type AskPresentation = {
	ask: PendingAsk;
	status: AskStatus | "unknown";
	/** The backend's own count of open asks is the badge's source; this is the per-row fact. */
	open: boolean;
	/**
	 * The ask is inside its own window: the agent is STILL WAITING on this one.
	 *
	 * The distinction this field exists for is the operator's own question of a
	 * surface ("does it tell me the agent is waiting versus has moved on"), and it
	 * is a COPY distinction rather than a liveness one: `open` below stays the
	 * BACKEND's outstanding set - `open` OR `timed_out` (`asks/store.py`'s
	 * `OUTSTANDING_STATUSES`), because a late answer still reaches the agent and
	 * every surface must keep offering the row. But a timed-out ask has had its
	 * deadline pass and the agent has walked past it, so a surface that called
	 * both "waiting" would be stating a fact the fold contradicts.
	 */
	waiting: boolean;
	/** The deadline passed and the agent moved on; a LATE answer still reaches it. */
	movedOn: boolean;
	canAnswer: boolean;
	canDecline: boolean;
	/** True for a row whose answer has been given but not yet delivered to the model. */
	delivering: boolean;
};

/**
 * A SETTLED ask's questions and the answers that landed, for a row to paint.
 *
 * Why a helper rather than the row reading `answers` itself: what a settled ask
 * must show is a FRAME - every question with what was answered for it, in the
 * ask's own order - and a row that zipped two collections at render time would
 * silently DROP a question whose answer never arrived (a decline, or a
 * partially-answered ask from the legacy incremental path) rather than saying so.
 * Questions with no answer come back with an EMPTY list, which is the caller's
 * cue to render "no answer given" instead of leaving a gap.
 *
 * A SECRET question's answer is `[<key>]` on the wire and is passed through
 * verbatim: the value only ever existed in the session's memory store, so there
 * is nothing else this could be - printing a value here would mean the backend
 * had put one on the wire, which it never does.
 */
export const askSettledAnswers = (
	ask: PendingAsk,
): { id: string; question: string; answers: string[] }[] =>
	ask.questions.map((question) => ({
		/*
		 * The ID travels WITH the text, not only inside it. Two questions in one ask
		 * may carry identical text (a clarification loop, a repeated field), and a
		 * caller keying rows on the sentence would collide them - a React key warning
		 * and a mis-pairing on reorder. `ask_id` is the identity everywhere else in
		 * this feature; the settled frame now has it too (agent review F7).
		 */
		id: question.id,
		question: question.question,
		answers: (ask.answers?.[question.id] ?? []).slice(),
	}));

/**
 * The wait a timeout row reports, in the backend's own units.
 *
 * A COPY of `harness/rows.gate_waited_text`, deliberately and exactly: the TUI
 * and the phone fold paint this sentence from that function, and a desktop row
 * that rounded differently would be a third answer to "how long did I leave the
 * agent waiting". The rule it exists for is that whatever a reader is told must
 * be the wait that ACTUALLY happened - so an absent or unreadable value says so
 * rather than rounding up to an hour.
 */
export const askWaitedText = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds <= 0) return "a while";
	if (seconds < 60) return `${Math.trunc(seconds)}s`;
	if (seconds < 3600) return `${Math.trunc(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.trunc(seconds / 3600)}h`;
	return `${Math.trunc(seconds / 86400)}d`;
};

/**
 * The one-liner for an `ask_response` receipt.
 *
 * Mirrors `harness/rows.ask_response_notice` verbatim for the same reason
 * `askWaitedText` mirrors its sibling: the TUI fold and the phone fold already
 * paint these sentences, and a third phrasing here would mean the same event
 * reads three ways depending on which surface a person happens to open.
 *
 * The three statuses stay distinguishable to a HUMAN even though they ride one
 * message type: a person reading back a conversation needs to know whether their
 * answer landed in time, landed late, or was a decline.
 */
export const askResponseSummary = (receipt: {
	askId: string;
	status: string;
}): string => {
	if (receipt.status === "declined")
		return `Ask ${receipt.askId} declined — the agent was told`;
	if (receipt.status === "late")
		return `Answered late — the agent was told (ask ${receipt.askId})`;
	return `Answered — delivering (ask ${receipt.askId})`;
};

/**
 * The one-liner for an `ask_timeout` receipt (`harness/rows.ask_timeout_notice`).
 *
 * It names BOTH halves on purpose: "timed out" alone reads as finished, and
 * "you can still answer" alone hides that the agent stopped waiting.
 */
export const askTimeoutSummary = (receipt: {
	askId: string;
	waitedS: number;
}): string =>
	`Timed out after ${askWaitedText(receipt.waitedS)} — the agent moved on; you can still answer (ask ${receipt.askId})`;

/**
 * The composer's placeholder while the ask surface is EXPANDED (design §5.0).
 *
 * It names the two facts the reader needs at that moment and neither alone: that
 * what they type is an ANSWER (not a message), and the one key that leaves the
 * mode. `Esc` is the right key to name because it is the collapse the bar
 * already offers, so the sentence describes a control that exists rather than
 * one this feature would have to add.
 *
 * The minimized and normal states keep each app's existing placeholder
 * unchanged, which is why this string is only ever supplied while expanded.
 */
export const ASK_COMPOSER_PLACEHOLDER =
	"Answering the agent's question — Esc to collapse";

/**
 * The bar's ONE sentence, drawn and announced (design §5.0).
 *
 * It lives in the copy contract rather than in the component for two reasons that
 * both bit this PR: the sentence and the accessible name diverged when they were
 * assembled separately (the bar painted "1 settled" beside a name that said "No
 * asks outstanding" - agent review F6, UX U3), and a string inside a component
 * that imports `@shared` cannot be asserted by a DOM-free rig.
 *
 * The question NAMED is the open head when there is one and the first settled row
 * otherwise. `view.head` stays "the head OPEN ask", because the composer's routing
 * reads it for `canAnswer`; the settled fallback lives here rather than moving that
 * field, which would put a settled ask under a branch that submits answers.
 */
export const askBarText = (view: AskQueueView): string => {
	// An absent queue and a published-but-empty one both draw nothing, and the
	// sentence says so rather than claiming a count it does not have.
	if (view.asks === null || view.rows.length === 0)
		return "No asks outstanding";
	const outstanding = view.waiting + view.movedOn;
	const lead =
		outstanding === 0
			? `${view.total} settled`
			: /*
				 * TRUNCATED: the split is knowable only for the rows this frame carries,
				 * and the wire's cap is what dropped the rest, so the bar states the
				 * backend's own OUTSTANDING tally instead of splitting a prefix as if it
				 * were the whole queue. "outstanding" is the app's existing word for the
				 * set (the panel's empty state, the sidebar's chip) and it claims neither
				 * half; the "showing N of M" clause beside it says what is on screen.
				 */
				view.truncated
				? `${view.open} outstanding`
				: askCountLabel(view.waiting, view.movedOn);
	const named = view.head?.ask ?? view.rows[0]?.ask ?? null;
	return named === null ? lead : `${lead} — ${askHeadline(named)}`;
};

const OPEN_STATUSES: ReadonlySet<string> = new Set(["open", "timed_out"]);

export const presentAsk = (ask: PendingAsk): AskPresentation => {
	const status = isKnownAskStatus(ask.status) ? ask.status : "unknown";
	const undecided = OPEN_STATUSES.has(status);
	return {
		ask,
		status,
		open: undecided,
		waiting: status === "open",
		movedOn: status === "timed_out",
		// Answerable while undecided - and that INCLUDES a timed-out ask, whose late
		// answer reaches the model rather than being refused client-side.
		canAnswer: undecided,
		// A decline is "no answer, decide yourself". It is only meaningful while
		// the ask is unsettled, and it is offered on a timed-out ask too: the
		// alternative to answering late is telling the agent to decide.
		canDecline: undecided,
		delivering: status === "answered" && ask.delivered !== true,
	};
};

/**
 * The queue, ordered and counted as the surfaces draw it.
 *
 * The order is the wire's own (open first, then newest) re-asserted rather than
 * trusted, because two frames from different publishers - the frontend state and
 * the aggregate route - are not required to agree on a list order, and a bar
 * whose head row moved under a finger is the one interaction the design note
 * names as unacceptable. `head` is therefore always the OLDEST open ask, matching
 * the legacy mirror's own choice, so the bar and the mirror name the same
 * question during the skew window.
 */
export type AskQueueView = {
	/** `null` when the backend does not publish asks at all. */
	asks: PendingAsk[] | null;
	rows: AskPresentation[];
	/**
	 * OUTSTANDING asks - the backend's own count when it published one.
	 *
	 * NOT "waiting": the backend's outstanding set is `open` OR `timed_out`
	 * (`asks/store.py`'s `OUTSTANDING_STATUSES`), because a late answer still
	 * reaches the agent. The split the bar prints is `waiting`/`movedOn` below.
	 */
	open: number;
	/** Asks still inside their window, from the rows this frame carries. */
	waiting: number;
	/** Asks whose deadline passed with the agent moving on, from the same rows. */
	movedOn: number;
	/**
	 * Whether any ask the bar COUNTS AS WAITING carries the backend's `urgent` flag.
	 *
	 * WAITING, NOT OUTSTANDING, and the difference is the whole point of the cue
	 * (UX round 1's U1, design round 1's D1 - the same defect found twice, from the
	 * pixels and from the flow). `open` deliberately includes `timed_out`, so
	 * scoping this to it let a MOVED-ON ask's stale urgency light the bar: in the
	 * mixed fixture the waiting ask was not urgent and the timed-out one was, so
	 * the amber was bought entirely by the ask the operator could no longer catch,
	 * and over a moved-on-only queue the glyph painted amber with no deadline at
	 * all and nothing on screen to explain it. Amber now means exactly "an ask you
	 * can still catch is urgent", which is the same set `soonestExpiryMs` reads.
	 *
	 * A moved-on-but-answerable ask has no urgency cue of its own on the bar, by
	 * design: its reading is the panel's (`Timed out - the agent moved on`), and
	 * the bar's one warning spend should not be spent on a deadline that has
	 * already passed.
	 */
	urgent: boolean;
	/**
	 * The soonest deadline among the WAITING asks, or null when none is readable.
	 *
	 * The collapsed bar's triage reading: the whole point is not to have to expand
	 * the panel to find out how long the user has, and the soonest deadline is the
	 * one that decides that. A moved-on ask has no deadline left to surface, which
	 * is why `waiting` scopes it.
	 */
	soonestExpiryMs: number | null;
	/** Total rows in this frame, which is NOT the queue length when truncated. */
	total: number;
	truncated: boolean;
	/**
	 * The oldest WAITING ask, else the oldest moved-on one, else null.
	 *
	 * Waiting first, deliberately. The head is what the bar NAMES, and the bar's
	 * lead sentence is now the waiting/moved-on split - so a head drawn from the
	 * moved-on set while a waiting ask existed would name the wrong question. The
	 * oldest-first rule inside each set is unchanged (see `compareAsks`): a head
	 * that jumped to each new arrival would move under a user's finger mid-tap.
	 */
	head: AskPresentation | null;
};

export const askQueueView = (
	frontend:
		| Pick<CanonicalFrontendState, "asks" | "asks_open" | "asks_truncated">
		| null
		| undefined,
): AskQueueView => {
	const asks = sessionAsks(frontend);
	if (asks === null)
		return {
			asks: null,
			rows: [],
			open: 0,
			waiting: 0,
			movedOn: 0,
			urgent: false,
			soonestExpiryMs: null,
			total: 0,
			truncated: false,
			head: null,
		};
	const rows = asks.map(presentAsk).sort(compareAsks);
	const open = rows.filter((row) => row.open).length;
	const waiting = rows.filter((row) => row.waiting).length;
	const movedOn = rows.filter((row) => row.movedOn).length;
	const deadlines = rows
		.filter((row) => row.waiting)
		.map((row) => Number(row.ask.expires_at ?? 0))
		.filter((value) => Number.isFinite(value) && value > 0);
	return {
		asks,
		rows,
		/*
		 * The backend's published count wins over the derived one, and the reason
		 * is the cap: the list is bounded on the wire (20 newest) and may be
		 * truncated, so counting the rows would quietly under-report the queue.
		 * The derived count is the fallback for a frame that carried rows but no
		 * count, which is the older producer's shape.
		 */
		open: typeof frontend?.asks_open === "number" ? frontend.asks_open : open,
		waiting,
		movedOn,
		/*
		 * URGENT IS THE WIRE'S OWN FLAG, PAINTED NOWHERE BEFORE THIS: an ask the
		 * backend derived a short window for (`timeout <= 900`) is one the operator
		 * should triage first, and until this field the desktop drew it identically
		 * to any other waiting row. Scoped to the OUTSTANDING rows - a settled ask's
		 * stale urgency is not a state anyone can act on.
		 */
		urgent: rows.some((row) => row.waiting && row.ask.urgent === true),
		soonestExpiryMs: deadlines.length > 0 ? Math.min(...deadlines) : null,
		total: rows.length,
		truncated: frontend?.asks_truncated === true,
		head:
			rows.find((row) => row.waiting) ??
			rows.find((row) => row.movedOn) ??
			null,
	};
};

/**
 * Open before settled, then oldest first inside each group.
 *
 * Oldest-first is the design note's own rule for the mirrored card
 * (`_sync_pending` names the OLDEST open ask, and its reasoning is that a card
 * that jumped to each new arrival would move under a user's finger mid-tap). The
 * list inherits it so the bar and the list cannot disagree about what "the head"
 * is.
 */
const compareAsks = (a: AskPresentation, b: AskPresentation): number => {
	if (a.open !== b.open) return a.open ? -1 : 1;
	const at = Number(a.ask.created_at ?? 0);
	const bt = Number(b.ask.created_at ?? 0);
	if (at !== bt) return at - bt;
	return a.ask.ask_id.localeCompare(b.ask.ask_id);
};

/**
 * The shared copy contract, one sentence per state (design §5).
 *
 * Every one of these is a claim the backend CAN substantiate, and the omissions
 * are the contract: none of them says "you were notified", because the backend
 * measures reach (a client is connected, a banner is possible) and never
 * delivery to a person. `timed_out` says both halves - the agent moved on AND the
 * ask is still answerable - because "timed out" alone reads as finished.
 */
export const ASK_STATUS_COPY: Record<AskStatus | "unknown", string> = {
	open: "Queued — the agent is continuing",
	answered: "Answered — delivering",
	timed_out: "Timed out — the agent moved on; you can still answer",
	late: "Answered late — the agent was told",
	declined: "Declined — the agent was told",
	dismissed: "Dismissed — no reply was sent",
	expired: "Expired — this ask is too old to answer; ask the agent again",
	unknown: "Waiting on an answer",
};

/**
 * The status sentence for a row, with the expiry reading appended while it is
 * still a live possibility.
 *
 * The countdown is the ONLY clock read a surface makes, and it is deliberately
 * not a status: it is rendered from `expires_at` on the client clock and says
 * nothing about whether an answer would be accepted (the backend's fold owns
 * that, which is why a row may read "expires in 2 m" and still be answerable a
 * moment later if its own frame has not caught up).
 */
export const askStatusText = (ask: PendingAsk, nowMs: number): string => {
	const presentation = presentAsk(ask);
	const base = ASK_STATUS_COPY[presentation.status];
	if (presentation.status !== "open") return base;
	const expiry = askExpiryText(ask, nowMs);
	return expiry === null ? base : `${base}; ${expiry}`;
};

/**
 * "expires in 42 m", or `null` when there is no usable deadline.
 *
 * A deadline that cannot be read says NOTHING rather than rounding to "expires
 * now": the backend's own `gate_waited_text` sets the same precedent for the
 * timeout row, and for the same reason - a countdown that guesses is worse than
 * no countdown when the reader is deciding whether to hurry.
 */
export const askExpiryText = (ask: PendingAsk, nowMs: number): string | null =>
	askDeadlineText(Number(ask.expires_at ?? 0), nowMs);

/**
 * The same reading for a bare deadline, for a surface that holds no ask.
 *
 * The minimized bar names the SOONEST deadline across the asks it is counting
 * rather than one row's (`view.soonestExpiryMs`), so the formatter has to take a
 * timestamp. Split out rather than duplicated: two renderings of one countdown
 * is the drift this module's copy contract exists to prevent.
 */
export const askDeadlineText = (
	expiresAt: number,
	nowMs: number,
): string | null => {
	if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
	const remainingMs = expiresAt - nowMs;
	if (remainingMs <= 0) return "expiring now";
	const minutes = Math.floor(remainingMs / 60_000);
	if (minutes < 1) return `expires in ${Math.floor(remainingMs / 1000)}s`;
	if (minutes < 60) return `expires in ${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `expires in ${hours}h`;
	return `expires in ${Math.floor(hours / 24)}d`;
};

/**
 * The deadline the COLLAPSED bar prints, or `null` when it must print none.
 *
 * THREE RULES, each one a defect the round found:
 *
 * 1. **The number belongs to the ask the sentence NAMES, or it says otherwise**
 *    (design round 1, D2). The bar names one question - the head - and prints a
 *    queue-scope reading (the soonest deadline across the WAITING asks); with two
 *    asks of different windows those diverge, and the bar named `Deploy the
 *    staging release?` beside the OTHER ask's `expires in 12m`. So the reading is
 *    prefixed with `soonest ` whenever it is not the named ask's own, and left
 *    bare when it is - which is the single-waiting-ask case by construction, and
 *    the common one.
 *
 * 2. **A TRUNCATED frame prints NO deadline** (design round 1, D6). `rows` is the
 *    wire's cap-20 prefix, so its soonest is the visible subset's soonest - with
 *    47 outstanding and an older hidden ask expiring first, the bar would read a
 *    later number than the queue's. A queue-scope countdown cannot be derived
 *    from a prefix, so this surface refuses to state one, exactly as the count
 *    refuses to split a prefix and falls back to the backend's tally. The
 *    `showing N of M` clause beside it is the disclosure.
 *
 * 3. **ONE COMPOSITION, TWO READERS** (agent review F6 / UX U3, then UX round 1's
 *    U2 and design round 1's D4): the visible span and the button's accessible
 *    name must carry the same facts. They did not - the deadline was added in the
 *    JSX alone, so a screen reader was told a state the screen was not in, which
 *    is the defect this component's own note records as fixed once already. Both
 *    readers now call THIS function.
 */
export const askBarDeadline = (
	view: AskQueueView,
	nowMs: number,
): string | null => {
	if (view.truncated) return null;
	if (view.soonestExpiryMs === null) return null;
	const text = askDeadlineText(view.soonestExpiryMs, nowMs);
	if (text === null) return null;
	const named = Number(view.head?.ask.expires_at ?? 0);
	return named === view.soonestExpiryMs ? text : `soonest ${text}`;
};

/**
 * The one line the minimized bar prints, and the number the badges print.
 *
 * TWO SETS, NOT ONE (design D16/audit): `open` and `timed_out` are both
 * outstanding on the wire - a late answer still reaches the agent - but only
 * `open` is an ask the agent is still inside the window for. An operator reading
 * "N questions waiting" over a queue whose deadlines had all passed was being
 * told the agent was waiting when it had moved on, which is one of the five
 * questions the surface exists to answer. So the waiting count is the one the
 * bar leads with and the moved-on set is stated beside it, in the app's own
 * vocabulary (the panel row's copy already reads "the agent moved on").
 *
 * A single question is named, not counted ("1 question waiting" reads as a
 * countdown label; "a question waiting" reads as a sentence a person wrote), and
 * a plural is only ever used above one.
 *
 * THE NOUN SURVIVES EVERY FORM (UX round 1's U4): the mixed form used to read
 * `1 waiting · 1 moved on`, so the one shape a reader meets FIRST on a mixed
 * queue was the only one without a noun - and the term it dropped is the one the
 * collapsed bar has no other way to explain (the panel's row says "Timed out -
 * the agent moved on"; the bar, which must work unexpanded, did not).
 */
export const askCountLabel = (waiting: number, movedOn: number): string => {
	const waitingUnit = waiting === 1 ? "question" : "questions";
	if (waiting > 0 && movedOn > 0)
		return `${waiting} ${waitingUnit} waiting · ${movedOn} moved on`;
	if (movedOn > 0)
		return movedOn === 1
			? "1 question moved on"
			: `${movedOn} questions moved on`;
	return waiting === 1 ? "1 question waiting" : `${waiting} questions waiting`;
};

/** The first question's text, clipped for a single-line bar. */
export const askHeadline = (ask: PendingAsk, limit = 120): string => {
	const first = ask.questions[0]?.question ?? "";
	const collapsed = first.replace(/\s+/g, " ").trim();
	if (!collapsed) return "The agent asked a question";
	if (collapsed.length <= limit) return collapsed;
	return `${collapsed.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

/**
 * The draft a whole-ask answer is built from: question id -> chosen labels.
 *
 * A DRAFT IS NOT AN ANSWER. It lives only in the panel's own state, never on the
 * wire, because the wire answers an ask ATOMICALLY (one body, every question) and
 * a client that streamed partial answers would be able to die half-settled - the
 * state the atomic submit exists to make unrepresentable.
 */
export type AskDraft = Record<string, string[]>;

/**
 * The empty draft, as a SHARED constant rather than a fresh `{}`.
 *
 * A caller that wrote `drafts[id] ?? {}` would hand the panel a new object on
 * every render, so an effect or memo keyed on the draft would re-run for a
 * question nobody touched — and the composer/panel draft is exactly the value
 * that must only change when the user changes it.
 */
export const EMPTY_DRAFT: AskDraft = {};

/** The empty draft MAP, shared for `EMPTY_DRAFT`'s reason. */
export const EMPTY_DRAFTS: Record<string, AskDraft> = {};

/**
 * The no-op draft writer, for a mount that owns no draft (a story, a read-only
 * surface). A component that could not accept one would have to branch on
 * whether it was controlled, which is the second code path this avoids.
 */
export const noopDraftChange = (): void => undefined;

/**
 * The secret values typed into the panel's masked fields, keyed by question id.
 *
 * A SEPARATE RECORD FROM `AskDraft`, and not because the two are shaped
 * differently. A draft is re-rendered (it drives ticks, counters and the
 * enabled state of the submit) while a secret must not be: keeping the value out
 * of `AskDraft` means no render path can ever paint it, log it or carry it into
 * a story fixture. It still travels ON THE ANSWER BODY, because the backend's
 * `respond_ask` is what substitutes the key name - it writes the value to the
 * session's memory-only store FIRST and puts `[<key>]` in the durable row, in
 * that order, which is the whole security property. A client that withheld the
 * value would give the model an answer it could never act on.
 */
export type AskSecrets = Record<string, string>;

/** Read one question's chosen labels out of a draft, defensively. */
export const draftFor = (draft: AskDraft, questionId: string): string[] =>
	draft[questionId] ?? [];

/**
 * Whether every question in an ask has an answer between the draft and the
 * typed secrets.
 *
 * The whole-ask submit is gated on this rather than on the question in view,
 * because the wire answers an ask ATOMICALLY (design §4) and a partial body is
 * refused by the queue: a Send that could only ever 409 is a control that lies
 * about what it can do.
 */
export const askDraftIsComplete = (
	ask: PendingAsk,
	draft: AskDraft,
	secrets: AskSecrets = {},
): boolean =>
	ask.questions.every((question) =>
		question.secret
			? (secrets[question.id] ?? "").trim().length > 0
			: draftFor(draft, question.id).some((value) => value.trim().length > 0),
	);

/**
 * The whole-ask answer body's `answers` map, or `null` when the draft is short.
 *
 * Every answer is a LIST on the wire even for a single-select question, so the
 * server never has to branch on the shape of the value. A secret question's
 * entry is the TYPED VALUE, and it is the backend that replaces it with the key
 * name before the answer is written anywhere durable (`respond_ask` stores the
 * value in the session's memory-only credential store and puts `[<key>]` in the
 * row, in that order) - so the value is never persisted, replayed to a provider,
 * or rendered on any card, and this map is the last place it is plaintext.
 */
export const askAnswerMap = (
	ask: PendingAsk,
	draft: AskDraft,
	secrets: AskSecrets = {},
): Record<string, string[]> | null => {
	if (!askDraftIsComplete(ask, draft, secrets)) return null;
	const answers: Record<string, string[]> = {};
	for (const question of ask.questions) {
		const values = question.secret
			? [(secrets[question.id] ?? "").trim()]
			: draftFor(draft, question.id).filter((value) => value.trim().length > 0);
		if (values.length > 0) answers[question.id] = values;
	}
	return Object.keys(answers).length > 0 ? answers : null;
};

/**
 * The refusal copy a queued-ask answer can come back with, beside the two the
 * blocking card already owns (`ask-answer.ts`'s `SETTLED_ELSEWHERE_MESSAGE` and
 * `QUESTION_MOVED_ON_MESSAGE`).
 *
 * WHY NEW FAMILIES RATHER THAN THE GATE'S. The gate's sentences are about a
 * question that was on screen and is not any more. A queued ask can be refused
 * for the two states only IT has - already timed out past the point of
 * acceptance (`expired`), or settled by another surface while this panel was
 * open - and the backend sends its OWN sentence for those, which is the copy the
 * user should read because it names the state precisely. These constants are the
 * app's fallback for the case where the refusal carried no sentence at all, and
 * they are worded to say what the user's next move is rather than to guess which
 * of the two happened.
 */
export const ASK_ALREADY_SETTLED_MESSAGE =
	"That question was already settled, so your answer was not sent.";

export const ASK_EXPIRED_MESSAGE =
	"This ask is too old to answer — ask the agent again.";

/**
 * The app's own sentence for a refusal that arrived WITHOUT one.
 *
 * WHY IT IS A CHOICE, not one constant (agent review F5, QA round 1 Q-2). The
 * sentence has to match the state the backend refused on - "too old to answer" and
 * "already settled" are different facts and the user acts differently on each - and
 * the refusal carries the state: `DesktopControlError.status` is the HTTP status
 * the route chose (410 for an expiry, 409 for a settled ask; measured in QA round
 * 1's refusal arm) and `code` is the vetted rejection category.
 *
 * Before this existed the code passed the settled sentence unconditionally, which
 * made `ASK_EXPIRED_MESSAGE` DEAD: nothing imported it, so an expiry that crossed
 * the wire without the owner's words was reported as "already settled" - the one
 * state the second constant was written for.
 */
export const askRefusalFallback = (error: unknown): string | null => {
	const status =
		typeof (error as { status?: unknown })?.status === "number"
			? ((error as { status: number }).status as number)
			: null;
	const code =
		typeof (error as { code?: unknown })?.code === "string"
			? ((error as { code: string }).code as string)
			: "";
	if (status === 410 || code === "expired") return ASK_EXPIRED_MESSAGE;
	if (status === 409) return ASK_ALREADY_SETTLED_MESSAGE;
	/*
	 * NULL MEANS "NOT THIS APP'S CALL", and it is a real answer rather than a
	 * failure. A transport failure carries no status, and a 404 is "no ask with
	 * that id" - a state neither constant describes. Saying "already settled" over
	 * a request that never reached the backend would be this app inventing a fact,
	 * which is the very class of defect this selection exists to end.
	 */
	return null;
};

/**
 * What to paint on a row whose answer the backend refused.
 *
 * TWO FACTS, IN ORDER (agent review F5, QA round 1 Q-2, QA round 2 Q-2):
 *
 *  1. THE OWNER'S SENTENCE WINS WHENEVER IT CROSSED THE WIRE. That is
 *     `DesktopControlError.detail` being present - the refusal body's own object,
 *     which the transport keeps - and the prose in `error.message` is the
 *     backend's own words ("That ask was already answered by the phone.").
 *  2. NO SENTENCE CROSSED THE WIRE means `error.message` is the transport's
 *     placeholder ("This server did not answer the request for its desktop
 *     controls."), which describes the TRANSPORT rather than what happened. Then
 *     the app says the state it can substantiate, chosen by status/code.
 *
 * WHY THIS IS NOT `userFacingMessage(error, fallback)` WITH THE CHOICE AS THE
 * ARGUMENT: that helper returns `error.message` for every `DesktopControlError`
 * BEFORE it consults its fallback, so the argument was never read and
 * `ASK_EXPIRED_MESSAGE` had no reachable input at all. The comment claimed a
 * behaviour the code did not have, and nothing in the repo named either constant
 * - which is how a green suite sat beside a dead branch. `ask-queue.test.mjs`
 * now names both.
 */
export const askRefusalSentence = (error: unknown): string => {
	const detail =
		typeof error === "object" && error !== null
			? (error as { detail?: unknown }).detail
			: undefined;
	/*
	 * "DID A SENTENCE CROSS THE WIRE?" HAS TWO SHAPES, and the field alone cannot
	 * answer it (QA round 3, Q-4). `desktopResult` stores `detail` only when the
	 * body's detail is an OBJECT; a `{detail: "..."}` payload puts that same
	 * sentence in `message` and leaves the field undefined - so a string-detail
	 * refusal was read as "nothing crossed" and the owner's words were replaced by
	 * the app's constant. The one thing that reliably means NOTHING crossed is the
	 * transport's own placeholder, which is exactly what it substitutes when it has
	 * no sentence to carry.
	 */
	const message = error instanceof Error ? error.message : "";
	const authored =
		detail !== undefined ||
		/*
		 * A control error whose message is NOT the placeholder carries prose, and the
		 * only source of prose on this path is the refusal body - so this is the
		 * string-detail shape. Scoped to `DesktopControlError` deliberately: a plain
		 * `Error` is a transport failure, and reading its message as the backend's
		 * own words would attribute this app's diagnosis to the server (QA round 3's
		 * case 3 keeps that distinction).
		 */
		(error instanceof DesktopControlError &&
			message !== "" &&
			message !== DESKTOP_REFUSAL_PLACEHOLDER);
	if (authored) return userFacingMessage(error, ASK_ALREADY_SETTLED_MESSAGE);
	const classified = askRefusalFallback(error);
	if (classified !== null) return classified;
	/*
	 * NOT CLASSIFIABLE, so the app does not borrow a sentence about settling: a
	 * transport failure carries no status and a 404 is "no ask with that id", and
	 * saying "already settled" over either would be this app inventing a fact. The
	 * transport's own word is kept, with the error's message as `userFacingMessage`'s
	 * stand-in so a plain `Error` still speaks.
	 */
	return userFacingMessage(
		error,
		error instanceof Error && error.message
			? error.message
			: ASK_ALREADY_SETTLED_MESSAGE,
	);
};

/**
 * The `sessions.answer` body for a whole-ask answer, or `null` when the draft is
 * incomplete (the caller refuses the press rather than sending a partial body,
 * which the wire would reject anyway).
 *
 * NOTE THE ABSENT `epoch`. A queued ask outlives the owner that queued it, so the
 * route deliberately skips the epoch check for this shape; sending one would
 * suggest a comparison that does not happen. See `Answer` in the backend's
 * `desktop_sessions.py`.
 */
export const askAnswerRequest = (
	ask: PendingAsk,
	draft: AskDraft,
	sessionId: string,
	secrets: AskSecrets = {},
): {
	op: "sessions.answer";
	sessionId: string;
	askId: string;
	answers: Record<string, string[]>;
} | null => {
	const answers = askAnswerMap(ask, draft, secrets);
	if (answers === null) return null;
	return { op: "sessions.answer", sessionId, askId: ask.ask_id, answers };
};

/**
 * The `sessions.answer` body for a decline: "no answer — decide yourself", the
 * explicit form of the blocking card's Esc.
 *
 * `decline: true` is not a modifier on an answer, it is the alternative TO one,
 * which is why this is a constructor of its own rather than a flag on
 * `askAnswerRequest`.
 */
export const askDeclineRequest = (
	ask: PendingAsk,
	sessionId: string,
): {
	op: "sessions.answer";
	sessionId: string;
	askId: string;
	decline: true;
} => ({
	op: "sessions.answer",
	sessionId,
	askId: ask.ask_id,
	decline: true,
});

/**
 * The outstanding-asks chip's copy, for a sidebar row.
 *
 * It is deliberately NOT the approval chip's words. An approval is blocking; an
 * ask is not, and the session may be working perfectly well while it waits - so
 * the chip says what is outstanding and never "waiting for you".
 */
export const asksOutstandingLabel = (open: number): string =>
	open === 1 ? "1 ask" : `${open} asks`;
