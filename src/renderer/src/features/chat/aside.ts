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
	previousAsideId,
	useAsideStore,
} from "@shared/store/aside-store";
import { v4 as uuidv4 } from "uuid";

/** The aside POST's own answer, spelled once so the shape is not re-derived. */
type AsideAnswer = {
	data: { aside_id: string; text: string; off_record: boolean };
};

/**
 * The sentence a refused ask is stated with, wherever it is stated.
 *
 * ONE COMPOSITION FOR TWO SURFACES. The panel states a refusal on the turn
 * (`failAside`) and the composer states the same one when the panel is gone
 * (see the aside branch in `chat-page.tsx`); two spellings of the same fact
 * would read as two different facts, which is why the composition lives here
 * rather than at either call site.
 */
export function asideAskFailure(error: unknown): string {
	return userFacingMessage(error, "The aside was not answered.");
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
 * `local_operator/server/app.py` (`invalid fields`), and a reworded owner would
 * make the retry below stop firing, which costs one failed request and never
 * the answer.
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
	 * The prefix is read BEFORE the ask is registered: `beginAsk` appends this
	 * turn, and a continuation is defined by what the exchange held up to it.
	 */
	const continuation = previousAsideId(store, sessionId);
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
		 * consults (`asideTurnIsCarried`), and states the refusal on the composer when
		 * there is nothing left to carry it — see the aside branch in `chat-page.tsx`.
		 */
		useAsideStore.getState().failAside(asideId, asideAskFailure(error));
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
	const asideId = previousAsideId(store, sessionId);
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
	if (stream.streaming) {
		return "The exchange is still settling — a moment before it can be added.";
	}
	if (sessionStreaming) {
		return "This conversation is working. Adding the aside while it runs would splice a message into a live turn.";
	}
	return null;
}
