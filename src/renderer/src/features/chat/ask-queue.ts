/**
 * The queued-ask read model: what a session's asks are, what state each is in,
 * and what a surface may say about them.
 *
 * ## Why this is a module and not a few expressions in a component
 *
 * Three surfaces read the same queue - the item in the composer's status row, the
 * panel it expands into, and the outstanding-asks mark a sidebar conversation row
 * carries - and two of them have to agree on a count while the third draws the
 * individual rows. The
 * backend's own design note (`docs/design/ask-nonblocking.md` §5) puts one
 * binding constraint on all of them: **no surface may say "notified" that it
 * cannot substantiate, and agent-is-working is never "waiting for you"**. A
 * sentence composed in three places is a sentence that drifts in two of them, so
 * every string and every classification lives here and the components only
 * paint.
 *
 * ## The two rules a reader of the wire owes
 *
 * 1. **Absence is not emptiness - and, since the WIRE FIX, not incapability
 *    either.** The backend publishes `asks` only while the non-blocking flag is
 *    on AND the frame actually carries a row; an empty LIST is published as
 *    absence. So `sessionAsks` returns `null` for "this frame carried no rows"
 *    and `[]` only when a frame really said so - and no caller may collapse the
 *    two.
 *
 *    WHAT CHANGED, AND WHY THE OLD READING IS NOW AMBIGUOUS. `sessionAsks`
 *    returning `null` used to BE the capability answer: an old core published
 *    `asks` exactly while a queue had rows, so "no `asks` array" and "no queued
 *    engine" were the same fact and a mount could read one as the other. The
 *    WIRE FIX separated them - a live-but-EMPTY queue is now legitimately
 *    published as `asks` ABSENT with `asks_open: 0` present, because a client
 *    deciding whether to paint an ask affordance must be able to tell a live
 *    engine from a blocking one even when there is nothing in it. The engine
 *    signal is therefore the presence of `asks` OR `asks_open` (`ask-queue.ts`'s
 *    `askQueuePublished`, the core's `ask_wire` docblock's own sentence), and a
 *    surface that reads `sessionAsks(...) !== null` as "no capability" turns a
 *    live, empty engine into a dead one.
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
	PendingAskQuestion,
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
 * Whether this frame's runtime runs the queued-ask engine at all - the WIRE FIX's
 * capability contract: the presence of `asks` OR `asks_open`.
 *
 * WHY IT IS A PREDICATE AND NOT THE OBVIOUS `sessionAsks(frontend) !== null`.
 * That read was CORRECT until the runtime's wire fix changed what absence means,
 * and it is the rule the whole lane was written against - an older rule reading a
 * changed contract, not a mistake. Before the fix a core published `asks` exactly
 * while its queue had rows, so an absent array was the same fact as "no queued
 * engine"; the fix made a live-but-EMPTY queue publish as `asks` absent with
 * `asks_open: 0`, so absence now means EITHER "nothing outstanding right now" OR
 * "this runtime cannot answer", and only the second is a capability. A surface
 * that keeps the old read therefore treats a live, empty engine as a dead one -
 * which is exactly how the asks drawer rendered nothing (and kept its slot) when
 * a conversation was switched to one with no outstanding asks.
 *
 * THE CORE'S OWN WORD FOR THE CONTRACT is `ask_wire`'s docblock
 * (`local_operator/session/frontend_state.py`, v0.68): "The capability proxy is
 * the presence of `asks` OR `asks_open`" - written for exactly this, the cross-
 * repo companion in `local-operator-ui` deciding how to paint an ask row. The
 * expression below is deliberate: `asks` keeps an array check (a malformed value
 * must not read as capable), while `asks_open` is read for PRESENCE because zero
 * is a value and 0 is the empty-but-live queue.
 *
 * `transcript-reducer.ts`'s `queuedAskEngineLive` spells the same read, and the
 * duplication is on purpose rather than an oversight: that module bundles
 * standalone in `scripts/transcript-reducer.test.mjs` and carries no desktop-API
 * import, which is why its own note refuses to reach in here.
 */
export const askQueuePublished = (
	frontend:
		| Pick<CanonicalFrontendState, "asks" | "asks_open">
		| null
		| undefined,
): boolean =>
	frontend != null &&
	(Array.isArray(frontend.asks) || frontend.asks_open != null);

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

/**
 * The number an attention BADGE draws for one conversation's queue: the asks a
 * control can still act on.
 *
 * With a complete list (`askSplitIsKnowable`) that is the answerable rows only, so a
 * lapsed ask - read-only on every surface (D10) - pulls no attention and the rail
 * badge agrees with the sidebar's mark (`fleetAsksBySession`). With a truncated or
 * lagging list only the tally is known, and it counts lapsed asks too; the badge keeps
 * it, because over-counting a lapsed ask is the safe side of hiding a real open one.
 */
export const askAttentionCount = (view: AskQueueView): number =>
	askSplitIsKnowable(view)
		? view.rows.filter((row) => row.canAnswer).length
		: view.open;

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
	/*
	 * TIMED OUT, in the badge's own word (design round 1 on #1116, D2): the quiet
	 * register, and AFTER the delivering clause because nothing on a timed-out ask can
	 * be acted on (D10) - the same "actionable first" order as above. "Moved on" was a
	 * third name for the state the row's badge calls `Timed out`.
	 */
	if (view.movedOn > 0)
		return view.movedOn === 1
			? "1 question timed out"
			: `${view.movedOn} questions timed out`;
	return "All asks settled";
};

/**
 * WHICH QUEUE a surface is showing.
 *
 * The two contexts the design note's §4.4 names, and they are a property of the
 * ENTRY POINT rather than a setting: the composer's status-row item opens the
 * conversation's own queue, and the panel rail's asks item opens the fleet's at
 * the top level (and this conversation's inside one - one control, two scopes,
 * because it rides the route rather than a second door). The scope is
 * carried by the drawer's chrome bar so a reader can always say which one
 * is on screen ("a count of 3 inside a session and 11 at the top level are both
 * correct and say different things").
 *
 * IT IS A PROP OF THE SURFACE, not a second component: one drawer renders both, so
 * the fleet view is a data seam rather than a second idiom. The two entry points
 * that exist today are the composer's status-row item (a conversation's own queue)
 * and the panel rail's asks item - the conversation header's trigger, which held
 * this role until #896 moved the control onto the rail beside its four siblings
 * (this conversation's inside a session, every
 * conversation's at the top level) - and they are the
 * reason the scope is written WITH the open flag in the store rather than chosen by
 * the surface: the surface has to paint the queue its door promised, and only the
 * door knows which one that is.
 */
export type AskScope = "session" | "fleet";

/** The scope line's subject noun: what set the count beside it counts. */
export const askScopeSubject = (scope: AskScope): string =>
	scope === "fleet" ? "All conversations" : "This conversation";

/**
 * WHAT THE DRAWER SAYS WHEN THE FRAME THAT DECIDES ITS CONTENTS HAS NOT BEEN READ.
 *
 * ONE SPELLING, NOT TWO (design round 1, D5). The bar's clause and the body under it
 * used to state the same fact in the same register 30 px apart (`Not read yet` above
 * `Reading the asks…`), which reads as one two-line paragraph rather than as chrome
 * plus body. The BODY carries the fact and the bar drops its clause while the frame
 * is unresolved - `askScopeLine` omits the separator when there is no clause - so the
 * surface names what it is doing exactly once.
 */
export const ASK_DRAWER_UNREAD_LINE = "Reading the asks…";

/**
 * THE OTHER UNRESOLVED-LOOKING FRAME, WHICH IS NOT THE SAME FACT (design round 1, D1).
 *
 * `{asks: null, asks_open: null}` is a RESOLVED frame (`unread` false): the runtime
 * answered, and its answer is that it publishes no queued asks at all. It can never
 * resolve into a queue - nothing will publish for it - so giving it the in-flight
 * copy parked a permanent `Reading the asks…` on a surface that never resolves.
 *
 * HOW IT IS REACHED, CORRECTED IN ROUND 2 (agent review R7). This docblock used to
 * justify the state as "reachable: the door is offered at zero asks, and a
 * door-opened mount is deliberately never auto-closed" - which is the wrong door.
 * The door's gate is `published` (`chat-content.tsx`), and `published` is
 * FALSE for this frame, so no door in the app offers it; that sentence described the
 * live-but-EMPTY frame (`asks_open: 0`), a different state. The true path is the one
 * the `UnsupportedBackend` story's own block states: an OPEN FLAG INHERITED from a
 * runtime that does publish asks (or a store flag left open across a restart onto an
 * older runtime), which mounts this surface over a frame it cannot serve. That mount
 * is exactly why the state needs honest copy at all - a claimed slot must never wear
 * a claim the frame cannot back. The lane's copy rule is that every claim is
 * checkable or cut (§8): a progress claim that can never complete is not one.
 *
 * SO IT GETS ITS OWN STATE. The bar states the capability it lacks and the body says
 * what that means, in the drawer's own voice; the pair is the drawer's, and the chip
 * and the asks item keep their designed zero-state offers unchanged.
 */
export const ASK_DRAWER_UNAVAILABLE_CLAUSE = "Asks unavailable";

/** The body under that clause: what is true, rather than what the surface hopes. */
export const ASK_DRAWER_UNAVAILABLE_LINE =
	"This runtime doesn't support queued asks.";

/**
 * The DRAWER's count clause: what the surface shows, not only what the agent waits on.
 *
 * WHERE THE DRAWER DIFFERS FROM THE CHIP. It used to spell a mixed queue as
 * `1 waiting, 1 moved on` (UX round 1, U5), when a timed-out ask was a pending card.
 * Since D11 that ask is a collapsed settled row, and the title counts only what the
 * Pending half holds (design round 1 on #1116, D2): a timed-out-only drawer reads
 * `All asks settled`, where the chip still names the `N questions timed out` it opens
 * onto. Every other state falls through to the chip's clause unchanged.
 *
 * AND ALL THREE UNRESOLVED STATES ARE TOLD APART HERE (remediation round 1: D1, D5,
 * R1). `unread` is the frame nobody has read; `published: false` on a RESOLVED frame
 * is a runtime that cannot answer; a published tally with no rows is the wire bound
 * dropping the list while the count survives (`_bound_asks_in_place`), and for that
 * one the clause is the COUNT - never `All asks settled`, which is a verdict its own
 * nonzero tally contradicts.
 */
export const askDrawerCountClause = (view: AskQueueView): string => {
	/* No clause at all while unresolved: the body names that fact once (D5). */
	if (view.unread) return "";
	if (!view.published) return ASK_DRAWER_UNAVAILABLE_CLAUSE;
	/*
	 * A timed-out ask is a settled ROW in this drawer (D11), and settled rows are not in
	 * the title (design round 1 on #1116, D2), so a queue with nothing waiting or being
	 * delivered is a settled drawer, as the TUI's is.
	 */
	if (askSplitIsKnowable(view) && view.waiting === 0 && view.delivering === 0) {
		return "All asks settled";
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
 *
 * AN EMPTY CLAUSE TAKES THE SEPARATOR WITH IT (design round 1, D5): the unresolved
 * state has no count and names itself in the body, so the bar reads `This
 * conversation` alone rather than `This conversation ·` with a dangling seam.
 */
export const askScopeLine = (scope: AskScope, view: AskQueueView): string => {
	const clause = askDrawerCountClause(view);
	return clause === ""
		? askScopeSubject(scope)
		: `${askScopeSubject(scope)} · ${clause}`;
};

/**
 * THE RAIL DOOR'S OWN NAME: its verb, its scope, and - while a badge is drawn - the
 * count it stands for. The tooltip and the control's announced name print this one
 * string, so the hover text and what a screen reader hears cannot disagree about any
 * of the three.
 *
 * WHY THE NAME SAYS "RAIL" (#896). The control it names is the panel rail's asks
 * item; before the move it was the conversation header's trigger, and "Header" would
 * now name a location the control left - the same rule the selector it pairs with
 * follows (`ASK_RAIL_ITEM_SELECTOR`). The SENTENCE is unchanged and deliberately so:
 * a user who learned it keeps it.
 *
 * WHY IT LIVES HERE (QA round 2, Q2-1). It was composed inline in `chat-header.tsx`, so
 * the one string this lane makes a promise about - "the two controls can never be one
 * string" (UX round 1, U3) - had no CI instrument: the only `Open asks` under `scripts/`
 * was a stand-in's `textContent`, and a regression would have needed a rig run. Every
 * other sentence of the lane's copy is in this module where a DOM-free rig can read it,
 * so this one is too. `panel-rail-model.ts`'s `askRailLabels` prints it as the rail
 * item's tooltip rather than recomposing it (#896).
 *
 * THE SCOPE WORD STAYS AT ZERO (UX round 1's U3, as remediated). Folded in only while a
 * badge is drawn, the quiet state read the bare `Close asks` - the SAME announced name as
 * the drawer's own dismiss, two controls for two different acts (one toggles this scope,
 * one closes the pane). The subject is what keeps the two controls from ever being one
 * string, and the scope glyph carries the same distinction visually.
 *
 * "WAITING" (agent review round 1 on #1116, MAJOR-1). The number this sentence
 * qualifies is the badge's ANSWERABLE count (`askAttentionCount`,
 * `fleetAsksOutstanding`), which no longer folds a timed-out ask in, so the subset's
 * own word is the right one again. (It read `waiting or moved on` while the count was
 * the outstanding set.) A truncated frame's badge falls back to the tally; see
 * `askAttentionCount`.
 */
export const askRailToggleLabel = (args: {
	open: boolean;
	scope: AskScope;
	count: number;
	/**
	 * The action's bound chord, already in display spelling (`⌘A`), or `null`
	 * when unbound (#928, review round 1's F2 = design D3): the rail's tooltip
	 * must print the promise its dispatcher answers, like the five sibling
	 * items. The clause rides the noun — `Open asks (⌘A) — This conversation` —
	 * and is absent entirely when nothing is bound, so the sentence a user
	 * learned stays the sentence they get.
	 */
	cap?: string | null;
}): string => {
	const verb = args.open ? "Close" : "Open";
	const chord =
		args.cap === null || args.cap === undefined ? "" : ` (${args.cap})`;
	const subject = askScopeSubject(args.scope);
	return args.count > 0
		? `${verb} asks${chord} \u2014 ${subject}, ${args.count} waiting`
		: `${verb} asks${chord} \u2014 ${subject}`;
};

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
 * mixed queue needs - and a screen-reader user is told about the timed-out rows
 * that the chip's short form elides, rather than about a state the screen is not
 * in. That includes a queue led by an undelivered answer (QA round 2 on #1116, Q-2):
 * the timed-out rows are still on screen beside it, so the name still counts them.
 */
const askChipFullClause = (view: AskQueueView, nowMs: number): string => {
	if (
		askSplitIsKnowable(view) &&
		(view.waiting > 0 || view.delivering > 0) &&
		view.movedOn > 0
	) {
		return `${askChipClause(view, nowMs)} · ${view.movedOn} timed out`;
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
 * Whether the head open ask can ONLY be answered in the panel's masked field.
 *
 * THIS IS THE OPERATOR'S DECISION, TAKEN (operator ask `a-9e0c`, which timed out
 * and was answered by its recommended option). The previous version of this note
 * said that dropping the composer's refusal "is a separate decision about that
 * hazard, and the operator's to make"; this is that decision, so the refusal is
 * gone and the predicate means something else.
 *
 * WHAT IT MEANS NOW: "show the composer's secret-ask notice, and guard a
 * password-shaped send." The chat box stays usable while the secret waits in the
 * panel — the operator's report was that the panel is where the value is typed,
 * so locking the conversation he is having beside it bought nothing but a dead
 * box. A queued ask does not park the turn (that is what "queued" means), so a
 * message sent meanwhile is an ordinary message.
 *
 * WHY THE BLOCKING GATE KEEPS ITS REFUSAL AND THIS ONE DOES NOT. While a gate
 * parks the turn, a send becomes `sessions.answer`, or a steer the parked turn
 * cannot read (backend `session/session.py`); a queued ask leaves the turn free.
 * Blocking asks are only reachable on the `LOP_ASK_NONBLOCKING=0` escape hatch
 * (backend `asks/policy.py`), which is why that arm is the smaller one. A backend
 * route that starts a new turn while a blocking gate is parked would overturn
 * this.
 *
 * THE HAZARD IS ANSWERED, NOT IGNORED: a typed credential in a chat box is still
 * visible while typed and still persists in the draft store, so the composer asks
 * before sending a password-shaped line and offers the panel's own field as the
 * default destination. See `looksLikeSecret` in `credential-capture.ts` for the
 * shape rule and its deliberate narrowness.
 */
export const askComposerHoldsSecret = (view: AskQueueView): boolean => {
	const head = view.head;
	if (head === null || !head.canAnswer) return false;
	const questions = head.ask.questions;
	return questions.length > 0 && questions.every((q) => q.secret === true);
};

/**
 * THE FIELD A "Put in secret field" WOULD LAND IN, or `null` when one value
 * names none.
 *
 * `key` is the confirm's BINDING (agent review round 1, m1; QA round 1, Q2):
 * the composer records it when it arms the confirm and hands it back on the
 * press, so a value typed for one ask can never be posted to a different one
 * that became the head while the question was up. It names the ask AND the
 * question, because an ask with several secret questions would otherwise keep
 * the same key while the field under it changed.
 *
 * `questionId` is null for a multi-question ask (and for one whose single
 * question is not secret): the gesture can put ONE value in ONE field, so there
 * it degrades to opening the panel instead of guessing a question.
 */
export type SecretField = { key: string; questionId: string | null };

export const askSecretField = (ask: PendingAsk): SecretField => {
	const questions = ask.questions;
	const single = questions.length === 1 && questions[0].secret === true;
	return {
		key: `${ask.ask_id}:${single ? questions[0].id : "*"}`,
		questionId: single ? questions[0].id : null,
	};
};

/**
 * What one press of "Put in secret field" did, in terms the composer can act on.
 *
 * WHY IT IS NOT A BOOLEAN. The composer has to say WHY nothing landed (agent
 * review round 1, M1; UX round 1, U1) and has to know whether the request can
 * still address the ask at all, and `false` collapses four different facts into
 * one. `sent` clears the draft; every other value keeps it, returns focus to the
 * box and states the reason.
 */
export type SecretFillOutcome =
	| "sent"
	/** The value was posted and the owner or the transport refused it. */
	| "refused"
	/** Nothing was posted: a chat send holds the answer lock. */
	| "locked"
	/** Nothing was posted: this pane has no session to answer on. */
	| "unavailable"
	/** Nothing was posted: the ask the confirm was raised for is no longer head. */
	| "stale"
	/** Nothing was posted: the ask has more than one secret question. */
	| "multi";

/**
 * The page's answer door, as the fill path sees it.
 *
 * `locked` and `unavailable` are the two states `chat-page.tsx`'s `answerAsk`
 * used to return as `undefined`, which the composer could not tell apart. The
 * rest is its own `AnswerOutcome`.
 */
export type AskAnswerAttempt =
	| { status: "sent" }
	| { status: "refused" }
	| { status: "failed" }
	| { status: "locked" }
	| { status: "unavailable" };

/**
 * THE WHOLE "Put in secret field" WIRING, as one pure function: which field the
 * press lands in, the payload shape, the trim, and what the answer's status
 * means to the composer.
 *
 * WHY IT IS EXTRACTED FROM THE COMPONENTS. Both halves lived in `chat-content.tsx`
 * (which head is filled) and `chat-page.tsx` (the `sent` mapping), and a jsdom rig
 * that mounts the composer can only mock the result - so the map shape, the trim
 * and the stale check had no test at all (agent review round 1, m3). Here they are
 * one function a DOM-free test can drive with a fake head and a recording door.
 *
 * THE BINDING IS CHECKED HERE, not in the composer: the caller passes the `key`
 * its confirm was armed under and the head it would fill now, and a mismatch is
 * `stale` rather than a value posted to whatever ask happens to be head.
 */
export const fillSecretField = async (
	head: AskPresentation | null,
	key: string,
	value: string,
	fill: (
		askId: string,
		answers: Record<string, string[]>,
	) => Promise<AskAnswerAttempt | undefined>,
): Promise<SecretFillOutcome> => {
	if (head === null) return "stale";
	const field = askSecretField(head.ask);
	if (field.key !== key) return "stale";
	if (field.questionId === null) return "multi";
	/*
	 * THE VALUE IS TRIMMED ONCE, HERE, exactly as the panel's own answer body is
	 * (`askAnswerMap` trims the same way): a draft's surrounding whitespace is
	 * the box's, not the secret's.
	 */
	const outcome = await fill(head.ask.ask_id, {
		[field.questionId]: [value.trim()],
	});
	if (outcome === undefined) return "unavailable";
	if (outcome.status === "sent") return "sent";
	if (outcome.status === "refused" || outcome.status === "failed")
		return "refused";
	return outcome.status;
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
 * false (`chat-content` mounts no drawer; the drawer's own body draws the unread
 * line rather than a panel for a frame that publishes no queued asks), so this
 * selector answers exactly the question it looks like it answers.
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
 * The RAIL door: the panel rail's asks item (#896) - the conversation header's
 * asks trigger before the move, and the same control the tour and the driver rigs
 * address by its tag.
 *
 * The second thing that OPENS an ask surface, and the reason it needs its own
 * selector rather than a second clause on `ASK_ITEM_SELECTOR`. The drawer's
 * entry move runs only when the mount finds focus ALREADY on the control the
 * user pressed, which is what keeps the lane's no-focus-steal promise (an ask
 * ARRIVING moves nothing). The session door is the composer chip, which carries
 * `ASK_ITEM_SELECTOR`; the asks item is not the chip, so before this existed an
 * open from the header (the control this constant addressed then) left focus
 * outside the pane, Escape had no listener inside it to bubble to, and the press
 * fell through to the interrupt ladder and stopped the running turn (UX round 1,
 * U1 / agent review round 1, F1). The drawer accepts either door at entry and
 * returns focus to the one it was opened by - which after #896 is the rail item,
 * the drawer's focus-return anchor and its Escape door.
 *
 * ONE DOOR, TWO SCOPES (operator ask, 2026-10-05). The control it names opens the
 * SESSION scope inside a conversation and the FLEET scope at the top level - so
 * the constant is named for the control rather than for one of the two queues it
 * can open. It replaced the sidebar's top-level `All asks` row, which was itself
 * a disclosure wearing a destination's clothes; the anchor is still a stable
 * `data-tour-tag`, the same handle the product tour and the driver rigs address
 * controls by - and the TAG VALUE is unchanged by the move (#896), because four
 * harnesses, the tour and the driver attach to it.
 *
 * WHY IT IS NOT SPELLED `ASK_HEADER_ITEM_*` ANY MORE. That name described the
 * control's LOCATION under #820/#835, and #896 moved the control to the panel
 * rail; a constant that keeps naming a place the door left is how a rig ends up
 * asserting yesterday's layout. The rename pairs with `askRailToggleLabel`'s.
 */
export const ASK_RAIL_ITEM_SELECTOR = '[data-tour-tag="ask-pane-trigger"]';

/*
 * Re-exported so the claim's own contract is nameable from a rig: the composer box
 * is half of what this claim covers, and a test that had to guess its selector would
 * be asserting a string rather than the element.
 */
export { COMPOSER_TEXTAREA_SELECTOR };

/**
 * Whether a press landed somewhere the ask lane speaks for.
 *
 * `true` for the ask PANEL, for the composer's own textarea (via
 * `composer-field.ts` - the same module `use-interrupt-on-escape.ts` asks), for the
 * row item that expands the panel, and for a target with no element (the body, a
 * synthetic event, an already-unmounted source).
 *
 * THE COMPOSER IS HERE BECAUSE OF THE INTERRUPT LADDER, NOT BECAUSE IT ANSWERS: the
 * composer used to be this lane's answer box (design 5.0's R7, retired 2026-10-07)
 * and no longer is, but the ladder still EXEMPTS its textarea from
 * `ownsEscapeOutsideComposer`, so an Escape pressed there with the drawer open would
 * stop the running turn while the drawer stayed open. A queued ask exists while a
 * turn is live, so claiming the press for the collapse is still the right reading.
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
 * `canAnswer`/`canDecline` are the two questions a control actually asks: may this
 * surface take an answer, and is there anything left to decline. Only an `open` ask
 * says yes to either. A settled ask cannot be declined (`declined` is settled, and
 * `answered` is somebody else's answer), and a timed-out ask is LAPSED (see
 * `lapsed`): the backend would still accept a late answer, but no surface offers
 * one any more (D10 in the lapsed-retention decisions).
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
	 * `OUTSTANDING_STATUSES`), which the wire's tally counts (see `lapsed` for what a
	 * surface may still do with the row). But a timed-out ask has had its
	 * deadline pass and the agent has walked past it, so a surface that called
	 * both "waiting" would be stating a fact the fold contradicts.
	 */
	waiting: boolean;
	/** The deadline passed and the agent moved on. */
	movedOn: boolean;
	/**
	 * The ask timed out and is READ-ONLY here: no answer, no decline, never a pending
	 * card, never a reason to open a surface (D10-D12).
	 *
	 * `timed_out` ONLY, never re-derived from `expires_at` on this clock (see the module
	 * note): the store re-derives a stale `open` to `timed_out` on its own host's clock
	 * (#2465 D5), so the status is already the whole fact. It stays in `open` above
	 * because the backend's outstanding set and the wire's `asks_open` still count it -
	 * the chat path can still deliver a late answer - and a tally read against the rows
	 * has to keep meaning "outstanding" for the dropped-rows check
	 * (`askOutstandingReading`). Surfaces read "answerable now" as `canAnswer`.
	 */
	lapsed: boolean;
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
	/**
	 * Which surface settled it (`by.surface` on the `ask_response` row), and the
	 * operator's reason on a dismissal. Both are read only for the `dismissed`
	 * sentence; every other status keeps the contract's own words.
	 */
	by?: { surface?: string; [key: string]: unknown } | null;
	reason?: string | null;
}): string => {
	if (receipt.status === "dismissed") {
		/*
		 * Word for word `harness/rows.ask_response_notice`'s dismissed branch: who,
		 * through which surface, and why. Without it a dismissal would fall through
		 * to "Answered — delivering", which is false for an ask nobody answered.
		 */
		const raw =
			typeof receipt.by?.surface === "string" ? receipt.by.surface : "";
		const surface =
			raw === "remote" ? "phone" : raw === "tui" ? "terminal" : raw;
		const via = surface ? ` (${surface})` : "";
		const reason =
			receipt.reason === "answered_in_chat"
				? "settled in chat"
				: "no longer needed";
		return `Dismissed by you${via} — ${reason} (ask ${receipt.askId})`;
	}
	if (receipt.status === "declined")
		return `Ask ${receipt.askId} declined — the agent was told`;
	if (receipt.status === "late")
		return `Answered late — the agent was told (ask ${receipt.askId})`;
	return `Answered — delivering (ask ${receipt.askId})`;
};

/**
 * The one-liner for an `ask_timeout` receipt (`harness/rows.ask_timeout_notice`).
 *
 * Word for word the backend's sentence, so one event reads one way on every surface.
 * It used to end "you can still answer"; that stopped being true once a lapsed ask
 * became read-only on every surface (D10), and the backend changed it in the same set.
 */
export const askTimeoutSummary = (receipt: {
	askId: string;
	waitedS: number;
}): string =>
	`Timed out after ${askWaitedText(receipt.waitedS)} — the agent goes ahead without your answer (ask ${receipt.askId})`;

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
	 * A DISMISSAL that landed, and the reason the operator chose (harness SA-D5).
	 *
	 * The card's own receipt, for the reason `changed` exists: the wire folds the
	 * ask to `dismissed` with no marker for WHICH reason a surface sent, so a row
	 * that only read the frame could not say "Dismissed — no longer needed" rather
	 * than "Dismissed". The reason is the client's own record rather than a claim
	 * about the backend.
	 */
	dismissed?: AskDismissReason;
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
	const lapsed = status === "timed_out";
	return {
		ask,
		status,
		open: undecided,
		waiting: status === "open",
		movedOn: lapsed,
		lapsed,
		// Answerable only while the agent is still waiting. A lapsed ask's late answer
		// would still reach the model through the store, but the rule is one late-answer
		// rule on every surface: the deadline passed, the agent went ahead (D10).
		canAnswer: status === "open",
		// A decline is "no answer, decide yourself", which is what the deadline already
		// told the agent on a lapsed ask - so it is only offered while open.
		canDecline: status === "open",
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
	/**
	 * Whether this frame has not been READ yet (`frontend == null`): the fleet pane's
	 * first commits before its route answers, or a session frame that has not landed.
	 *
	 * ITS OWN FIELD BECAUSE IT IS NOT `published: false`. Both carry no rows and both
	 * are unpublishable-looking, but they are different facts with different honest
	 * copy: an unread frame is a progress state that WILL resolve, while a resolved
	 * frame that publishes no engine is a terminal answer about the runtime (design
	 * round 1, D1 - the two rendered byte-identically, and the second can never
	 * resolve into anything). It is also the state the auto-close must not act on, for
	 * the same reason it must not act on a switch to a conversation whose queue has
	 * not landed yet: until the read answers, nothing may be closed over.
	 *
	 * DOM-FREE, like the rest of this module: derived from the frame the caller hands
	 * in, so a rig can assert the three states without a browser.
	 */
	unread: boolean;
	/** `null` when the backend does not publish asks at all. */
	asks: PendingAsk[] | null;
	/**
	 * Whether this frame's runtime runs the queued-ask engine AT ALL - the WIRE
	 * FIX's capability contract, read through `askQueuePublished`.
	 *
	 * ITS OWN FIELD BECAUSE `tasks === null` CANNOT ANSWER IT ANY MORE. A
	 * live-but-EMPTY queue legitimately publishes `asks` absent, so `asks === null`
	 * now covers two different facts - "nothing outstanding" and "this runtime
	 * cannot answer" - and a surface that needs the second one (the drawer, whose
	 * chrome must not wear the `All asks settled` verdict over a queue nobody has
	 * read) has to be able to ask for it without re-deriving the rule.
	 *
	 * `false` on an unresolved frame too (`frontend` null): an absent frame is not
	 * a capable one, which is why the drawer renders its chrome rather than a count
	 * while the read is in flight.
	 */
	published: boolean;
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
	/**
	 * The oldest ANSWERABLE ask, or null when nothing can be answered. A lapsed ask is
	 * outstanding but never the head: the composer's secret guard reads `canAnswer` off
	 * it, and a lapsed head would release that guard over an open secret ask behind it.
	 */
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
	const published = askQueuePublished(frontend);
	const unread = frontend == null;
	if (asks === null)
		return {
			asks: null,
			published,
			unread,
			rows: [],
			/*
			 * THE TALLY IS STILL READ, and this is the frame that made the field
			 * necessary: with `asks` absent the rows say nothing, but a live queue
			 * states its own count (`asks_open: 0` for the empty-but-live case), and a
			 * count of zero read as a VALUE is what lets the drawer's chrome say
			 * `All asks settled` truthfully - while a frame that published no tally at
			 * all (`published` false) must not be given that verdict (see
			 * `askDrawerCountClause`).
			 *
			 * AND A NONZERO TALLY HERE IS THE WIRE BOUND'S OWN FRAME (remediation round
			 * 1, R1): `_bound_asks_in_place` drops the row list while deliberately
			 * keeping `asks_open`, so the count is the ONLY thing this frame carries and
			 * every reader below has to take it as the statement of record - it must not
			 * be rendered as empty, and it must not be closed over.
			 */
			open: typeof frontend?.asks_open === "number" ? frontend.asks_open : 0,
			waiting: 0,
			movedOn: 0,
			total: 0,
			/*
			 * THE FRAME'S OWN FACT, NOT A LITERAL (R1). Hard-coding `false` here discarded the
			 * one field that says the LIST is incomplete, which is exactly the frame above
			 * whose rows were dropped.
			 *
			 * WHAT IT ACTUALLY MOVES, CORRECTED IN ROUND 2 (agent review R6). The claim used
			 * to be that the flag-less version left the surfaces that read `truncated` with
			 * "no way to say so" - but for `{asks: null, asks_open: N > 0}` they had nothing to
			 * say either way: `askSplitIsKnowable` is `!truncated && open <= waiting + movedOn`,
			 * and a rowless frame has `waiting = movedOn = 0` against `open = N`, so the clause
			 * is `N outstanding` whichever way this flag reads. THE ONE SHAPE THE FLAG MOVES
			 * IS A ROWLESS FRAME WITH A ZERO TALLY: there `0 outstanding` and `All asks settled`
			 * are both arithmetically available, and the frame's own truncation is what says the
			 * list - not the queue - is what is missing, so the tally is the honest clause.
			 * (The untruncated zero-tally frame keeps `All asks settled`, which is the state the
			 * wire "made": a live queue with nothing outstanding.) Fidelity is the other half
			 * of the reason, and it is why this is a fix at all: a frame's own field should not
			 * be hard-coded to a fact, and the published branch below reads the same field.
			 */
			truncated: frontend?.asks_truncated === true,
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
		/* An array IS the capability, so this is `published` and not a second read. */
		published,
		unread,
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
		head: rows.find((row) => row.canAnswer) ?? null,
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
	return compareAge(a, b);
};

/** Oldest first, then by id, so equal timestamps order the same way on every frame. */
const compareAge = (a: AskPresentation, b: AskPresentation): number => {
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
 * delivery to a person. `timed_out` says what happened next - the agent went ahead
 * without the answer - because "timed out" alone does not say whether anything is
 * still waiting on the reader. It used to add "you can still answer"; no surface
 * offers that any more (D10).
 */
export const ASK_STATUS_COPY: Record<AskStatus | "unknown", string> = {
	open: "Queued — the agent is continuing",
	answered: "Answered — delivering",
	timed_out: "Timed out — the agent goes ahead without your answer",
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
 * WHAT THE SECTION HOLDS. A lapsed ask is collapsed with the settled rows (D11), so
 * `Timed out` is a word the section now carries, beside `Declined`. The pair that
 * still has to be told apart by word alone is a delivered `Answered` and an
 * `Answered late`, which look identical in a one-line row and are different facts
 * about the agent's day.
 */
export const askStatusWord = (status: AskStatus | "unknown"): string => {
	const copy = ASK_STATUS_COPY[status];
	const cut = copy.indexOf(" — ");
	return cut === -1 ? copy : copy.slice(0, cut);
};

/**
 * The ask panel's two halves: the cards a control can still act on, and the rows it
 * collapses to one line each behind their status badge.
 *
 * PENDING is `canAnswer || delivering`: an ask the user can answer, or an answer the
 * agent has not been handed yet, which is still the user's to change (design §10).
 * Everything else is SETTLED, and that includes a LAPSED ask (D11): it is read-only,
 * so it renders exactly as a declined one does - collapsed, opened only by the reader.
 *
 * `held` is the one exception: the ids this MOUNT has already shown as answerable. A
 * held ask that lapses stays in the pending half, in its own slot, until the next
 * mount (UX round 1 on #1116, U1). Filing it under Settled on the frame that lapsed it
 * slid the next card up into its place, which put that card's one-click, irreversible
 * Decline exactly under the reader's pointer. Only a LAPSED row is held: a row that
 * settles another way has nothing left to read in place and moves as it always did.
 *
 * NEWEST FIRST within the settled half, the history's own order, sorted here rather
 * than by reversing `rows`: the queue sorts every outstanding row (lapsed ones too)
 * ahead of the settled ones, so a reversal would file every lapsed row below the
 * whole history regardless of when it was asked.
 *
 * Here rather than in the panel so a DOM-free test can pin the partition.
 */
export const askPanelHalves = (
	rows: readonly AskPresentation[],
	held: ReadonlySet<string> = new Set(),
): { pending: AskPresentation[]; settled: AskPresentation[] } => {
	const isPending = (row: AskPresentation) =>
		row.canAnswer || row.delivering || (row.lapsed && held.has(row.ask.ask_id));
	return {
		pending: rows.filter(isPending),
		settled: rows
			.filter((row) => !isPending(row))
			.sort((a, b) => compareAge(b, a)),
	};
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
 * The entry `askCellWith` writes for an `Other` that is SELECTED BUT EMPTY: the empty
 * string, exactly. Writers trim, so it is the only blank a writer ever produces, and
 * the one predicate below is the only place that names it - the gate
 * (`askQuestionIsAnswered`) and the card's seed (`askOtherSeed`) both read it, so they
 * cannot disagree about whether a pending `Other` is there. A whitespace-only entry is
 * not this marker (no writer makes one); it is simply not answer text.
 */
const isOtherPending = (value: string): boolean => value === "";

/** An entry that is text a user could be answering with. */
const isAnswerText = (value: string): boolean => value.trim().length > 0;

/**
 * The cell the backend records for a secret the user did not hand over: the
 * blocking and queued paths both write it (`ASK_SECRET_NOT_PROVIDED` in the backend's
 * `tools/builtin.py`), and it is how an empty secret cell reads to the model. Mirrored
 * here only so the change form can tell a recorded SKIP from a recorded key name.
 */
export const ASK_SECRET_NOT_PROVIDED = "<not provided>";

/**
 * Whether an EMPTY masked field may be sent as a skip for this secret question.
 *
 * `recorded` is the answer map already on the log, passed ONLY by the change form;
 * the first answer omits it. The backend takes an empty secret cell as "the user did
 * not provide it" and the TUI's secret field skips on Esc, so on a FIRST answer an
 * empty field is a skip rather than a block: an ask whose prompt said "paste the key
 * (otherwise skip)" could not be sent at all while this was required.
 *
 * THE CHANGE FORM IS DIFFERENT, because its masked field can never be seeded (the
 * log holds only the key name, see `askRevisionDraft`). When the recorded cell holds
 * a stored key, an empty field there is not the user skipping - it is the user
 * editing another answer - and sending it as a skip would replace the stored key
 * with `<not provided>`. So a revision may skip a secret only when what is recorded
 * was itself a skip (an empty cell or `ASK_SECRET_NOT_PROVIDED`); otherwise the value
 * has to be typed again, as it always had to.
 */
export const askSecretIsSkippable = (
	question: PendingAskQuestion,
	recorded?: Record<string, string[]>,
): boolean => {
	if (recorded === undefined) return true;
	// A recorded map with NO cell for this question is not evidence of a skip, so it
	// keeps the conservative reading: retype rather than risk replacing a stored key.
	const stored = recorded[question.id];
	if (!Array.isArray(stored)) return false;
	const cell = stored.filter(isAnswerText);
	return cell.length === 0 || cell[0] === ASK_SECRET_NOT_PROVIDED;
};

/**
 * The masked field's placeholders, which is where its skip rule is said: the field is
 * the thing a reader is looking at when deciding whether they must fill it, and the
 * question's own prose is the model's and may not mention skipping at both doors.
 * `what you type is never shown` keeps the privacy promise on the VALUE: attached to
 * "skip" as a parenthetical it read as "you will not be asked again" (design round 1,
 * D3). `askSecretPlaceholder` picks one.
 */
export const ASK_SECRET_SKIP_PLACEHOLDER =
	"Leave empty to skip; what you type is never shown";
/**
 * The change form's field over a stored key. It is the only explanation for a disabled
 * `Update answer` there, so it states the requirement rather than an option (D4), and
 * it is short enough to fit the 400px drawer floor's 332px text box (D6).
 */
export const ASK_SECRET_RETYPE_PLACEHOLDER =
	"Required: type it again; it is never shown";
/** Main's copy, kept where an empty field could not be sent as a skip. */
export const ASK_SECRET_PLAIN_PLACEHOLDER = "Your answer (never shown again)";

/** Whether a typed secret value is there to send. */
const secretTyped = (question: PendingAskQuestion, secrets: AskSecrets) =>
	isAnswerText(secrets[question.id] ?? "");

/**
 * THE WHOLE-ASK "AT LEAST ONE REAL ANSWER" RULE, in one place: a non-secret question's
 * answer is real, and a secret's is real only once a value is typed - a skipped secret
 * says nothing. With `secrets` OMITTED it asks whether the question COULD carry a real
 * answer, which is what the placeholder needs before anything is typed
 * (`askSecretPlaceholder`); `askDraftIsComplete` passes the typed values.
 */
const carriesRealAnswer = (
	question: PendingAskQuestion,
	secrets?: AskSecrets,
): boolean =>
	!question.secret || secrets === undefined || secretTyped(question, secrets);

/**
 * The masked field's placeholder, from the SAME two rules the submit reads, so the copy
 * cannot offer what the button refuses (design round 1, D1; review round 1, MINOR 1;
 * QA round 1, Q-1).
 *
 *  - Not skippable (the change form over a stored key): the retype requirement.
 *  - Skippable, and some OTHER question could carry a real answer: the skip copy.
 *  - Skippable but nothing else could carry one (a secret-only, single-question ask,
 *    first answer or change form): main's plain copy, because leaving this field
 *    empty can never produce a send - `Decline` is the way out there.
 */
export const askSecretPlaceholder = (
	ask: PendingAsk,
	question: PendingAskQuestion,
	recorded?: Record<string, string[]>,
): string => {
	if (!askSecretIsSkippable(question, recorded))
		return ASK_SECRET_RETYPE_PLACEHOLDER;
	return ask.questions.some(
		(other) => other.id !== question.id && carriesRealAnswer(other),
	)
		? ASK_SECRET_SKIP_PLACEHOLDER
		: ASK_SECRET_PLAIN_PLACEHOLDER;
};

/**
 * Whether ONE question needs nothing more from the user, between the draft, the
 * typed secrets and (in the change form) the recorded answers.
 *
 * The per-question half of `askDraftIsComplete`, exported so a surface that has to ask
 * "which question still needs me" (Enter in an answer field moves to the next
 * unanswered question instead of sending a partial answer) reads the SAME rule the
 * submit is gated on rather than restating it - two copies of "what counts as an
 * answer" is how a field and its Send button come to disagree.
 *
 * A PENDING `Other` IS NOT AN ANSWER, AND IT IS NOT NEUTRAL EITHER. It is written into
 * the cell as an empty entry (`askCellWith`), and it HOLDS THE QUESTION OPEN even when
 * the cell also carries ticks that would answer it on their own.
 * That is design review round 1's D1: a multi-select with ticks and an `Other` the user
 * had selected but not filled used to be complete on its ticks, so `Send answer` stayed
 * enabled and the control the user had just chosen was silently dropped from the answer
 * that went out. A question is answered when its cell holds at least one non-blank
 * value and no pending entry; the user finishes it by typing, or unticks `Other` to
 * send the ticks alone.
 *
 * A SECRET question is done when a value is typed, or when its field may be left empty
 * as a skip (`askSecretIsSkippable`). A skippable empty secret is therefore not
 * "unanswered": Enter's move to the next unanswered question passes over it, the same
 * way the submit does.
 *
 * Because every submit path reads this rule - the button, Enter, the change form and
 * `askAnswerMap` - a blank STRING can never reach the wire, and the card and its gate
 * cannot disagree about whether the question is done. A skipped secret does reach it,
 * on purpose, as an EMPTY LIST under its id (see `askAnswerMap`).
 */
export const askQuestionIsAnswered = (
	question: PendingAskQuestion,
	draft: AskDraft,
	secrets: AskSecrets = {},
	recorded?: Record<string, string[]>,
): boolean => {
	if (question.secret)
		return (
			secretTyped(question, secrets) || askSecretIsSkippable(question, recorded)
		);
	const cell = draftFor(draft, question.id);
	return cell.some(isAnswerText) && !cell.some(isOtherPending);
};

/**
 * Whether every question in an ask has an answer between the draft and the
 * typed secrets.
 *
 * The whole-ask submit is gated on this rather than on the question in view,
 * because the wire answers an ask ATOMICALLY (design §4) and a partial body is
 * refused by the queue: a Send that could only ever 409 is a control that lies
 * about what it can do.
 *
 * AT LEAST ONE REAL ANSWER, too. Skipped secrets do not count as one, so an ask made
 * only of secrets with every field empty stays unsendable: sending it would say
 * nothing at all, and `Decline` is the control for that.
 */
export const askDraftIsComplete = (
	ask: PendingAsk,
	draft: AskDraft,
	secrets: AskSecrets = {},
	recorded?: Record<string, string[]>,
): boolean =>
	ask.questions.every((question) =>
		askQuestionIsAnswered(question, draft, secrets, recorded),
	) && ask.questions.some((question) => carriesRealAnswer(question, secrets));

/**
 * The most characters one answer value may carry: the wire's own cap on a string in
 * `answers` (`desktop-contract.ts`, `z.string().max(32768)`). The `Other` field stops
 * there and SAYS so; a pinned test parses a value one past it through the real schema,
 * so the two numbers cannot drift apart unnoticed.
 */
export const ASK_ANSWER_MAX_CHARS = 32768;

/**
 * The values in a question's draft cell that its option list did NOT offer, blanks
 * excluded. Used to SEED the card's `Other` state on mount (`askOtherSeed`), because a
 * draft that outlives the card (the drawer collapsed and reopened, the change form
 * seeded from the log) is the only place that text survives.
 */
export const otherValuesOf = (
	cell: readonly string[],
	labels: readonly string[],
): string[] =>
	cell.filter((value) => isAnswerText(value) && !labels.includes(value));

/**
 * THE CARD'S OWN RECORD OF ITS `Other` ENTRY, kept beside the draft cell.
 *
 * `open` is whether the `Other` row is the selected one (single-select) or ticked
 * (multi-select); `text` is what the field holds, UNTRIMMED. Both are card state and
 * NOT derived from the cell, and that is a requirement rather than a convenience:
 *
 *  - The cell is TRIMMED on the way in (the answer that travels carries no padding),
 *    so a field fed from it loses a space typed between two words on the keystroke.
 *  - A text equal to an option's label is indistinguishable from that option in the
 *    cell. A field whose visibility followed the cell unmounted mid-sentence the
 *    moment `No` was typed beside an option `No`, and a multi-select read the
 *    transient `No` as a TICK on the next keystroke, so typing `No, thanks` answered
 *    `["No", "No, thanks"]` - an option the user never chose. Both are pinned as named
 *    regressions in `scripts/ask-other.test.mjs`.
 *
 * Single-select KEEPS `text` while `open` is false, so choosing an option and coming
 * back does not make the user type it again.
 */
export type AskOther = { open: boolean; text: string };

/**
 * The card's `Other` state on mount: open, with the text, when the draft already holds
 * a value the options did not offer. A text that equals an option's label seeds as that
 * option, which is the same answer on the wire.
 *
 * A BLANK ENTRY SEEDS IT OPEN, EMPTY (round 1, D1): that is how a selected-but-empty
 * `Other` is written into the cell, so a card re-mounted over it (the drawer closed and
 * reopened, the change form) draws `Other` selected with its field open and nothing in
 * it - the state the gate is holding the question open for. Seeding it closed would put
 * `Other` back to unselected beside a `Send answer` that is disabled for a reason
 * nothing on the card states. It seeds OPEN, never focused: the focus rule is the
 * card's, and a mount takes none.
 *
 * SEVERAL out-of-list values can only come from a recorded answer written by another
 * surface (a terminal picker adds at most one); they seed the field joined by newlines
 * so none is hidden, and the cell is rewritten as that one text only when the user
 * edits it.
 */
export const askOtherSeed = (
	cell: readonly string[],
	labels: readonly string[],
): AskOther => {
	const values = otherValuesOf(cell, labels);
	return {
		open: values.length > 0 || cell.some(isOtherPending),
		text: values.join("\n"),
	};
};

/**
 * The ticked labels in a cell: the cell without the entry the `Other` field put there.
 *
 * Every non-label entry is Other's by definition. A label-EQUAL Other text is the
 * ambiguous case (see `AskOther`): it is ALWAYS the LAST entry, because
 * `askCellWith` writes it last and a duplicate of a ticked label is kept rather than
 * collapsed, so the last occurrence is Other's and the earlier one, if any, is the tick.
 *
 * PRECONDITION: `other` is the entry that WROTE `cell`, not the one about to replace it.
 * The two travel together in the card (both come from the same render), which is what
 * makes the last-occurrence rule sound; pairing a NEW entry with the old cell reads the
 * transient `No` of a half-typed `No, thanks` as a tick of the option `No`. A caller
 * that computes the next cell therefore reads the ticks FIRST, with the current entry,
 * and only then builds the cell from the next one (`ask-panel.tsx`'s `writeOther`).
 */
export const askTicks = (
	cell: readonly string[],
	labels: readonly string[],
	other: AskOther,
): string[] => {
	const labelled = cell.filter((value) => labels.includes(value));
	const entry = other.open ? other.text.trim() : "";
	if (entry === "" || !labels.includes(entry)) return labelled;
	const at = labelled.lastIndexOf(entry);
	return labelled.filter((_, index) => index !== at);
};

/**
 * The draft cell for these ticks and this `Other` state: the ONE write rule for the
 * explicit `Other` answer, in both select modes.
 *
 * - **Single-select.** `Other` and the option rows exclude each other, so an open
 *   `Other` makes the cell its text alone (or empty), whatever was chosen before; the
 *   caller writes `[label]` itself when an option is pressed.
 * - **Multi-select.** `Other` is ADDITIVE beside the ticks: they keep the order they
 *   were pressed in and the text goes LAST, which is the order the card draws. (The
 *   terminal picker sorts its ticks by option position; this card has always kept
 *   press order and this change does not alter the wire's order for an answer that
 *   uses no `Other`.) A text equal to a ticked label stays as a second entry rather
 *   than collapsing, so removing it later removes the right one; `askAnswerMap`
 *   deduplicates at the wire.
 *
 * AN OPEN `Other` ALWAYS HOLDS ITS PLACE IN THE CELL, and an empty one is NOT AN ANSWER,
 * in either mode (round 1, D1). While the row is selected the cell carries an entry for
 * it - the trimmed text, or a blank when there is none yet - and a blank entry holds the
 * question open (`askQuestionIsAnswered`), so:
 *
 *  - a single-select question whose only selection is an empty `Other` stays incomplete;
 *  - a multi-select with ticks beside an empty `Other` stays incomplete too, where it
 *    used to be complete on its ticks and so DROPPED the row the user had selected
 *    without a word. `Send answer` is disabled until the field has text or the row is
 *    unticked, the same rule single-select already had.
 *
 * The blank entry is a client-side marker and nothing else. It is never an answer: the
 * gate refuses any cell that holds one, so `askAnswerMap` returns null for it and no
 * empty string can reach the wire. It lives in the cell, rather than in a second
 * structure beside it, so it survives the card unmounting the way a tick does
 * (`askOtherSeed` reads it back) and every reader of the cell sees the same state.
 *
 * A CLOSED `Other` contributes nothing, whatever text it remembers.
 *
 * The text is trimmed on the way into the draft and nowhere else: the FIELD keeps what
 * was typed. The terminal picker strips the same way (`state.typed.strip()`).
 */
export const askCellWith = (
	ticks: readonly string[],
	multi: boolean,
	other: AskOther,
): string[] => {
	if (!other.open) return multi ? [...ticks] : [];
	const entry = other.text.trim();
	return multi ? [...ticks, entry] : [entry];
};

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
 *
 * A SKIPPED secret travels as an EMPTY LIST under its id, never omitted and never
 * a blank string: the backend refuses a map that is missing a question id, and an
 * empty list is its spelling of "the user skipped this" (reported to the model as
 * `<not provided>`). `recorded` is the change form's recorded map; see
 * `askSecretIsSkippable`.
 */
export const askAnswerMap = (
	ask: PendingAsk,
	draft: AskDraft,
	secrets: AskSecrets = {},
	recorded?: Record<string, string[]>,
): Record<string, string[]> | null => {
	if (!askDraftIsComplete(ask, draft, secrets, recorded)) return null;
	const answers: Record<string, string[]> = {};
	for (const question of ask.questions) {
		answers[question.id] = question.secret
			? secretTyped(question, secrets)
				? [(secrets[question.id] ?? "").trim()]
				: []
			: /*
				 * DEDUPLICATED, first occurrence kept: an `Other` text that equals a
				 * ticked option's label is kept as a second cell entry (see
				 * `askCellWith`), and on the wire it is the same answer once.
				 *
				 * NO BLANK IS LEFT TO FILTER HERE, and the filter stays regardless: the
				 * completeness check above has already refused any cell that holds one
				 * (a selected-but-empty `Other`), so this is the belt to that brace for
				 * the rule that an empty string never reaches the wire.
				 */
				[...new Set(draftFor(draft, question.id).filter(isAnswerText))];
	}
	return answers;
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
 * secret. The field is therefore empty, and the SAME `askDraftIsComplete` rule the
 * first answer uses gates the submit, handed the recorded map: a secret whose recorded
 * cell is a stored key needs a retyped value, while one the user skipped the first
 * time may stay skipped (`askSecretIsSkippable`).
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
 * "DID A SENTENCE THE BACKEND WROTE CROSS THE WIRE?", in the two shapes it has,
 * extracted so `askRefusalSentence` reads that one answer rather than deciding it twice. *
 * IT ANSWERS THE SENTENCE AND NOT THE VERDICT, and that limit is measured (agent
 * review round 3, BLOCKER): the transport writes sentences too - main's 503
 * `transport.failed` and 504 `deadline_exceeded` envelopes carry an authored
 * `detail.message` ALONGSIDE a status - so "prose crossed the wire" cannot tell the
 * owner's words from the transport's own, which is what `askRefusalIsOwner` needs.
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
 * Whether a refusal is the OWNER's own verdict on this ask, rather than the transport
 * losing sight of the request.
 *
 * IT DECIDES WHETHER §10's CHANGE DOOR MAY SHUT (agent review round 2, minor). The card
 * withdraws the door while a refusal stands, because a control whose only possible
 * outcome is the sentence above it is a second press (design round 1, D1 = UX round 1,
 * U1). A TRANSPORT FAILURE IS NOT A VERDICT: the request never arrived, so nothing was
 * learned about the window - and because the outcome record is never cleared, latching
 * the door shut on one left an answered-undelivered ask with no affordance at all until
 * a remount.
 *
 * THE VERDICT IS THE ASK'S OWN STATE, AND DELIBERATELY NOT THE PROSE (agent review round
 * 3, BLOCKER). The first cut read an authored sentence as the verdict too - any
 * `DesktopControlError` whose `message` was not the placeholder - and the transport's own
 * failures are that shape, so the door shut on every failure the app can hit. Measured by
 * driving the SHIPPED transport over the envelopes each layer really produces: the
 * renderer's own catch (`null` status, "Desktop controls could not reach the backend
 * process."), main's 503 `transport.failed` envelope, main's 504 `deadline_exceeded`
 * envelope, the daemon's `runtime_unreachable` and `runtime_busy` refusals, and a plain
 * 404 with a prose detail ALL classified as the owner's.
 *
 * `status !== null` ALONE IS NOT ENOUGH, and this is why the check is the vocabulary
 * rather than the status: main SYNTHESISES its two transport failures as 503 and 504
 * envelopes carrying an authored `detail.message` (`src/main/desktop-transport.ts`), so
 * the app's most common "the backend is not answering" press still carried a non-null
 * status, an authored sentence and a detail object. What a verdict needs is a statement
 * about THIS ask's own state - the backend's 409/410 refusal, or the expired code
 * (`askRefusalFallback`) - because a status that names none of them is an answer about
 * something else (a 404, a 401/403, a 503/504) and leaves the door open, with the reader
 * free to press again once the wire can answer.
 *
 * THE RETURNED REFUSAL STAYS ON SCREEN EITHER WAY: what the wire said is a fact about the
 * press, reported by `askRefusalSentence` whatever it was. Only the DOOR reads this.
 */
export const askRefusalIsOwner = (error: unknown): boolean =>
	askRefusalFallback(error) !== null;

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
 * The operator's own word for putting an open ask away (harness SA-D5).
 *
 * `answered_in_chat` says the conversation already settled it; `moot` says it is
 * no longer needed. The pair is the wire's whole vocabulary (`Answer.reason` in
 * `server/routes/desktop_sessions.py`), and the labels below are the harness's
 * own (`asks/render.py`'s `DISMISS_REASON_LABELS`), so a receipt reads the same
 * on every surface.
 */
export type AskDismissReason = "answered_in_chat" | "moot";

/**
 * The wire's dismissal reason, narrowed: `answered_in_chat` | `moot`, or null.
 *
 * ONE reader for the two directions the value travels (the request body this app
 * composes, and the settled row harness PR-4c publishes): a string the enum does not
 * name is not a reason this surface can print, and guessing the nearest one would be
 * the app inventing what the operator chose. `null` says "cannot say", which every
 * caller renders as the contract's own no-reason sentence.
 */
export const askDismissReason = (value: unknown): AskDismissReason | null =>
	value === "moot" || value === "answered_in_chat" ? value : null;

/**
 * The `sessions.answer` body for a dismissal: put an OPEN ask away without
 * answering it (`{ask_id, dismiss: true, reason?}`).
 *
 * The sibling of `askDeclineRequest`, and a constructor of its own for the same
 * reason: a dismissal is the alternative TO an answer, not a modifier the client
 * could accidentally send on one — the route refuses the two shapes together.
 */
export const askDismissRequest = (
	ask: PendingAsk,
	sessionId: string,
	reason: AskDismissReason,
): {
	op: "sessions.answer";
	sessionId: string;
	askId: string;
	dismiss: true;
	reason: AskDismissReason;
} => ({
	op: "sessions.answer",
	sessionId,
	askId: ask.ask_id,
	dismiss: true,
	reason,
});

/**
 * The outstanding-asks chip's copy, for the mark a sidebar conversation row
 * carries (`ChatAsksOutstanding` in `chat-session-status.tsx`).
 *
 * It is deliberately NOT the approval chip's words. An approval is blocking; an
 * ask is not, and the session may be working perfectly well while it waits - so
 * the chip says what is outstanding and never "waiting for you".
 */
export const asksOutstandingLabel = (open: number): string =>
	open === 1 ? "1 ask" : `${open} asks`;
