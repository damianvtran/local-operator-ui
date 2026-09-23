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
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
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
 * panel states the reason and a caller that must decide what to do with the
 * user's text (the composer) can answer `false` without inventing a second copy
 * of the sentence.
 */
export async function askAside(
	sessionId: string,
	question: string,
): Promise<string> {
	const asideId = uuidv4();
	const store = useAsideStore.getState();
	/*
	 * The prefix is read BEFORE the ask is registered: `beginAsk` appends this
	 * turn, and a continuation is defined by what the exchange held up to it.
	 */
	const continuation = previousAsideId(store, sessionId);
	store.beginAsk(sessionId, asideId, question);
	try {
		const value = await desktopResult<AsideAnswer>({
			op: "sessions.aside",
			sessionId,
			requestId: asideId,
			text: question,
			asideId: continuation,
		});
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
		useAsideStore
			.getState()
			.failAside(
				asideId,
				userFacingMessage(error, "The aside was not answered."),
			);
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
 */
export function asideAdoptBlockedReason(
	stream: AsideStream | undefined,
	sessionStreaming: boolean,
): string | null {
	if (!stream) {
		return "Ask a question first — there is no exchange to add yet.";
	}
	if (stream.error !== null) {
		return "The aside could not be answered, so there is nothing to add.";
	}
	if (!stream.settled) {
		return "Wait for the answer before adding this to the conversation.";
	}
	if (sessionStreaming) {
		return "This conversation is working. Adding the aside while it runs would splice a message into a live turn.";
	}
	return null;
}
