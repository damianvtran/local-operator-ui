/**
 * The aside's non-visual half: asking, adopting, closing, and the one chord.
 *
 * WHY THIS IS A MODULE AND NOT A COMPONENT'S BODY. Three callers share these
 * operations — the `/btw` dispatcher (which opens the panel), the composer (whose
 * Enter continues the open aside) and the panel's own controls — and the rules
 * the panel paints are pure functions of store state. Keeping them here means the
 * panel is a renderer and nothing else, and it means the chord, the readiness
 * gate and the refusal sentence are assertable without a DOM
 * (`scripts/btw-aside.test.mjs`), which is the same argument `new-chat-shortcut.ts`
 * and `ask-answer.ts` make for their own predicates.
 *
 * THE POST IS THE ONLY WAY A QUESTION LEAVES. `sessions.aside` is the frozen
 * interface's op; `requestId` is generated here and is ALSO the aside's id, which
 * is why the store entry is registered before the request is sent (see the
 * store's header): the backend publishes `aside_delta` frames under that id from
 * the first chunk.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it does not read the composer's
 * budget or its attachments. Those refusals belong to the send path that owns the
 * composer (`chat-page.tsx`'s `send`), which runs them BEFORE reaching here, so a
 * caller that skips them (the `/btw` command, whose text never was in the box)
 * cannot silently bypass a check that exists elsewhere.
 */
import {
	DesktopControlError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { resyncCanonicalSession } from "@shared/hooks/use-canonical-session";
import {
	type AsideStream,
	asideTurnIsCarried,
	lastAnsweredAsideId,
	lastAsideStream,
	lastAsideTurn,
	previousAsideId,
	useAsideStore,
} from "@shared/store/aside-store";
import { v4 as uuidv4 } from "uuid";

/** The aside POST's own answer, spelled once so the shape is not re-derived. */
type AsideAnswer = {
	data: { aside_id: string; text: string; off_record: boolean };
};

/** The quoted question's own whitespace collapse, hoisted for the whole module. */
const RE_WHITESPACE_RUN = /\s+/g;

/** The sentence break the announced answer is cut at, hoisted for the same reason. */
const RE_SENTENCE_END = /(?<=[.!?])\s/;

/** The sentence a refused ask is stated with, wherever it is stated.
 *
 * ONE COMPOSITION FOR EVERY SURFACE. The panel states a refusal on the turn
 * (`failAside`) and the door that asked states the same one when the panel is
 * gone (`reportUncarriedAsideRefusal`); two spellings of the same fact
 * would read as two different facts, which is why the composition lives here
 * rather than at either call site.
 */
export function asideAskFailure(error: unknown): string {
	return userFacingMessage(error, "The aside was not answered.");
}

/**
 * The two refusal codes the owner uses when the MODEL declines inside an exchange
 * the owner still holds.
 *
 * The wire's codes, not this app's: `aside_unanswered` covers a bare tool call (or
 * nothing at all) on the corrected retry, and `aside_empty_answer` subclasses it
 * for a settled answer carrying no text. They are spelled here rather than imported
 * because the owner owns them; `ASIDE_NOT_ANSWERED_CODE` in the store is this app's
 * own code for its own composer line and answers a different question.
 */
const ASIDE_MODEL_REFUSAL_CODES = new Set([
	"aside_unanswered",
	"aside_empty_answer",
]);

/**
 * Whether a refusal is the MODEL declining inside an exchange the owner still holds.
 *
 * THE DISTINCTION IS STRUCTURE, NOT PROSE. A prefix the owner no longer holds is
 * refused with a plain string and NO code (`This aside is no longer available`), and
 * a model refusal carries one of the two codes above on `DesktopControlError.code`,
 * so the two are separable without reading either sentence - which matters because
 * the sentences are the owner's copy and a client that matched them would go stale
 * in silence (`UNKNOWN_FIELDS_REFUSAL` records that cost for one sentence already).
 * A refusal with no code at all, a transport failure included, is NOT a model
 * refusal: nothing about it says the exchange is unusable.
 */
export function asideModelDeclined(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		error.code !== undefined &&
		ASIDE_MODEL_REFUSAL_CODES.has(error.code)
	);
}

/**
 * The sentence a refusal is printed with when the ask CONTINUED an exchange the
 * owner will no longer continue.
 *
 * A REFUSED CONTINUATION IS THE ONE REFUSAL THE PANEL CANNOT RECOVER FROM BY
 * ITSELF (UX round 1, U1). The owner refuses a continuation whose prefix it no
 * longer holds, so the panel's `ask again` is advice the user cannot act on from
 * where they are - while the way out that does work, Escape and a fresh `/btw`, is
 * not written anywhere. The clause is appended only where it is true: a FRESH ask
 * opens a clean entry, so its refusal needs no escape hatch and printing one would
 * send the user away from a panel that had already recovered by itself.
 *
 * AND NOT TO EVERY REFUSED CONTINUATION EITHER (UX round 2, U11; agent review round
 * 5, R5-1). The owner turns a continuation away for two unrelated reasons and only
 * one of them costs the prefix. When the MODEL declines - a tool call off the
 * record, an empty answer - the owner pops that ask's own entry and restores the
 * prefix, so the panel is still continuable and the next question asked in it is
 * answered (driven: a retry in place came back answered 4.7s later). Printing this
 * clause there was the round-1 defect inverted - a sentence that sounds final and is
 * not true of the panel the user is looking at - and it was destructive as well as
 * false: it arrived directly after the owner's own `ask again`, and following it
 * discards the whole off-the-record exchange, answers included, which nothing
 * brings back. Hence {@link asideModelDeclined} among the terms.
 *
 * THE CLAUSE NAMES WHAT ESC COSTS, because here it is the only way out and it is
 * not free: closing drops the exchange on screen, answers included, and nothing
 * brings it back (the operator's ruling on U11 - Esc's destruction needs its own
 * warning, wherever the panel sends the user to it).
 */
export const ASIDE_CONTINUATION_ESCAPE =
	"This aside can't continue. Press Esc to close it, which discards this exchange, then start a new one with /btw.";

/**
 * The two real options after the MODEL declined a follow-up, and what each costs.
 *
 * WHY THE PANEL SAYS MORE THAN THE OWNER'S `ask again` HERE (UX round 2, U11; the
 * operator's ruling on its shape). The owner's sentence is true - asking again in
 * this panel works, the retry came back answered 4.7s later - but it is the only
 * option it names, and the one a user reaches for when a panel seems stuck is Esc,
 * which throws the whole off-the-record exchange away. A refusal that stays silent
 * about that cost lets the user pay it by accident, so the panel states both roads:
 * asking here keeps the exchange, closing discards it.
 *
 * IT OPENS WITH THE REMEDY THE OWNER'S SENTENCE NO LONGER ENDS WITH (UX round 3,
 * U18): this clause is appended to that sentence with its trailing `ask again.`
 * trimmed (see `RE_OWNER_TRAILING_REMEDY`), so the verb here is the only statement of
 * it and the clause cannot be shortened without taking the remedy off the panel.
 *
 * Only on a CONTINUATION: a fresh ask that the model declined has no answered turn
 * above it, so Esc there costs nothing and the owner's own sentence is enough (U1's
 * rule that a clause is printed only where it is true).
 */
export const ASIDE_DECLINED_OPTIONS =
	"Ask again here to keep this exchange, or press Esc to close the aside and discard it.";

/**
 * The remedy the owner's declined sentence ENDS with, which this panel then repeats.
 *
 * WHY IT IS TRIMMED (UX round 3, U18). Composed, the refusal read `... No answer was
 * produced: ask again. Ask again here to keep this exchange, or press Esc to close the
 * aside and discard it.` - the remedy stated twice in a row, so the one thing a stuck
 * user needs to hear (that asking works HERE, and what Esc costs) sat behind a stutter,
 * and at narrow the refusal is seven rows of red text in a 232px region.
 *
 * The sentence is the OWNER's copy and this panel does not rewrite it; it drops the
 * duplication's trailing half only where its own clause states the remedy, which is the
 * shape `asideOffPanelRefusal` takes for the same sentence when it keeps the act and
 * drops the enumeration.
 *
 * IF THE OWNER REWORDS IT NOTHING BREAKS: the trim matches nothing, the sentence keeps
 * its own ending, and the clause is appended unchanged - back to the reading U18
 * reports rather than to something new, so the failure mode is the one this fixes and
 * not a new one.
 */
const RE_OWNER_TRAILING_REMEDY = /\s+[Aa]sk again\.$/;

/**
 * The sentence the PANEL states a refused ask with.
 *
 * The owner's own sentence, which is the only text that says WHY (a tool call off
 * the record, an empty answer, a store at its bound) - plus the escape clause when
 * that sentence was a continuation the owner can no longer continue, or the two-way
 * clause when the model declined inside one it still can.
 */
export function asidePanelRefusal(error: unknown, continued: boolean): string {
	const sentence = asideAskFailure(error);
	if (!continued) return sentence;
	if (!asideModelDeclined(error))
		return `${sentence} ${ASIDE_CONTINUATION_ESCAPE}`;
	return `${sentence.replace(RE_OWNER_TRAILING_REMEDY, "")} ${ASIDE_DECLINED_OPTIONS}`;
}

/**
 * How much of a question an OFF-PANEL refusal quotes.
 *
 * The panel does not need this: it paints the question directly above the alert.
 * The two off-panel surfaces do, because the panel and its question are gone - and
 * the `/btw` door consumed the draft at the press, so nothing else on screen names
 * what failed (design round 2, D8). Sixty characters is the caption shape this
 * tree already quotes user text in (`archiveOfferedName`), and it fits the widest
 * sentence in the composer's line at the minimum window.
 */
export const ASIDE_QUOTED_QUESTION_CHARS = 60;

/**
 * The question as an off-panel refusal quotes it: short, and never cut mid-ellipsis.
 */
export function asideQuotedQuestion(question: string): string {
	const trimmed = question.trim().replace(RE_WHITESPACE_RUN, " ");
	return trimmed.length > ASIDE_QUOTED_QUESTION_CHARS
		? `\u201c${trimmed.slice(0, ASIDE_QUOTED_QUESTION_CHARS - 1)}\u2026\u201d`
		: `\u201c${trimmed}\u201d`;
}

/**
 * The sentence an OFF-PANEL surface states a refused ask with.
 *
 * ONE COMPOSITION FOR BOTH DOORS (UX round 1, U4 with design round 2, D8). The
 * composer's error line and the `/btw` door's transcript note are the surfaces
 * that exist because the panel does not, and they were stating the owner's
 * sentence alone - which names no question, while the sentence themselves end in
 * `ask again`. One of the two doors had also lost the text the advice referred to
 * (that door consumed the whole draft at the press), so the pair to be reunited is
 * exactly the question and what became of it.
 */
export function asideOffPanelRefusal(question: string, error: unknown): string {
	return `Your aside ${asideQuotedQuestion(question)} got no answer: ${asideOffPanelCause(error)}`;
}

/**
 * How long an OFF-PANEL refusal may be, in characters.
 *
 * WHY THERE IS A BUDGET AT ALL (design round 3, D14). The composer's error line
 * caps itself at `CAPPED_BLOCK` - six whole rows of `leading-5`, i.e. 120px - and
 * scrolls whatever exceeds it, so a longer sentence puts its own tail out of sight.
 * With the owner's sentence for a model refusal and a 60-character question, the
 * composed sentence measured seven rows at the app's minimum window and the half
 * that was cut was `ask again`: the operator read a refusal and no way out of it,
 * which is the same class of loss the composer's own remedy controls were moved out
 * of that window to fix (UX round 1, U3).
 *
 * THE NUMBER IS DERIVED RATHER THAN CHOSEN. The cap is 120px at 20px leading, so six
 * rows; the composer's narrowest track is 236-252px, and 13px text in this app's
 * body face fits about 34 characters of it per row - 6 x 34 = 204, of which 200
 * leaves the rounding a margin. It is a CHARACTER budget because this module has no
 * font and no DOM (this file's header), so the constraint has to be arithmetic on
 * the string. A second cap on the row count, rather than a longer sentence, is also
 * what the panel does NOT need: the panel has no cap and states the owner's whole
 * sentence.
 */
export const ASIDE_OFF_PANEL_MAX_CHARS = 200;

/**
 * The cause as an OFF-PANEL surface states it.
 *
 * The owner's own sentence wherever it fits, because it is the only text that says
 * WHY. The one arm that does not fit is the model refusal, whose sentence enumerates
 * its three causes and runs to 156 characters on its own; every other refusal this
 * path sees is short (`This aside is no longer available` is 32, the field refusal
 * 32), so the short form is keyed on {@link asideModelDeclined} and nothing else.
 *
 * THE SHORT FORM KEEPS THE ACT AND THE REMEDY AND DROPS THE ENUMERATION. The act
 * the owner names in that sentence is that the model did not answer in text, and the
 * remedy is to ask again; what it adds is a list of the ways that happens, which the
 * PANEL still states in the owner's own words on the surface with no cap. The remedy
 * is ours here and it is deliberately NOT `with /btw`: for this arm asking again in
 * the SAME panel is what works (U11's own driven measurement - the retry in place
 * came back answered 4.7s later), so a short form that sent the user to a new aside
 * would be U11's defect with fewer words.
 */
function asideOffPanelCause(error: unknown): string {
	return asideModelDeclined(error)
		? "The model didn't reply in text. Ask again."
		: asideAskFailure(error);
}

/**
 * Why an ask is refused in the APP, before it is sent - or null when it is not.
 *
 * A FOLLOW-UP SENT WHILE THE EXCHANGE IS STILL ANSWERING (UX round 1, U2). The
 * owner marks the entry it is answering `running` and refuses a continuation of it
 * with 409, so the follow-up that the composer's own liveness invited - the box
 * stays typable on purpose while an answer streams - emptied the box, painted the
 * question, and then failed with "no longer available". The press is refused HERE
 * instead: while the newest answer is still in flight the question stays in the
 * composer, where it can be sent the moment the answer settles.
 *
 * `streaming` is the owner's `running` as this store records it: true from
 * `beginAsk` until the POST returns (`AsideStream`), which is precisely the window
 * the owner refuses a continuation in - NOT the window the deltas paint. The
 * distinction matters, because the text of an answer can be complete on screen
 * while its POST is still in flight, and the prefix is unusable until the owner
 * says otherwise.
 *
 * A FAILED NEWEST TURN IS NOT BUSY, deliberately: its entry was dropped, so the
 * next question starts a clean one (U1), and a gate that held the box until the
 * user closed the panel would be the dead end U1 is about.
 *
 * THE SENTENCE CARRIES THE MOMENT, SO THE RETRY IS NOT WITHHELD BEYOND IT (UX round
 * 2, U12; agent review round 5, R5-5; design round 3, D13). It used to end at "send
 * the question when it finishes", which says WHEN without saying HOW, and the
 * composer's own generic retry suffix then appended "Send it again" directly under
 * it - one line telling the user to wait and to press now. The press is a press of
 * Enter on the text the box is still holding, so the sentence names it, and the
 * composer withholds its suffix through `ASIDE_STILL_ANSWERING_CODE` while this line
 * is up.
 */
export const ASIDE_ASK_BUSY =
	"The aside is still answering. Press Enter again once the answer is in.";

export function asideAskBlockedReason(
	state: Parameters<typeof lastAsideStream>[0],
	sessionId: string,
): string | null {
	return lastAsideStream(state, sessionId)?.streaming ? ASIDE_ASK_BUSY : null;
}

/**
 * State a refused ask on the caller's own surface when the panel no longer holds
 * the turn it was asked under.
 *
 * WHY THIS IS SHARED. Both doors that ask - the composer's Enter
 * (`chat-page.tsx`) and the one-Enter `/btw <question>` command
 * (`slash-dispatch.ts`) - hand the box back at the press and do not await the
 * answer, so both reach the same state: the user closes the panel before the
 * answer, `detachAside` deletes the turn AND its stream entry, and `failAside`
 * then has nothing to write the refusal on. The question left the screen with the
 * panel and the text is deliberately not restored, so the caller is the only
 * surface that still knows the ask happened. The composer door answered for that
 * state and the command door swallowed it (review round 3, F9); one rule in one
 * place is how the two doors stop disagreeing.
 *
 * WHICH SURFACE STATES IT. The panel owns the exchange and states the refusal on
 * the turn it is holding (`askAside` writes it there), so while that turn exists
 * this reports nothing - a second copy of the panel's sentence would be a second
 * place for the two to drift. The question is read off the STORE at the moment of
 * the refusal rather than off the click that closed the panel: a reopened panel
 * (a bare `/btw`, a new empty attachment) holds none of this ask's turns either,
 * which the stream entry's absence answers and the attachment's presence does not.
 *
 * THE QUESTION TRAVELS WITH THE SENTENCE (UX round 1, U4; design round 2, D8).
 * This is the one surface pair left once the panel is gone, and the owner's
 * sentence neither quotes the question nor can: the `/btw` door consumed the draft
 * at the press, and the composer's box holds whatever the user typed SINCE, so the
 * question exists nowhere else by the time this runs. It is composed here, in the
 * same tick as the ask, for the reason the id is (`lastAsideTurn`).
 *
 * `report` is the caller's no-surface channel, a parameter because the two doors
 * have different ones: the composer's error line (`setSendError`) and the
 * dispatcher's transcript note. The sentence is composed by `asideOffPanelRefusal`,
 * so both surfaces spell a refusal the same way.
 *
 * WHAT IT CANNOT DO, AND WHY THAT IS ACCEPTED (review round 4, F13). Both
 * reporters close over the pane that asked, and a pane is keyed by the session's
 * identity (`chat-page.tsx`), so a user who closes the panel, switches
 * conversation and only then has the refusal land sets state on an unmounted pane:
 * the sentence is composed correctly and goes nowhere. The narrowing is real -
 * by then the user has dismissed the question and left the conversation, and the
 * aside's answer is off the record by construction - so the state is accepted
 * rather than papered over, and stated here so the next reader does not read the
 * helper's silence as delivery.
 *
 * MUST BE CALLED IN THE SAME TICK `askAside` RETURNED IN. The turn is read here
 * with `lastAsideTurn`, and that is this ask's own turn only because
 * `beginAsk` runs synchronously inside `askAside`, before its POST; an `await`
 * between the two would let a follow-up register first and name ITS turn. It
 * also handles the rejection, so a caller that has nothing else to do with the
 * promise leaves no unhandled rejection behind.
 */
export function reportUncarriedAsideRefusal(
	ask: Promise<unknown>,
	sessionId: string,
	report: (sentence: string) => void,
): void {
	const askingTurn = lastAsideTurn(useAsideStore.getState(), sessionId);
	void ask.catch((error) => {
		const state = useAsideStore.getState();
		if (askingTurn && asideTurnIsCarried(state, askingTurn.asideId)) return;
		report(asideOffPanelRefusal(askingTurn?.question ?? "", error));
	});
}

/**
 * The desktop plane's own refusal of a body whose FIELDS it will not take.
 *
 * It is one sentence for every rejected field, and it is the WHOLE evidence an
 * older owner leaves: `server/app.py`'s `RequestValidationError` arm answers a
 * `/v1/desktop/` path with this string instead of pydantic's default body, so a
 * daemon that does not know `subscription_id` answers 422 with no `loc`, no
 * field name and no code to read. Quoted here because it is the only thing that
 * separates "this owner forbids the field" from every other 422 — see
 * `refusedTheSubscriptionField`. The producer is
 * `local_operator/server/app.py` (`invalid fields`). THE BLAST RADIUS OF A
 * REWORDING IS EVERY ASK, NOT ONE REQUEST: an older owner that still forbids the
 * field but words its refusal differently no longer matches here, so the retry
 * never fires, the session is never remembered as fieldless, and every ask to
 * that owner fails with the refusal stated on the panel and no answer - until the
 * owner is updated or this sentence follows it. That is why the match is on the
 * producer's exact string and why the producer is named: a change to one side has
 * to be made to both.
 */
const UNKNOWN_FIELDS_REFUSAL = "The request has invalid fields.";

/**
 * Whether a failed ask is an owner refusing the field THIS app sent.
 *
 * Keyed on the response's own evidence and never on the status alone: a 422
 * that carries anything else (a route's own refusal - `/asides` answers one for
 * a malformed exchange, `Adopt` for an unconfirmed one) is an ordinary failure
 * that keeps its retry budget, and it is the sentence above, not the number,
 * that says which of the two this is. `weSentTheField` is the other half of the
 * proof, and it is this app's own record of the request rather than an
 * inference: an ask that named no subscription has nothing to drop, so a 422
 * against it cannot be this.
 */
function refusedTheSubscriptionField(
	error: unknown,
	weSentTheField: boolean,
): boolean {
	return (
		weSentTheField &&
		error instanceof DesktopControlError &&
		error.status === 422 &&
		error.message === UNKNOWN_FIELDS_REFUSAL
	);
}

/**
 * Sessions whose owner has already refused `subscription_id`.
 *
 * RELEASE SKEW, AND WHY THE CLIENT IS THE ONE THAT YIELDS. The field is
 * accepted only by a daemon built from the change that added it, and the body
 * model forbids unknown keys repo-wide, so an older owner answers 422 to every
 * body that carries it. The owner cannot be fixed from here, so this window
 * asks with the field, drops it once (below) and then REMEMBERS, rather than
 * paying a refused request on every ask for the rest of the session. The field's
 * absence behaves exactly as it did before the field existed: the aside still
 * runs, the POST's text still settles the answer, and no live frames are
 * published (the panel then shows the settled answer with no streaming, which is
 * the honest cost of the older owner).
 *
 * Bounded like this tree's other registries (`echoTargets`): a window talks to
 * ONE owner, so the set is as large as the sessions a user asked an aside in,
 * and the oldest goes first. Per-window and per-session by construction: an
 * owner that is updated underneath a live window keeps the cheaper ask until the
 * window reloads, which again costs the live half and never the answer.
 */
const fieldlessOwners = new Set<string>();
const MAX_FIELDLESS_OWNERS = 64;

function rememberFieldlessOwner(sessionId: string): void {
	fieldlessOwners.add(sessionId);
	while (fieldlessOwners.size > MAX_FIELDLESS_OWNERS) {
		const oldest = fieldlessOwners.values().next().value;
		if (oldest === undefined) return;
		fieldlessOwners.delete(oldest);
	}
}

/**
 * Attach an EMPTY aside panel to this session's composer (a bare `/btw`).
 *
 * No request is sent: there is no question yet, and the panel's whole job in this
 * state is to say that the next thing typed into the composer will be asked off
 * the record. An aside already open is left exactly as it is — the exchange on
 * screen is the one the new question would continue.
 */
export function openAsidePanel(sessionId: string): void {
	useAsideStore.getState().attachAside(sessionId);
}

/**
 * Ask the aside a question, continuing the session's open exchange.
 *
 * Returns the id the answer streams under, which is the request id this call
 * generated — the same id the response names, and the one the panel already
 * subscribed to. Throws on a refusal AFTER recording it on the turn, so the
 * panel states the reason.
 *
 * THE RETURNED PROMISE IS THE ANSWER'S, NOT THE QUESTION'S, and a caller may
 * therefore IGNORE it. The turn and its stream entry are registered by
 * `beginAsk` SYNCHRONOUSLY, before the request leaves, which is what lets the
 * panel paint the question and its thinking state in the same commit the
 * composer's box empties — and what lets the composer hand the box back to the
 * user at the press rather than at the answer (see `chat-page.tsx`'s aside
 * branch, and `slash-dispatch.ts`'s own note on the same trade). A refusal is
 * recorded on the panel by this function whether or not the caller waits.
 *
 * `subscriptionId` NAMES THE VIEWER THAT WANTS THE CHUNKS. The stream is read by
 * every attached viewer of a session, so an owner that routes `aside_delta` to
 * the requesting subscription needs this id or the caller receives none of them;
 * it is the `open` frame's `payload.subscription_id`, kept on the canonical
 * view and passed in by the call site that holds it. Undefined when the stream
 * has not opened yet, which costs the live half and not the answer.
 *
 * A WELL-FORMED ID THIS OWNER DOES NOT HOLD IS A DOCUMENTED LIMITATION, and it
 * is stated here because this parameter is where the id is chosen. The owner
 * publishes no frames for an id no live subscription owns and reports nothing
 * back about it (the POST answers with the whole answer as usual), so the panel
 * paints its thinking state for the length of the model call and then the settled
 * text in one piece — indistinguishable, on screen, from a slow model (QA round
 * 1, Q3). It is a fault this app cannot produce: the id comes from the stream's
 * OWN `open` frame and every stream-failure path sets it back to `null`
 * (`use-canonical-session`), so a wrong id means the owner and the viewer
 * disagree about a subscription that both believe is live. The compatibility
 * retry below does NOT cover this case either: it fires on an owner that REFUSES
 * the field, never on one that accepts it and has nothing routed to it. Closing
 * it properly means the owner reporting the delivery back (or the viewer
 * discarding an id whose subscription has been replaced), neither of which is
 * this app's to infer; the panel's degrade is the documented one.
 */
export async function askAside(
	sessionId: string,
	question: string,
	subscriptionId?: string,
): Promise<string> {
	const asideId = uuidv4();
	const store = useAsideStore.getState();
	/*
	 * The prefix is read BEFORE the ask is registered, because `beginAsk` appends
	 * this turn and a continuation is defined by what the exchange held up to it -
	 * and it is the last ANSWERED turn rather than the last turn, because a refused
	 * ask's entry is dropped by the owner and naming it gets every later question in
	 * that panel the same 409 (UX round 1, U1; see `lastAnsweredAsideId`).
	 */
	const continuation = lastAnsweredAsideId(store, sessionId);
	store.beginAsk(sessionId, asideId, question);
	/*
	 * The ask is ONE operation with ONE registration, whatever the wire takes: the
	 * turn above is the panel's, the settle/fail below is the panel's, and the
	 * request below may be sent twice only to find out which body this owner
	 * accepts. Nothing is registered, settled or failed twice, so the retry cannot
	 * double-charge the panel — and it cannot double-run the aside either, because
	 * an owner that refuses the field refuses the BODY (validation precedes the
	 * route), so the refused request never reached the model.
	 */
	const ask = (withField: boolean) =>
		desktopResult<AsideAnswer>({
			op: "sessions.aside",
			sessionId,
			requestId: asideId,
			text: question,
			asideId: continuation,
			subscriptionId: withField ? subscriptionId : undefined,
		});
	const withField = Boolean(subscriptionId) && !fieldlessOwners.has(sessionId);
	try {
		let value: AsideAnswer;
		try {
			value = await ask(withField);
		} catch (error) {
			if (!refusedTheSubscriptionField(error, withField)) throw error;
			/*
			 * The owner is older than the field. Remembered BEFORE the retry, so a
			 * second ask cannot pay the refused request again even if the retry itself
			 * fails, and then asked exactly once without it.
			 */
			rememberFieldlessOwner(sessionId);
			value = await ask(false);
		}
		/*
		 * The RESPONSE's text is authoritative and REPLACES what the deltas
		 * accumulated: a chunk lost to a slow subscription or delivered twice
		 * self-heals here rather than being shown (see `AsideStream`).
		 *
		 * Settled under the request id rather than `value.data.aside_id`, and the
		 * two are equal by the frozen interface (the route answers
		 * `aside_id: body.request_id`) while only the request id is what the live
		 * frames are keyed by — so the id that can never disagree with the stream
		 * is the one used.
		 */
		useAsideStore.getState().settleAside(asideId, value.data.text);
		return asideId;
	} catch (error) {
		/*
		 * The panel states this on the turn it is holding — but only while it still
		 * holds one, and that is not a detail: `detachAside` deletes a panel's turns
		 * AND their stream entries, so a user who closed the panel before the answer
		 * arrived leaves `failAside` with nothing to write on and the refusal with no
		 * surface at all. The caller reads that off the SAME store entry this write
		 * consults (`asideTurnIsCarried`), and states the refusal on its own surface
		 * when there is nothing left to carry it — see `reportUncarriedAsideRefusal`,
		 * which both doors call.
		 */
		useAsideStore
			.getState()
			.failAside(asideId, asidePanelRefusal(error, continuation !== undefined));
		throw error;
	}
}

/**
 * Promote the exchange into the conversation, as a real turn.
 *
 * The control is gated by {@link asideAdoptReady}, and this function re-checks
 * nothing: the gate is the panel's, the backend refuses an unfit aside with its
 * own code (409 on an odd exchange, on an already-adopted one), and a second
 * check here would be a second place for the two to disagree.
 *
 * On success the panel is DETACHED rather than left up showing an exchange that
 * is now in the transcript: the rows themselves are the receipt, so a sentence
 * saying so would be the app telling the user what they can already read (§ 7's
 * completed action — one quiet line, and here not even that).
 *
 * THE RECEIPT HAS TO BE MADE TO EXIST, WHICH IS WHY THIS RE-READS THE SESSION.
 * The owner appends the exchange to its journal and to its live context and
 * ANNOUNCES NOTHING: no `event` frame carries the two messages and the frontend
 * refresh watermark is not advanced, so no viewer of this session is told and a
 * pane that never re-reads keeps showing the conversation without them (QA round
 * 1, Q2 — measured: the rows are in the owner's journal at 0/3/10 s and the
 * transcript painted none of them in 20 s, nor on re-entering the pane). A pane
 * that has not re-read cannot paint rows it was never handed, so the surface
 * that pressed the control asks its own pane to read again — the same seam the
 * Schedules page uses for its own out-of-band writes (`resyncCanonicalSession`,
 * which re-opens this session's subscription without a cursor so the answer is a
 * fresh snapshot). The rows that land are the OWNER's durable ones, not a local
 * splice of the text this window happens to hold, so they carry the ids a later
 * page read coalesces on and no row can be painted twice.
 *
 * A SECOND VIEWER IS THE OTHER HALF, AND IT IS NOT THIS APP'S TO CLOSE. Another
 * window attached to the same session receives nothing either, because there is
 * nothing on the wire to receive; only the owner can tell it, and the companion
 * backend change is where that belongs (see the PR review's Q2). What this call
 * fixes is the one viewer that has a reason to look: the one whose user pressed
 * Adopt.
 */
export async function adoptAside(sessionId: string): Promise<void> {
	const store = useAsideStore.getState();
	const asideId = previousAsideId(store, sessionId);
	if (!asideId) return;
	try {
		await desktopResult({
			op: "sessions.adopt",
			sessionId,
			requestId: uuidv4(),
			asideId,
			confirmed: true,
		});
	} catch (error) {
		store.setAsideNotice(
			sessionId,
			userFacingMessage(error, "The aside was not added to the conversation."),
		);
		throw error;
	}
	/*
	 * Asked AFTER the POST, because the rows are durable only once it has answered
	 * (`Session.adopt_aside` persists before it adopts, and the route's receipt
	 * settles after that): a re-read issued before the write would find the
	 * conversation exactly as it was and the exchange would still be missing.
	 */
	resyncCanonicalSession(sessionId);
	useAsideStore.getState().detachAside(sessionId);
}

/**
 * Close the panel, and release the aside it was holding.
 *
 * WHICH ID "IT" IS (UX round 3, U19). The copy this call serves sends the user to
 * Escape to "close the aside and discard it", so the entry the DELETE names has to
 * be the one the OWNER holds the exchange under. That is not the newest turn. A
 * continuation copies its prefix's turns into a NEW entry keyed by its own request
 * id and marks the prefix adopted, so after a REFUSED follow-up the newest turn's id
 * names an entry the owner dropped with the refusal - measured: `DELETE
 * /v1/desktop/sessions/.../asides/<refused turn id>` answered `404` while the entry
 * holding the whole exchange answered `GET` `200` with `turns: 2`, `complete: true`,
 * and was still `200` 9.9s later. The id the ASK path continues from is exactly the
 * entry that holds the exchange (`lastAnsweredAsideId`), so closing names that one
 * and the sentence and the owner agree in both arms: an answered exchange is deleted
 * by its newest answered turn, and a refused follow-up deletes the exchange the
 * refused turn belongs to rather than the turn itself.
 *
 * THE NEWEST TURN IS STILL THE FALLBACK, for the one state that has no answered turn
 * at all: a FIRST ask the model refused. There the owner has either dropped the entry
 * (nothing to release, and the silent `404` is the same cost as today) or is still
 * holding it, and no other id could name it.
 *
 * The DELETE is best-effort and its failure is deliberately silent: the aside
 * store is bounded on the backend (`64` entries, an hour's expiry) so an
 * unreleased one is a small, self-clearing cost, while the one failure it
 * actually produces is the ordinary race this call cannot avoid — a DELETE that
 * arrives while the ask is still running is answered `409`, and reporting that
 * would put an error on a panel the user has just dismissed. The panel is
 * detached either way, because closing is the user's instruction and the
 * cleanup is not.
 */
export function closeAside(sessionId: string): void {
	const store = useAsideStore.getState();
	const asideId =
		lastAnsweredAsideId(store, sessionId) ?? previousAsideId(store, sessionId);
	if (asideId) {
		void desktopResult({
			op: "sessions.aside.close",
			sessionId,
			asideId,
		}).catch(() => {});
	}
	useAsideStore.getState().detachAside(sessionId);
}

/**
 * The press the adopt chord is built on.
 *
 * `f` is the TUI's own key for this gesture (`^f` folds an open aside into the
 * chat) and the modifier is the app's usual spelling of a chord — either `⌘` or
 * `Ctrl`, as `new-chat-shortcut.ts` argues for its own. `shift`/`alt` are other
 * apps' chords (`⌘⇧F` is not this), a held key repeats and would adopt twice, and
 * an IME's own Escape/selection presses are not this either.
 *
 * NO SCOPE TEST FOR A MODAL OR AN OVERLAY, unlike the app-level chord: this one
 * is bound inside the composer's own keydown, so a press that reaches it is a
 * press in the composer by construction, and a dialog (which moves focus out of
 * the box) never reaches it at all.
 */
export function asideAdoptChord(event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	repeat?: boolean;
	isComposing?: boolean;
	defaultPrevented?: boolean;
}): boolean {
	if (event.defaultPrevented || event.repeat || event.isComposing) return false;
	if (event.shiftKey || event.altKey) return false;
	if (event.key.toLowerCase() !== "f") return false;
	return event.metaKey || event.ctrlKey;
}

/**
 * The cap the panel prints for that chord, in the platform's own spelling.
 *
 * Takes `isMac` rather than the platform string, the shape `newChatShortcutCap`
 * and the palette's caps use: the decision stays a pure function of one boolean
 * so both spellings are assertable without a DOM, and the caller derives the
 * boolean the way this app already does.
 */
export const asideAdoptCap = (isMac: boolean): string =>
	isMac ? "⌘+F" : "Ctrl+F";

/**
 * The sentence the FIRST adopt chord puts on the panel instead of adopting.
 *
 * WHY THE CHORD ASKS ONCE (UX round 2, U16; the operator's ruling). `⌘+F` is Find
 * in every browser and in this app's own canvas editors, and adopting is the one
 * act on this panel that cannot be taken back: the off-the-record exchange enters
 * the model's context for good. Measured before this: the panel was gone 52ms
 * after the press, with no confirmation and no undo - so a user reaching for Find
 * out of habit adopted by accident. The chord is KEPT (it is the TUI's `^f` for
 * this gesture) and made recoverable with the smallest thing that does it: the
 * first press says what a second press will do, on the panel's own notice line,
 * and only the second press adopts. The pointer control is not gated - a click on
 * a button labelled "Add to conversation" is not muscle memory for anything else.
 *
 * The words are the panel's own: the tooltip's verb ("Add the aside to the
 * conversation") and the header's contract ("nothing here joins the
 * conversation"), so the confirm is the receipt the panel already states, not a
 * new promise.
 */
export const asideAdoptConfirm = (isMac: boolean): string =>
	`Press ${asideAdoptCap(isMac)} again to add the aside to the conversation. Once added, it stays there.`;

/**
 * How long after the confirm a second adopt chord is still read as the same gesture.
 *
 * WHY A FLOOR AT ALL (UX round 3, U17). The arm was keyed on the turn's id and on no
 * clock, so a REFLEX double-tap adopted: UX pressed the chord twice 66ms apart, the
 * panel was gone and the exchange was in the model's context, the confirm having
 * existed for the 66ms between the presses. The user this rule exists for is exactly
 * the one whose habit is to press again - out of muscle memory, or because no Find box
 * appeared - so the gate has to be able to tell that press from a decision.
 *
 * WHY 400ms. The value has to sit between two quantities rather than be chosen from
 * taste. Below: the reflex - 66ms measured, and a slower hand's bounce is under 250ms,
 * which is the fast end of the interval a platform calls a double-click. Above: reading
 * the confirm, which is the shortest a DELIBERATE second press can be, because there is
 * nothing to decide until the panel's eight-word sentence has been read (`asideAdoptConfirm`)
 * and ordinary reading speed puts that over 1.5s. 400ms clears the reflex by ~150ms and
 * sits more than a second under the reading, which is the margin a threshold needs to be
 * worth more than its number.
 */
export const ASIDE_ADOPT_CONFIRM_FLOOR_MS = 400;

/** The armed confirm: which exchange it was raised for, and when. */
export type AsideAdoptArm = { turnId: string; at: number };

/**
 * What an adopt chord does, given which turn the last one armed and when.
 *
 * Keyed on the NEWEST TURN'S ID rather than on a boolean, so an arm can never
 * carry over to an exchange the user has not seen the confirm for: a follow-up
 * asked after the first press appends a turn, and the next chord arms again.
 *
 * AND INSIDE THE FLOOR THE PRESS IS SWALLOWED, not treated as the answer
 * (`ASIDE_ADOPT_CONFIRM_FLOOR_MS` says why). The floor is measured from the CONFIRM,
 * not from the last press, so an ignored press leaves the arm where the first one put
 * it and a third press that is a decision still adopts rather than being swallowed in
 * turn - which is also what makes this a floor on the gesture rather than a debounce on
 * the key.
 */
export function asideAdoptChordStep(
	armed: AsideAdoptArm | null,
	newestTurnId: string,
	now: number,
): "arm" | "adopt" | "ignore" {
	if (armed?.turnId !== newestTurnId) return "arm";
	return now - armed.at < ASIDE_ADOPT_CONFIRM_FLOOR_MS ? "ignore" : "adopt";
}

/**
 * Whether the adopt control is live — the TUI's `_aside_can_fork`, in two terms.
 *
 * The exchange must be SETTLED (the model's answer is in hand, so the turns the
 * backend would splice are a complete pair) and the session must not be
 * mid-turn: while a turn runs, the runtime owns the message list and pairs each
 * tool call with its result, so splicing a user message into a live batch
 * produces a request no provider accepts. Both are the TUI's own reasons,
 * restated here because this is the second host for the gate.
 */
export function asideAdoptReady(
	stream: AsideStream | undefined,
	sessionStreaming: boolean,
): boolean {
	return Boolean(stream?.settled) && !sessionStreaming;
}

/**
 * Why the control is not live, as a sentence the PANEL prints.
 *
 * Stated on the panel rather than as a toast, and stated at all rather than left
 * to a disabled control: the TUI's own rule for this gesture is that a refusal
 * is said by the surface that refused. A silent dead control reads as a broken
 * key, and this app's other disabled controls carry their reason beside them for
 * the same reason (`cwdReadOnlyReason`, the composer's own refusals).
 *
 * ONE FACT PER LINE, which is why two of these are as short as they are (design
 * round 1, D2): the panel's empty state already tells the user to type a question
 * in the composer, and the error state already states the cause in its alert — so
 * a reason that restated either was the same instruction painted twice around a
 * dead button.
 *
 * THE WAIT IS DERIVED FROM `streaming`, NOT FROM `settled` (design round 1, D3),
 * and that is the difference between a true sentence and a false one. An answer's
 * deltas finish painting ~0.6s before the POST returns, so gating the SENTENCE on
 * `settled` printed "wait for the answer" underneath a complete answer. Only the
 * CONTROL is gated on `settled` (`asideAdoptReady`); what the panel SAYS is
 * derived from the flag the paint itself uses. The is-nothing-to-add case is
 * derived from the same flag: a sentence about the answer's ARRIVAL has no
 * honest form once the text is on screen.
 *
 * THE CONVERSATION'S TERM OUTRANKS THE SETTLING ONE (UX round 1, U3), and the
 * order is the fix rather than a style choice. An aside asked while a turn was
 * running measured the whole answer on screen within 4s while the exchange stayed
 * unsettled for 14.7s - the POST is held by the runtime the turn is using - so the
 * settling sentence sat under a complete answer for as long as the turn ran, and
 * the reason that was actually true ("this conversation is working", the one the
 * user can wait out or interrupt) never appeared at all. "A moment" is also the
 * one promise here that an unbounded wait falsifies. When both hold, the session's
 * own work is the fact the user can act on, and it is TRUE whenever it is printed.
 */
export function asideAdoptBlockedReason(
	stream: AsideStream | undefined,
	sessionStreaming: boolean,
): string | null {
	if (!stream) {
		return "Nothing to add yet.";
	}
	if (stream.error !== null) {
		return "Nothing to add.";
	}
	if (sessionStreaming) {
		return "This conversation is working. Adding the aside while it runs would splice a message into a live turn.";
	}
	if (stream.streaming) {
		return "The exchange is still settling — a moment before it can be added.";
	}
	return null;
}

/**
 * Where the newest question sits in the region's CONTENT, before any clamp.
 *
 * Its own function because the caller needs it SEPARATELY from the scroll it asks
 * for: the target the region is moving toward is this offset, and the clamp below
 * is the only thing that can stop it getting there. `regionTop` and `turnTop` are
 * the two rectangles' viewport tops, so their difference is where the question sits
 * inside the region's own scroll box whatever the region's current position is -
 * which is why the caller can re-ask for the same target as the answer grows and
 * get the same number back (design round 3, D11).
 */
export function asideQuestionTopOffset(input: {
	regionTop: number;
	turnTop: number;
	scrollTop: number;
}): number {
	return input.scrollTop + (input.turnTop - input.regionTop);
}

/**
 * The exchange region's scroll position once a turn has been APPENDED.
 *
 * WHY THE QUESTION AND NOT THE BOTTOM (design round 2, D6). A follow-up asked
 * while the exchange overflows was painted below the region's fold - measured 88px
 * under it at wide and 687px at narrow - so the ask looked as though it had done
 * nothing at all: the question, its thinking line and the answer that followed were
 * all off screen, and the only visible change was the blocked line re-wording
 * itself. The region is a plain `overflow-y-auto` box with no follow of its own, so
 * nothing brought the new turn into view.
 *
 * ONE SCROLL PER APPENDED TURN, AND NEVER PER CHUNK... which is a rule about
 * FOLLOWING, not about a target that has not been reached yet (design round 3,
 * D11). The turn is only as tall as its question and its thinking line at the
 * moment this is called, so the clamp lands it at the region's BOTTOM - measured
 * y=205 of 248 at wide, 170 of 232 at narrow - and the answer then streams downward
 * out of view: 43 of 300px visible at wide, 62 of 883px at narrow, for the whole
 * stream. The caller therefore re-applies this toward the SAME target until the
 * clamp stops biting or the user scrolls, and stops there. That is not a
 * pin-to-bottom: it never follows content down, it never passes the question, and a
 * reader who scrolls takes the region over for good.
 *
 * The turn's question is put at the region's TOP rather than minimally into view,
 * because the question is the top of a block that grows downward: the thinking line
 * and the first lines of the answer are what the user is waiting to see, and
 * `nearest` would bring only the question's own line in at the region's bottom
 * edge. The arithmetic is a pure function so the clamp and the delta are
 * assertable without a DOM, and the DOM's rectangles are the caller's to read.
 */
export function asideScrollToTurn(input: {
	regionTop: number;
	turnTop: number;
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}): number {
	const ceiling = Math.max(0, input.scrollHeight - input.clientHeight);
	return Math.min(ceiling, Math.max(0, asideQuestionTopOffset(input)));
}

/**
 * What re-runs the panel's move toward the newest question, for the changes a STORE
 * can see: every one that can grow the newest turn's box, as ONE primitive.
 *
 * NOT EVERY CHANGE THAT CAN GROW THE BOX, and saying so is the point of agent review
 * round 7's R7-3. A box can grow with nothing on the wire behind it - a mermaid SVG
 * rendering into an already-settled answer, KaTeX's lazily loaded stylesheet arriving -
 * and this function reads a stream, so it cannot see one. The panel's move therefore
 * takes a SECOND trigger beside this one: the newest turn's own measured box, observed
 * rather than proxied. Measured in the flow (UX round 3's U21): the region held 43px,
 * then 625px once the diagram was in, with `scrollTop` still 0 the whole time.
 *
 * WHY THE ANSWER'S LENGTH WAS NOT ENOUGH (QA round 4, Q33). The move re-runs as the
 * turn grows, because its target only becomes reachable once the region can scroll
 * that far (design round 3, D11). It used to be triggered by the answer's length
 * alone, and a REFUSAL grows the turn without growing the answer: the `409`
 * (`aside_unanswered`, `aside_empty_answer`, a prefix the owner no longer holds)
 * replaces the one-line `thinking…` with an alert of up to five lines, the length
 * stays 0, and nothing re-ran. The region stayed at the ceiling the append's first
 * clamp had reached, short of its new bottom by exactly the alert's growth.
 * Measured: 15-20px hidden at wide (the line saying what Esc costs) and 78-117px at
 * narrow (4 of 5 lines).
 *
 * So the key also names the turn's PHASE, which is exactly what changes when the
 * in-flight line is replaced: live, settled, or refused. A settle changes the phase
 * too, which covers the one other late replacement (the thinking line or the last
 * chunk replaced by the response's own text, possibly of the same length).
 *
 * The rule itself is unchanged, because the trigger only decides WHEN it is asked
 * again: the target is still the question's own top, the move still stops at it,
 * and a reader's scroll still ends the turn's move for good. A string rather than an
 * object, so an idle re-render compares equal and cannot re-run the effect.
 */
export function asideScrollTrigger(stream: AsideStream | undefined): string {
	if (!stream) return "none";
	const phase =
		stream.error !== null ? "refused" : stream.settled ? "settled" : "live";
	return `${phase}:${stream.text.length}`;
}

/**
 * What the panel's one live region says, as a function of the newest turn.
 *
 * THE PHASE IS STILL THE SHAPE (review round 1, F4): a region that mirrored the
 * answer would announce once per chunk, and a `polite` region is not
 * interruptible, so the reader would still be hearing an answer's tail long after
 * it finished.
 *
 * THE SETTLED PHASE CARRIES THE ANSWER'S FIRST SENTENCE (UX round 1, U10), and
 * that is the one addition that costs nothing: the transition to settled is a
 * single state change, so its text is announced once rather than per chunk, and
 * the reader otherwise has to leave the composer and navigate into the region to
 * hear an answer they were told had arrived. It is cut at the first sentence end or
 * at a bounded length, whichever comes first, because a live region's announcement
 * is not something a reader can skim.
 *
 * THE ANSWER IS ANNOUNCED AS PROSE, NOT AS ITS MARKUP (UX round 2, U15; design
 * round 3, D15). The cut used to be taken from the raw stream, so an answer whose
 * first sentence was `Transport failures and owner **5xx** responses, per provider,
 * within a moving window.` was announced with the asterisks spoken aloud: a reader
 * heard punctuation the sighted reader never sees, because the panel renders that
 * text through `MarkdownRenderer` and the emphasis markers are consumed by it. The
 * markers are therefore stripped here, from the text that goes into the cut rather
 * than from the whole answer - the announcement is the only consumer and the
 * streaming text is not this function's to edit.
 */
export const ASIDE_ANNOUNCED_CHARS = 140;

/**
 * Inline markdown as the RENDERER consumes it, so an announcement speaks words.
 *
 * EVERY RULE REQUIRES A DELIMITER THAT IS TIGHT AGAINST ITS CONTENT (`(?=\S)` at the
 * open, `\S` at the close), which is CommonMark's own flanking rule in the part that
 * matters here and is what keeps this from DELETING words rather than markers. A
 * looser `\*([^*]+)\*` reads `a * b and 2 * 3` as one emphasis span and announces
 * `a  b and 2  3` — the parser would have rendered that asterisk literally, so the
 * reader is told a sentence the sighted reader never saw, which is a worse defect
 * than the one being fixed. For the same reason the underscore rules carry a
 * boundary test: CommonMark does not open emphasis mid-word, so `a_b_c` is an
 * identifier and not `a<em>b</em>c`.
 *
 * The two-character markers are listed before the one-character ones, and the rules
 * run in this order, so `**strong**` is consumed whole rather than as an empty
 * emphasis pair.
 */
const MARKDOWN_INLINE_RULES: ReadonlyArray<[RegExp, string]> = [
	[/!?\[([^\]]*)\]\([^)]*\)/g, "$1"],
	[/`(?=\S)([^`]*?\S)`/g, "$1"],
	[/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1"],
	[/__(?=\S)([\s\S]*?\S)__/g, "$1"],
	[/~~(?=\S)([^~]*?\S)~~/g, "$1"],
	[/\*(?=\S)([^*]*?\S)\*/g, "$1"],
	[/(?<![A-Za-z0-9_])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1"],
];

/** The visible words of an inline-markdown span, for a live region to say. */
export function asideAnnounceableText(text: string): string {
	return MARKDOWN_INLINE_RULES.reduce(
		(spoken, [pattern, replacement]) => spoken.replace(pattern, replacement),
		text,
	);
}

export function asideAnnouncement(
	stream: AsideStream | undefined,
): string | null {
	if (!stream) return null;
	if (stream.error !== null) return "The aside was not answered";
	if (stream.streaming) return "Asking the aside";
	const sentence =
		asideAnnounceableText(stream.text.trim()).split(RE_SENTENCE_END)[0] ?? "";
	if (sentence.length === 0) return "The aside answered";
	return sentence.length > ASIDE_ANNOUNCED_CHARS
		? `The aside answered: ${sentence.slice(0, ASIDE_ANNOUNCED_CHARS)}\u2026`
		: `The aside answered: ${sentence}`;
}
