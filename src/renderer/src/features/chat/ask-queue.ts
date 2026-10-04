/**
 * The queued-ask read model: what a session's asks are, what state each is in,
 * and what a surface may say about them.
 *
 * ## Why this is a module and not a few expressions in a component
 *
 * Three surfaces read the same queue - the item in the composer's status row, the
 * panel it expands into, and the outstanding-asks chip on the sidebar row - and
 * two of them have to agree on a count while the third draws the individual rows.
 * The
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
/*
 * The row's own label seam. Imported from the run-details model rather than
 * restated, so the ask item's announced name joins its action to its clause the
 * same way every other chip on that row does - the model exports it and the
 * module's only imports are types, so this adds no runtime weight to a bundle
 * that exists precisely to be DOM-free (see `scripts/ask-queue.test.mjs`).
 */
import { LABEL_SEAM } from "./components/run-details/run-detail-model";
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
 * Whether this frame may state the waiting/moved-on SPLIT at all.
 *
 * ONE predicate, read by BOTH readers, so the clause the chip shows and the clause
 * the tooltip and announced name carry cannot drift: it is knowable only over the
 * ROWS the frame carries, and only when the frame is neither truncated nor lagging
 * the backend's own tally.
 *
 * IT SITS ABOVE THE CLAUSE BECAUSE THE CLAUSE IS BUILT ON IT. The first pass at
 * F2 inlined the pair here and used the predicate only in `askChipFullClause`, so
 * one rule had two expressions that agreed by hand rather than by construction
 * (agent review round 2, F7).
 */
const askSplitIsKnowable = (view: AskQueueView): boolean =>
	/**
	 * The status-row item's VISIBLE text, and the leading half of its announced name.
	 *
	 * PURE, and a pure function for the reason the row's other clauses are: the
	 * visible chip text and the announced name have to agree, and the string lives
	 * here so a DOM-free rig asserts it rather than a reviewer opening a story. The
	 * waiting clause is the row's ATTENTION register (the only state that carries
	 * urgency emphasis); `movedOn` and settled are the quiet register, told apart in
	 * the panel rather than on the chip.
	 *
	 * The TALLY forms - truncated, or a frame whose own rows do not add up to the
	 * published count - state the backend's outstanding number rather than splitting a
	 * prefix: the wire caps the list, so the waiting/moved-on split is knowable only
	 * for the rows this frame carries, and a prefix must not pass for the whole queue
	 * (the rule the removed `askBarText` recorded for the same reason).
	 *
	 * THE SECOND TALLY CASE IS THE ONE THAT KEEPS THE SURFACES IN STEP (agent review
	 * round 1, F2). `view.open` is the backend's own count - the number the sidebar's
	 * outstanding chip reads - and it can be larger than the rows this frame carries
	 * even when the frame is NOT marked truncated, because the list can lag the tally.
	 * Reading only the rows would let this chip say `All asks settled` beside a sidebar
	 * that says `2 outstanding`: the module's own header makes two-of-the-three
	 * surfaces agreeing on a count the rule, so the louder number wins here.
	 *
	 * `·` is the model's own counts seam (`SEAM`, which the TUI calls `STATS_SEAM`),
	 * RESTATED as a literal because `run-detail-model.ts` keeps it private and this
	 * module is deliberately DOM-free. It is not `CLAUSE_SEAM`: that one is `", "`,
	 * the comma between two counts in a sentence, and citing it here would point a
	 * reader at the constant that means the opposite of this claim (agent review
	 * round 1, F3).
	 */
	!view.truncated && view.open <= view.waiting + view.movedOn;

export const askChipClause = (view: AskQueueView, nowMs: number): string => {
	const count = askChipCountClause(view);
	const deadline = askChipDeadline(view, nowMs);
	/*
	 * THE DEADLINE IS APPENDED, not interleaved (design round 1's D2 and D6, and the
	 * audit's third item): the chip's counts seam stays intact and the countdown
	 * rides after it, so the visible text is a PREFIX of the announced name's clause
	 * in every case - including a mixed queue, where the name appends the moved-on
	 * half after this string rather than inserting it between the counts.
	 */
	return deadline === null ? count : `${count} · ${deadline}`;
};

/**
 * The COUNT half of the visible clause: what the chip says about the queue before
 * any deadline is appended.
 *
 * Exported because the row renders the deadline as its OWN element - it has to be
 * able to yield at the narrow band, which a single text node cannot do - so the row
 * composes these two pieces and `askChipClause` composes the same two into the
 * string a DOM-free rig asserts. One source, two renderers.
 */
export const askChipCountClause = (view: AskQueueView): string => {
	if (!askSplitIsKnowable(view)) return `${view.open} outstanding`;
	if (view.waiting > 0)
		return view.waiting === 1
			? "1 question waiting"
			: `${view.waiting} questions waiting`;
	if (view.movedOn > 0)
		return view.movedOn === 1
			? "1 question moved on"
			: `${view.movedOn} questions moved on`;
	/*
	 * ANSWERS STILL TO DELIVER COME BEFORE `All asks settled` (design §10, #1936).
	 *
	 * The user answered, the agent has not been handed it, and the change
	 * affordance is live on that row — so `All asks settled` would be the chip
	 * contradicting the panel it opens. The order is the same principle the two
	 * branches above already follow: a state the user can still act on outranks
	 * one they cannot. A DELIVERED `answered` ask is excluded by the row's own
	 * wire-derived flag, so the ordinary finished queue keeps today's sentence.
	 *
	 * AND A ROW THE OWNER HAS ALREADY REFUSED IS EXCLUDED TOO, through the view's own
	 * count: `AskQueueView.delivering` is read against the caller's outcome record, so
	 * an ask whose change door the owner shut drops out of this clause rather than
	 * being advertised while the card below it refuses (design round 2, D7 = UX round
	 * 2, U6). Only the OWNER's verdict removes a row - a transport failure leaves it
	 * counted, because the door is still open (`AskOutcome.refusedByOwner`).
	 *
	 * AND THE CLAUSE NAMES THE DOOR (UX round 1, U4; design round 1, D6). `not yet
	 * delivered` on its own is a statement of the wire's condition in
	 * implementation words: it does not say that the answer is still the user's,
	 * which is the WHOLE point of the state, and a reader who learns the window
	 * existed only by having a change refused has been told too late (U1's silent
	 * no-op, one state over). So the count carries the affordance it belongs to.
	 * WHAT CLOSES IT travels with the affordance itself
	 * (`ask-queue.ts`'s `ASK_CHANGE_WINDOW_HINT`), because that is where a reader
	 * who is about to use it is looking, and a chip is not the place to explain
	 * delivery.
	 */
	if (view.delivering > 0)
		return view.delivering === 1
			? "1 answer not yet delivered — you can still change it"
			: `${view.delivering} answers not yet delivered — you can still change them`;
	return "All asks settled";
};

/**
 * WHICH QUEUE a surface is showing.
 *
 * The two contexts the design note's §4.4 names, and they are a property of the
 * ENTRY POINT rather than a setting: the composer's status-row item opens the
 * conversation's own queue, and the sidebar's top-level `Asks` row opens the
 * fleet's. The scope is carried by the drawer's chrome bar so a reader can always say which one
 * is on screen ("a count of 3 inside a session and 11 at the top level are both
 * correct and say different things").
 *
 * IT IS A PROP OF THE SURFACE, not a second component: one drawer renders both, so
 * the fleet view is a data seam rather than a second idiom. The two entry points
 * that exist today are the composer's status-row item (a conversation's own queue)
 * and the sidebar's top-level `Asks` row (every conversation's) - and they are the
 * reason the scope is written WITH the open flag in the store rather than chosen by
 * the surface: the surface has to paint the queue its door promised, and only the
 * door knows which one that is.
 */
export type AskScope = "session" | "fleet";

/** The scope line's subject noun: what set the count beside it counts. */
export const askScopeSubject = (scope: AskScope): string =>
	scope === "fleet" ? "All conversations" : "This conversation";

/**
 * The DRAWER's count clause: what the surface shows, not only what the agent waits on.
 *
 * WHY THE DRAWER DIFFERS FROM THE CHIP (UX round 1, U5). `askChipCountClause`
 * counts the WAITING rows, which is the right register for a chip: it is a
 * standing tally in a row of tallies, and a moved-on row is not something the chip
 * asks you to look at. As the DRAWER's own title it under-described its own
 * contents - the drawer draws a card for EVERY outstanding ask, including a
 * moved-on one that is still answerable, so `1 question waiting` sat over two
 * answerable cards, and the row under it read `Timed out - the agent moved on; you
 * can still answer`.
 *
 * So a mixed queue spells BOTH halves here, with the drawer's own words, and every
 * other state falls through to the chip's clause unchanged (`All asks settled`, the
 * outstanding tally on a truncated frame, `N questions moved on`). The two surfaces
 * cannot disagree about a single-state queue, which is the shared-clause rule the
 * functions below still keep.
 */
export const askDrawerCountClause = (view: AskQueueView): string => {
	if (askSplitIsKnowable(view) && view.waiting > 0 && view.movedOn > 0) {
		return `${view.waiting} waiting, ${view.movedOn} moved on`;
	}
	return askChipCountClause(view);
};

/**
 * The drawer chrome bar's scope line: which queue, and how much of it.
 *
 * The subject is the scope and the count is `askDrawerCountClause` (the DRAWER's
 * own reading, above), joined by the model's counts seam (`·`) exactly as the
 * chip's counts are. It is no longer the chip's clause verbatim: the two surfaces
 * count different things on purpose, and U5 is that difference stated rather than
 * hidden.
 */
export const askScopeLine = (scope: AskScope, view: AskQueueView): string =>
	`${askScopeSubject(scope)} · ${askDrawerCountClause(view)}`;

/**
 * The chip's COUNTDOWN, with no subject: `expires in 12m`, or `null` when this
 * surface must state none.
 *
 * WHAT THE COUNTDOWN IS FOR: it is the operator's own question of the surface
 * ("when will it time out?"), and the strip this item replaced answered it on its
 * collapsed face. Moving into the status row lost the answer - `1 question
 * waiting` cannot tell a queue with fifty minutes left from one that lapses while
 * the reader looks at it - so the fact is rehomed onto the surface that replaced
 * the strip rather than dropped with it.
 *
 * IT IS SEPARATED FROM ITS SUBJECT (`askChipDeadlineSubject` below) because the two
 * have different yield orders at a narrow column: the subject is the unbounded part
 * and the number is what the reader came for, so a squeezed chip drops the subject
 * first. One string could not be yielded in halves.
 *
 * STATED NOT AT ALL WHILE THE SPLIT IS UNKNOWABLE (design round 1's D6): the wire
 * caps the list, and `askSplitIsKnowable` is the gate the count's own tally form
 * reads. While the split is unknown the count says `N outstanding` and this says
 * nothing, rather than passing the visible subset's soonest off as the queue's.
 *
 * AND THE GATE ITSELF IS ONE FUNCTION, read by everything below it: both countdown
 * spellings ask this for the deadline they may print. F5 of agent review round 2 asked
 * for it - two copies of a three-clause condition is two places for the two spellings
 * to start answering from different rows, and this lane has already paid for one drift
 * between two readers of one deadline.
 */
const askChipSoonestExpiry = (view: AskQueueView): number | null => {
	if (!askSplitIsKnowable(view) || view.waiting === 0) return null;
	return view.soonestExpiryMs;
};

export const askChipDeadlineText = (
	view: AskQueueView,
	nowMs: number,
): string | null => {
	const soonest = askChipSoonestExpiry(view);
	return soonest === null ? null : askDeadlineText(soonest, nowMs);
};

/**
 * The subject the countdown needs when the number is not the only waiting ask's, or
 * the empty string when it is.
 *
 * `soonest ask` is a HEAD NOUN and not a bare qualifier. `soonest expires in 12m`
 * was the first cut, and it reads as a fragment: the adverb presupposes the
 * comparison set without naming it, so the reader has to supply "deadline" or "ask"
 * to get a clause (design round 3's D4). The count beside it names the set, but a
 * chip is read left to right and the number should stand on its own.
 *
 * The comparison itself exists because this chip NAMES NO ASK: with more than one
 * waiting ask a bare `expires in 12m` attaches to whichever ask the reader had in
 * mind (design round 1's D2, re-expressed for this host). With exactly one waiting
 * ask the number IS that ask's and any subject would be noise.
 */
export const askChipDeadlineSubject = (view: AskQueueView): string =>
	view.waiting > 1 ? "soonest ask" : "";

/**
 * The whole countdown as one string: the subject and its number, or null.
 *
 * The composed form is what the announced name carries and what a DOM-free rig
 * asserts - the two readers of one fact (`askChipLabel` and the visible item) both
 * start here, which is why this is a function rather than a join at each site. The
 * row renders the same two pieces in two elements so the subject can yield at a
 * narrow column; the string this returns is what the VISIBLE text reads when the
 * column is wide enough for both.
 */
export const askChipDeadline = (
	view: AskQueueView,
	nowMs: number,
): string | null => {
	const text = askChipDeadlineText(view, nowMs);
	if (text === null) return null;
	const subject = askChipDeadlineSubject(view);
	return subject === "" ? text : `${subject} ${text}`;
};

/**
 * The same countdown where the sentence will not fit: `48m`, subject and all.
 *
 * THE BAND THIS EXISTS FOR is the chip's third tier. Titrating the yield on the
 * COLUMN while the chip is painted inside the composer's content box left a band
 * where the sentence could not fit whole and got ellipsised to `expires in 4...` - a
 * prefix of both `4m` and `48m`, painted beside an urgency ink that claims fifteen
 * minutes or less (design round 4's MAJOR; QA round 4's Q4 reported the same
 * mis-titration from the other end). A value with its unit is short enough to fit
 * where the sentence is not, so the narrow band keeps the ANSWER rather than
 * dropping it: the operator's question is when the ask lapses, and the subject is
 * the part that can wait for room.
 *
 * WHAT THE CHIP'S BOX ACTUALLY IS, since two reviewers disagreed here and the
 * arithmetic settles it (agent review round 2, F2): the row takes `px-2` below the
 * `isSmallView` step (550px, `SMALL_VIEW_PX`) and `px-4` above it, and the first chip
 * cancels 6px of the leading inset - so at every column a band binds (all of them
 * are under 550), the chip's box runs to `column - 10px`. The `column - 26px` figure
 * read on the thread came from the LARGE-view inset applied at a narrow column, which
 * is the same class of error the sibling set corrected for its floor frames.
 *
 * It carries no subject, deliberately: the subject exists to disambiguate WHICH ask
 * the number belongs to, and at this width the chip has room for the number or the
 * subject, never both. The announced name keeps the subject at every width
 * (`askChipLabel` composes from `askChipDeadline`), which is where the
 * disambiguation can actually be read.
 */
export const askChipDeadlineShort = (
	view: AskQueueView,
	nowMs: number,
): string | null => {
	const soonest = askChipSoonestExpiry(view);
	return soonest === null ? null : askDeadlineShortText(soonest, nowMs);
};

/**
 * The tooltip's clause: the visible one, except that a genuinely MIXED queue
 * spells both halves.
 *
 * The visible chip carries the short waiting clause (a chip is a register, not a
 * paragraph), but the announced name is the one place with room for the split a
 * mixed queue needs - and a screen-reader user is told about the moved-on rows
 * that the chip's short form elides, rather than about a state the screen is not
 * in.
 */
const askChipFullClause = (view: AskQueueView, nowMs: number): string => {
	if (askSplitIsKnowable(view) && view.waiting > 0 && view.movedOn > 0) {
		return `${askChipClause(view, nowMs)} · ${view.movedOn} moved on`;
	}
	return askChipClause(view, nowMs);
};

/**
 * The status-row item's announced name: ONE derived string, for `wakeChipLabel`'s
 * reason.
 *
 * The action leads and the clause follows, joined by the model's own
 * `LABEL_SEAM` - `wakeChipLabel`'s one-derived-string rule, one control over. The
 * visible text is always the leading half of this name (the mixed case appends
 * only), so the two readers cannot describe different states.
 */
export const askChipLabel = (
	view: AskQueueView,
	expanded: boolean,
	nowMs: number,
): string => {
	/*
	 * THE URGENCY WORD IS IN THE NAME, NOT ONLY IN THE INK (design round 3's D5 asked
	 * whether the ink step was enough; this is the half of the answer that is not a
	 * number). The item's mark steps to `warning` for an urgent waiting ask, and a
	 * COLOUR-ONLY cue is invisible to a reader who cannot tell this palette's accent
	 * from its warning - the two are DeltaE00 2.22 apart in the light theme by the
	 * palette file's own record. The panel row states the word in an `sr-only` span;
	 * this control cannot, because its `aria-label` OVERRIDES its content, so the word
	 * goes in the label. APPENDED, so the visible clause stays a prefix of the name.
	 */
	const urgency = view.urgent ? " · Urgent" : "";
	/*
	 * THE SURFACE'S OWN NOUN, NOT "the ask history" (UX round 1, U3). The chip's
	 * label is the only sentence that names what the press opens, and "history" was
	 * wrong about the state it is printed in most often: a queue with a LIVE question
	 * in it is not history, and the drawer the chip opens titles itself
	 * "this conversation's asks". So the label uses that noun (and says whose asks,
	 * because the chip sits in one conversation's row while the drawer's other scope
	 * - `fleet` - has no chip here).
	 */
	return `${expanded ? "Collapse" : "Expand"} this conversation's asks${LABEL_SEAM}${askChipFullClause(view, nowMs)}${urgency}`;
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

/**
 * The ask lane's PANEL, marked on the one root the ask drawer renders.
 *
 * THE MARKER IS THE PANEL'S, AND ONLY THE PANEL'S (agent review round 1, F5; UX
 * round 1, U3). It used to be on the row item as well, which broke the only probe a
 * rig or a test can reach for: `document.querySelector(ASK_SURFACE_SELECTOR)`
 * answered "yes" over a CLOSED panel (the chip matched it), so an assertion that the
 * panel is open passed while nothing was. The row item carries
 * `ASK_ITEM_SELECTOR` instead, and there is no surface at all while the flag is
 * false (`chat-content` mounts no drawer; `AskDrawer` also returns `null` for a
 * backend that publishes no `asks`), so this selector answers exactly the question
 * it looks like it answers.
 */
export const ASK_SURFACE_SELECTOR = "[data-lo-ask-surfaces]";

/**
 * The row item that EXPANDS the panel - the trigger, never the panel itself.
 *
 * One handle for three readers: the panel's own focus-return addresses it across
 * the two React trees, the item is what a rig presses, and `pressIsOurs` accepts it
 * so an Escape with focus on the trigger still collapses the lane.
 */
export const ASK_ITEM_SELECTOR = "[data-lo-ask-item-toggle]";

/**
 * The FLEET door: the sidebar's top-level `Asks` row.
 *
 * The second thing that OPENS an ask surface, and the reason it needs its own
 * selector rather than a second clause on `ASK_ITEM_SELECTOR`. The drawer's
 * entry move runs only when the mount finds focus ALREADY on the control the
 * user pressed, which is what keeps the lane's no-focus-steal promise (an ask
 * ARRIVING moves nothing). The session door is the composer chip, which carries
 * `ASK_ITEM_SELECTOR`; the fleet door is a sidebar row, which does not - so
 * before this existed a fleet open left focus on the rail row, Escape had no
 * listener inside the pane to bubble to, and the press fell through to the
 * interrupt ladder and stopped the running turn (UX round 1, U1 / agent review
 * round 1, F1). The drawer accepts either door at entry and returns focus to
 * the one it was opened by.
 *
 * The anchor is the row's stable `data-tour-tag`, the same handle the product
 * tour and the driver rigs address it by; the row carries no ask-lane marker of
 * its own, and minting one would be a second name for a row that already has
 * one.
 */
export const ASK_FLEET_ITEM_SELECTOR = '[data-tour-tag="nav-item-asks"]';

/*
 * Re-exported so the claim's own contract is nameable from a rig: the composer box
 * is half of what this claim covers, and a test that had to guess its selector would
 * be asserting a string rather than the element.
 */
export { COMPOSER_TEXTAREA_SELECTOR };

/**
 * Whether a press landed somewhere the ask lane speaks for.
 *
 * `true` for the ask PANEL, for the composer's own textarea (the box this lane
 * answers from, via `composer-field.ts` - the same module
 * `use-interrupt-on-escape.ts` asks), for the row item that expands the panel, and
 * for a target with no element (the body, a synthetic event, an already-unmounted
 * source).
 *
 * THE TRIGGER IS ITS OWN CLAUSE rather than a second mark on the panel: an Escape
 * with the keyboard on the chip must still collapse what the chip opened, and the
 * chip is not inside the panel's root (the two live in different React trees), so
 * the marker cannot cover it (UX round 1, U3).
 */
const pressIsOurs = (target: EventTarget | null): boolean => {
	const element = target as { closest?: (selector: string) => unknown } | null;
	if (typeof element?.closest !== "function") return true;
	return (
		element.closest(ASK_SURFACE_SELECTOR) !== null ||
		element.closest(ASK_ITEM_SELECTOR) !== null ||
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
 *  - `pressIsOurs` - the claim is for the ask panel, the row item that expands it
 *    and the composer box, not the whole window. Without it, deeper owners that
 *    cancel on Escape without calling `preventDefault` (the directory indicator,
 *    the sidebar's search, the dictation cancel) both acted AND collapsed.
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
	 * is a COPY distinction rather than a liveness one: `open` above stays the
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
	/**
	 * True for a row whose answer has been RECORDED but not yet delivered to the model.
	 *
	 * §10's window, carried as a presentation fact rather than re-derived by every
	 * control that needs it: while it is true the answer is still the user's to change
	 * (`AskPanel`'s change affordance), the row belongs with the pending cards rather
	 * than in the settled history, and the chip must not call the queue settled.
	 *
	 * THE RECORDED HALF IS `answered` **OR** `late`, and getting that wrong is how a
	 * whole half of §10's window went missing: a revision is admitted for both
	 * (`asks/queue.py::_revision_decision` - "an ask that already carries an answer
	 * (`answered`/`late`) with no `ask-response-<ask_id>` row yet"), and the first cut
	 * of this flag read `answered` alone, so a `late`-and-undelivered answer was filed
	 * as settled history with no door to a revision §10 accepts (agent review round 1
	 * MAJOR = design round 1 D2).
	 *
	 * THE DELIVERY HALF IS THE WIRE'S `delivered` HINT, and the hint is now the ROW
	 * ITSELF. Engine PR #1983 (merged 2026-10-04, "close the revision window on
	 * consumption, not on handoff") re-pinned the flag to the
	 * `ask-response-<ask_id>` row's DURABLE APPEND for `answered`/`declined`/`late`
	 * (`asks/store.py::delivered_hint`), so a `late` ask whose `ask-timeout-` notice
	 * has already gone out reads `delivered: false` until its answer row lands - the
	 * deadline notice delivers nothing. The hint and §10's window are therefore the
	 * same fact in a running session, and the earlier disagreement (a sticky hint
	 * that counted the notice as a delivery, hiding the door on a `late` ask) is gone
	 * with that engine release. A core older than it still carries the sticky reading
	 * and can over-report `delivered: true` here; this client's reading is the same
	 * either way, because it only ever reads the hint.
	 *
	 * THE CLIENT STILL CANNOT SEE THE ROW BOUND DIRECTLY, and that limit is kept
	 * rather than papered over: the wire publishes no row-presence field
	 * (`asks/store.py`'s `pending_row`, the only shape that reaches a client), so a
	 * client that wanted the row itself would have to guess it from transcript rows or
	 * from a value comparison, and §10 forbids exactly that class of inference. What is
	 * implemented here is §10's own text, which states the window as "`answered` or
	 * `late` with `delivered: false`", read from the hint the wire publishes.
	 */
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
 * mode. `Esc` is the right key to name because it is the collapse the status-row
 * item already offers (the panel's own `Esc`, the same key the window ladder
 * would otherwise spend on a stop), so the sentence describes a control that
 * exists rather than one this feature would have to add.
 *
 * The minimized and normal states keep each app's existing placeholder
 * unchanged, which is why this string is only ever supplied while expanded.
 */
export const ASK_COMPOSER_PLACEHOLDER =
	"Answering the agent's question — Esc to collapse";

/**
 * WHAT CLOSES THE CHANGE WINDOW, said where the control that uses it is (design §10,
 * #1936; UX round 1, U4; design round 1, D6).
 *
 * The card's status line and the chip both state the CONDITION (`Answered —
 * delivering`, `not yet delivered`) and neither states the BOUND: the whole state
 * exists because the answer is still the user's, and the fact that decides when it
 * stops being theirs is DELIVERY — the moment the agent is handed the answer. A
 * reader who learns that only by having a change refused has been told too late
 * (U1's silent no-op, one state over), so the sentence sits with the affordance
 * rather than in the mirrored copy contract: these are this surface's words about
 * this surface's control, not a backend notice restated.
 */
export const ASK_CHANGE_WINDOW_HINT =
	"You can change this until the agent is handed your answer.";

/**
 * This surface's record of the ask it last acted on (design §10, #1936).
 *
 * The two facts a card needs about its own last POST, and nothing else: whether one
 * is in flight, the owner's sentence if it was refused, and - for a revision -
 * whether it LANDED. Keyed by ask id at the call site because a refusal belongs to
 * ONE ask; a single slot would put the previous ask's sentence on the next one.
 *
 * `changed` is the receipt, and it exists because the wire cannot carry one: the
 * fold keeps the status, stamp and attribution of the FIRST `answered` and requires
 * no marker (`asks/store.py::fold`), so after an accepted revision the frame is a
 * first-answer frame with a different map in it. Without a client-side record the
 * artefact of a deliberate change is identical to the artefact of the answer it
 * replaced (design round 1, D3), and a drawer that stayed on its seeded form after a
 * successful submit looks exactly like one whose submit never left (UX round 1, U3).
 */
export type AskOutcome = {
	sending: boolean;
	refused: string | null;
	/** A CHANGE that landed, per the owner's own acceptance (design §10, #1936). */
	changed?: boolean;
	/**
	 * Whether the refusal above is the OWNER's own verdict on this ask - a sentence
	 * that crossed the wire, or a status/code the app reads as one of the ask's own
	 * states - rather than a transport failure that reached nothing.
	 *
	 * ONLY A REAL VERDICT SHUTS §10's CHANGE DOOR (agent review round 2, minor). The
	 * card withdraws the door while a refusal stands, because a control whose only
	 * possible outcome is the sentence above it is the second press design round 1's
	 * D1 measured. A transport failure is not a verdict: the request never arrived, so
	 * the card has learned NOTHING about the window, and latching the door shut on it
	 * left an answered-undelivered ask with no affordance at all until a remount -
	 * this record is never cleared. The classification is made where the error is still
	 * in hand (`askRefusalIsOwner`); a reader of this record only ever gets the
	 * sentence.
	 */
	refusedByOwner?: boolean;
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
		/*
		 * §10's WINDOW, as the wire states it: a recorded answer (`answered` or `late`)
		 * the fold has not yet called delivered. See `AskPresentation.delivering` for the
		 * `late` half of this term and the wire limit it carries.
		 */
		delivering:
			(status === "answered" || status === "late") && ask.delivered !== true,
	};
};

/**
 * The queue, ordered and counted as the surfaces draw it.
 *
 * The order is the wire's own (open first, then newest) re-asserted rather than
 * trusted, because two frames from different publishers - the frontend state and
 * the aggregate route - are not required to agree on a list order, and a surface
 * whose head row moved under a finger is the one interaction the design note
 * names as unacceptable. `head` is therefore always the OLDEST open ask, matching
 * the legacy mirror's own choice, so the panel and the mirror name the same
 * question during the skew window.
 */
export type AskQueueView = {
	/** `null` when the backend does not publish asks at all. */
	asks: PendingAsk[] | null;
	rows: AskPresentation[];
	/** Open asks, from the backend's own count when it published one. */
	open: number;
	/** Asks still inside their window, from the rows this frame carries. */
	waiting: number;
	/** Asks whose deadline passed with the agent moving on, from the same rows. */
	movedOn: number;
	/**
	 * Asks whose answer is RECORDED (`answered` or `late`) and not yet DELIVERED,
	 * from the same rows (design §10, #1936).
	 *
	 * Its own count rather than a fold into `waiting`/`movedOn`, because it is a
	 * state of its own: the user has answered and the agent has NOT been handed the
	 * answer, so the row is still the user's to CHANGE — and the chip must not say
	 * `All asks settled` about it (see `askChipCountClause`). It is read from the
	 * WIRE's `delivered` hint via `presentAsk`, never from a status alone: a
	 * delivered `answered` ask is history and takes no control. The `late` half and
	 * the wire limit that half carries are `AskPresentation.delivering`'s own note;
	 * the caveat is stated once there rather than twice here.
	 *
	 * THE COUNT IS READ THROUGH THE CALLER'S OWN OUTCOMES, because a refusal can shut
	 * a row's door while the frame still calls it undelivered (agent review round 2,
	 * minor). A row whose refusal is the owner's own verdict is NOT counted here: the
	 * count exists to tell the reader how many answers are still THEIRS to change, and
	 * the owner has just said this one is not - so advertising it would be the chrome
	 * offering a door the card refuses, which is the contradiction design round 2's
	 * D7 = UX round 2's U6 measured. A refusal that never reached the owner leaves the
	 * row counted and the door open (`AskOutcome.refusedByOwner`), because nothing was
	 * learned about the window. `askQueueView` takes the record as its second argument
	 * and a host with none (a story, the fleet's own model) simply passes it nothing.
	 *
	 * A truncated frame's count is a count of the visible prefix, exactly as
	 * `waiting`/`movedOn` are — the same caveat, stated once here rather than three
	 * times above.
	 */
	delivering: number;
	/** Total rows in this frame, which is NOT the queue length when truncated. */
	total: number;
	truncated: boolean;
	/**
	 * Whether any ask this chip COUNTS AS WAITING carries the wire's `urgent` flag.
	 *
	 * The wire has carried `urgent` since the ask lane existed (the backend derives it
	 * from the window itself, `timeout <= 900`) and no desktop surface ever painted
	 * it: an ask with ten minutes left looked exactly like one with an hour. It is
	 * scoped to the WAITING rows on purpose - the same set `soonestExpiryMs` reads -
	 * because the OUTSTANDING set deliberately folds `timed_out` in, and a moved-on
	 * ask's stale urgency would then spend this row's one warning ink on a question
	 * nobody is waiting on (the audit's second item; UX round 1's U1 and design round
	 * 1's D1 found the same defect twice, from pixels and from the flow).
	 */
	urgent: boolean;
	/**
	 * The soonest deadline across the WAITING rows, in epoch ms, or `null`.
	 *
	 * Per the ROWS and not the head: with two waiting asks of different windows the
	 * soonest is what decides whether the reader has to look now, and the chip names
	 * no ask for a head-based reading to attach to (the panel's rows carry each ask's
	 * own countdown). Read through `askChipDeadline`, which gates it on the split
	 * being knowable at all.
	 */
	soonestExpiryMs: number | null;
	/** The oldest open ask, or null when nothing is open. */
	head: AskPresentation | null;
};

export const askQueueView = (
	frontend:
		| Pick<CanonicalFrontendState, "asks" | "asks_open" | "asks_truncated">
		| null
		| undefined,
	/*
	 * The caller's own record of the asks it posted for, when it has one. Read for
	 * ONE term — `delivering`, where an owner refusal takes the row out of the count
	 * (see that field's note) — and deliberately not for anything else: the view is a
	 * reading of the wire, and the record only ever corrects it where the wire is
	 * known to be stale.
	 */
	outcomes?: Readonly<Record<string, AskOutcome | undefined>>,
): AskQueueView => {
	const asks = sessionAsks(frontend);
	if (asks === null)
		return {
			asks: null,
			rows: [],
			open: 0,
			waiting: 0,
			movedOn: 0,
			total: 0,
			truncated: false,
			urgent: false,
			delivering: 0,
			soonestExpiryMs: null,
			head: null,
		};
	const rows = asks.map(presentAsk).sort(compareAsks);
	const open = rows.filter((row) => row.open).length;
	/*
	 * The two halves are derived from the ROWS rather than the backend's tally,
	 * which is the point of them: the wire's `asks_open` folds `timed_out` into the
	 * outstanding set, so only the rows can say which of the outstanding asks the
	 * agent is still waiting on. A truncated frame's split is therefore a split of
	 * the visible prefix, which is exactly why `askChipClause` states the backend's
	 * own tally instead of the split when `truncated` is set.
	 */
	const waiting = rows.filter((row) => row.waiting).length;
	const movedOn = rows.filter((row) => row.movedOn).length;
	const delivering = rows.filter(
		(row) =>
			row.delivering && outcomes?.[row.ask.ask_id]?.refusedByOwner !== true,
	).length;
	/*
	 * The waiting rows' own deadlines, for the chip's countdown. Rendered from
	 * `expires_at` on the CLIENT clock, exactly as a panel row's is (see
	 * `askDeadlineText`), so the two surfaces cannot disagree about one ask.
	 */
	const deadlines = rows
		.filter((row) => row.waiting)
		.map((row) => Number(row.ask.expires_at ?? 0))
		.filter((at) => Number.isFinite(at) && at > 0);
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
		delivering,
		total: rows.length,
		truncated: frontend?.asks_truncated === true,
		urgent: rows.some((row) => row.waiting && row.ask.urgent === true),
		soonestExpiryMs: deadlines.length > 0 ? Math.min(...deadlines) : null,
		head: rows.find((row) => row.open) ?? null,
	};
};

/**
 * Open before settled, then oldest first inside each group.
 *
 * Oldest-first is the design note's own rule for the mirrored card
 * (`_sync_pending` names the OLDEST open ask, and its reasoning is that a card
 * that jumped to each new arrival would move under a user's finger mid-tap). The
 * list inherits it so the panel and the list cannot disagree about what "the
 * head" is.
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
 * The `late` arm's DELIVERY-AWARE sentence: the SAME recorded-and-undelivered window
 * as `answered`'s "Answered — delivering", for the half that timed out first.
 *
 * The contract's own `late` sentence ends "the agent was told", and that clause is the
 * fact which makes a late answer TERMINAL — so it is false for exactly the §10 window
 * this surface has a change door for, where the row read "Answered late — the agent
 * was told" directly beside its own "not yet delivered — you can still change it"
 * (design round 2, D7 = UX round 2, U6). The corrected sentence states the delivery
 * condition the way the `answered` arm does, so a reader cannot take away a claim the
 * wire has not made yet. It is a SEPARATE constant rather than a change to
 * `ASK_STATUS_COPY.late`, because that contract is the word a DELIVERED late row keeps
 * in the settled section (`askStatusWord`), where "the agent was told" is true — the
 * sentence is condition-dependent, the word is not.
 */
export const ASK_LATE_UNDELIVERED_TEXT = "Answered late — not yet delivered";

/**
 * The status WORD for a settled row's one line, DERIVED from the sentence above.
 *
 * A settled ask is one line in its section (design note §4.5), and one line cannot
 * hold `Answered late — the agent was told`. The word is the sentence's own leading
 * clause up to its first em dash, so the two cannot drift: a copy change to the
 * sentence moves the word with it, and a status whose sentence carries no clause
 * (`unknown`) answers with the whole sentence rather than a guess.
 *
 * WHAT THE SECTION ACTUALLY HOLDS, WHICH IS NOT WHAT D9 ASSUMED (agent review
 * round 1, M1 = UX U1 = design D1). The words that must stay apart IN THE SECTION
 * are the ones the section can hold, and it cannot hold `Timed out`: the backend's
 * outstanding set folds `timed_out` in, so `presentAsk` marks such a row `open` and
 * it is drawn as a pending CARD with live controls - the distinction D9 wanted is
 * kept by the ROW SHAPE there (a card, not a one-line history row) rather than by
 * this word. The pair that has to be told apart by word is the shipped pair: a
 * delivered `Answered` and an `Answered late`, which look identical in a one-line
 * row and are different facts about the agent's day.
 */
export const askStatusWord = (status: AskStatus | "unknown"): string => {
	const copy = ASK_STATUS_COPY[status];
	const cut = copy.indexOf(" — ");
	return cut === -1 ? copy : copy.slice(0, cut);
};

/**
 * The settled section's descriptor: WHICH WORDS the rows under it actually carry.
 *
 * DERIVED FROM THE ROWS, never a fixed legend. The header used to print one sentence
 * ("answered, timed out, declined, dismissed") for every state the section could
 * hold, and it was false in both directions: `timed out` can never be in the section
 * (see `askStatusWord`), while `Answered late` and `Expired`, which can, were never
 * named - so the legend described a set of states no section can hold and omitted
 * states every section can.
 *
 * The order is the COPY CONTRACT's own, read from `ASK_STATUS_COPY`'s declaration
 * order, so the list is stable across frames and moves with the sentences rather than
 * beside them. Deduped, because two `answered` rows are still one word.
 */
export const askStatusWords = (rows: readonly AskPresentation[]): string => {
	const present = new Set(rows.map((row) => row.status));
	const words: string[] = [];
	for (const status of Object.keys(ASK_STATUS_COPY) as (
		| AskStatus
		| "unknown"
	)[]) {
		if (!present.has(status)) continue;
		const word = askStatusWord(status);
		if (!words.includes(word)) words.push(word);
	}
	return words.join(", ");
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
 *
 * A RECORDED-BUT-UNDELIVERED `late` ROW GETS THE DELIVERY-AWARE SENTENCE, not the
 * contract's terminal one (see `ASK_LATE_UNDELIVERED_TEXT`): the contract's sentence
 * is a claim the row's own delivery condition has not earned yet, so the card and the
 * chip beside it would state opposite facts about the same ask. Every other status is
 * read from the contract: an undelivered `answered` row says "Answered — delivering"
 * already, which claims no delivery.
 */
export const askStatusText = (ask: PendingAsk, nowMs: number): string => {
	const presentation = presentAsk(ask);
	if (presentation.status === "late" && presentation.delivering)
		return ASK_LATE_UNDELIVERED_TEXT;
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
 * "expires in 42m" for an epoch-ms deadline, or `null` when there is none to read.
 *
 * The chip's countdown and a row's countdown are ONE spelling, which is why this
 * formatter is shared rather than restated: the strip's collapsed face and the
 * panel's row print the same number for the same ask, and two implementations of
 * "how long is left" is exactly the drift the copy contract exists to prevent.
 *
 * A deadline that cannot be read says NOTHING rather than rounding to "expires
 * now": the backend's own `gate_waited_text` sets the same precedent for the
 * timeout row, and for the same reason - a countdown that guesses is worse than no
 * countdown when the reader is deciding whether to hurry.
 *
 * RETURNS THE TWO SPELLINGS THE SURFACE NOW NEEDS, from ONE reading of the clock:
 * `long` is the sentence a row prints (`expires in 42m`); `short` is the chip's
 * narrow-band form (`42m`). Computing them together is the point - two functions
 * would be free to round differently or derive a different unit from the same
 * deadline, and the chip's band is exactly where a reader is triaging.
 */
const expiryParts = (
	expiresAt: number,
	nowMs: number,
): { long: string; short: string } | null => {
	if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
	const remainingMs = expiresAt - nowMs;
	if (remainingMs <= 0) return { long: "expiring now", short: "now" };
	const minutes = Math.floor(remainingMs / 60_000);
	/*
	 * ONE SPELLING OF ONE UNIT, and no space: the TUI this feature deliberately
	 * rhymes with reads `expires in 42m` (`tui/widgets/ask_queue.py`), and the
	 * receipt row's own `askWaitedText` already writes it that way. Two renderings of
	 * "minutes" in the pair of PRs that share a copy contract is the kind of drift
	 * the shared contract exists to prevent (design round 1, D5).
	 */
	if (minutes < 1) {
		const seconds = `${Math.floor(remainingMs / 1000)}s`;
		return { long: `expires in ${seconds}`, short: seconds };
	}
	if (minutes < 60)
		return { long: `expires in ${minutes}m`, short: `${minutes}m` };
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { long: `expires in ${hours}h`, short: `${hours}h` };
	const days = Math.floor(hours / 24);
	return { long: `expires in ${days}d`, short: `${days}d` };
};

export const askDeadlineText = (
	expiresAt: number,
	nowMs: number,
): string | null => expiryParts(expiresAt, nowMs)?.long ?? null;

/**
 * The same countdown in the chip's narrow-band form: `42m`, `3d`, or `now`.
 *
 * Exists because the chip runs out of room before the sentence does. A partial
 * `4...` is a prefix of both `4m` and `48m` (design round 4's MAJOR, QA round 4's
 * Q4), so the narrow band gets a value that always fits whole rather than a
 * sentence that gets cut.
 */
export const askDeadlineShortText = (
	expiresAt: number,
	nowMs: number,
): string | null => expiryParts(expiresAt, nowMs)?.short ?? null;

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
 * The EDIT BUFFER for a recorded-but-undelivered answer (design §10, #1936).
 *
 * Seeds the card's change form with what the log already holds, so changing one
 * answer is an edit rather than a re-entry of the whole ask: the revision still
 * travels as the complete map (§10's whole-ask rule), and a form that started
 * empty would force the user to retype every question to change one — and would
 * make an accidental omission a question the ask loses for good.
 *
 * A SECRET QUESTION IS DELIBERATELY LEFT EMPTY, and not as an oversight. Its
 * recorded cell is the KEY NAME (`[<key>]`) by construction — the value never
 * leaves the session's memory store, so there is nothing to seed a masked field
 * WITH, and seeding the key name would post the literal `[<key>]` as the new
 * secret. The field is therefore empty and the submit is gated on a retyped value
 * by the SAME `askDraftIsComplete` rule the first answer uses (which is why no
 * revision-specific completeness rule exists here).
 */
export const askRevisionDraft = (ask: PendingAsk): AskDraft => {
	const draft: AskDraft = {};
	for (const question of ask.questions) {
		if (question.secret) continue;
		const recorded = ask.answers?.[question.id];
		if (Array.isArray(recorded) && recorded.length > 0)
			draft[question.id] = [...recorded];
	}
	return draft;
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
 * "DID A SENTENCE CROSS THE WIRE?", in the two shapes it has, extracted so the
 * sentence and the verdict (`askRefusalIsOwner`) read the SAME answer.
 *
 * `desktopResult` stores `detail` only when the body's detail is an OBJECT; a
 * `{detail: "..."}` payload puts that same sentence in `message` and leaves the field
 * undefined - so a string-detail refusal was read as "nothing crossed" and the owner's
 * words were replaced by the app's constant (QA round 3, Q-4). The one thing that
 * reliably means NOTHING crossed is the transport's own placeholder, which is exactly
 * what it substitutes when it has no sentence to carry; the `DesktopControlError` scope
 * keeps a plain `Error` (always a transport failure) out, so this app's own diagnosis
 * is never attributed to the server.
 */
const askRefusalAuthored = (error: unknown): boolean => {
	const detail =
		typeof error === "object" && error !== null
			? (error as { detail?: unknown }).detail
			: undefined;
	const message = error instanceof Error ? error.message : "";
	return (
		detail !== undefined ||
		(error instanceof DesktopControlError &&
			message !== "" &&
			message !== DESKTOP_REFUSAL_PLACEHOLDER)
	);
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
	if (askRefusalAuthored(error))
		return userFacingMessage(error, ASK_ALREADY_SETTLED_MESSAGE);
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
 * Whether a refusal is the OWNER's own verdict on this ask, rather than a transport
 * failure that reached nothing.
 *
 * IT DECIDES WHETHER §10's CHANGE DOOR MAY SHUT (agent review round 2, minor). The card
 * withdraws the door while a refusal stands, because a control whose only possible
 * outcome is the sentence above it is a second press (design round 1, D1 = UX round 1,
 * U1). A TRANSPORT FAILURE IS NOT A VERDICT: the request never arrived, so nothing was
 * learned about the window - and because the outcome record is never cleared, latching
 * the door shut on one left an answered-undelivered ask with no affordance at all until
 * a remount.
 *
 * A VERDICT IS EITHER SHAPE THE APP CAN SUBSTANTIATE: the owner's own sentence crossed
 * the wire (`askRefusalAuthored`), or a status/code the app classifies as one of the
 * ask's own states (`askRefusalFallback` - 409/410). A transport failure carries no
 * status, and a 404 is "no ask with that id"; neither is a statement about delivery, so
 * both leave the door open and the reader free to press again once the wire can answer.
 * The returned refusal stays on screen either way - it is a fact about the press, not a
 * gate on the control.
 */
export const askRefusalIsOwner = (error: unknown): boolean =>
	askRefusalAuthored(error) || askRefusalFallback(error) !== null;

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
