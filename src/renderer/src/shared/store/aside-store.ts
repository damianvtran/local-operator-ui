/**
 * The aside's own state: the text a live aside is streaming, and which aside the
 * composer is attached to.
 *
 * WHY A STORE RATHER THAN THE PANEL'S OWN `useState`. The text arrives on a
 * stream the panel does not own — the session's SSE connection, read in
 * `use-canonical-session`'s flush — while the composer (which routes Enter to the
 * aside) and the command dispatcher (which opens the panel for `/btw`) are two
 * OTHER components that must agree with the panel about which aside is live. A
 * store is the one shape here that lets all three share that without threading a
 * mutable handle through two prop chains.
 *
 * THE STREAM MAP IS KEYED BY `aside_id`, AND THAT IS WHAT MAKES THE RACE
 * SURVIVABLE. The id is the client-generated `request_id` of the POST that asked
 * the question — the route answers `aside_id: body.request_id` — so the panel can
 * register its entry BEFORE the POST resolves, and the first `aside_delta` frame
 * cannot arrive before there is somewhere to put it. A store keyed by anything
 * the panel learns only from the RESPONSE would drop exactly that first chunk.
 *
 * TWO SLICES IN ONE STORE, deliberately. A turn's id appears in both (the
 * attachment lists the turns the exchange is made of; the stream map holds their
 * text), and the lifecycle is one lifecycle: asking creates both entries and
 * closing ends both. Split across two stores, a caller could update one and not
 * the other — the drift `settleAside` and `detachAside` exist to make impossible.
 *
 * NOTHING HERE IS PERSISTED. An aside is off the record by construction (the
 * backend keeps its exchanges in memory for an hour and never journals them), so
 * a store that wrote to `localStorage` would be the one place an off-record
 * exchange outlived its session.
 */
import { create } from "zustand";

/**
 * One aside's live text, in the states the panel paints.
 *
 * `streaming` is "the ask is in flight", NOT "chunks have arrived": it is true
 * from `beginAsk` until the POST settles, which is what lets the panel say it is
 * thinking between the submit and the first delta instead of rendering an empty
 * answer as though the model had answered with nothing.
 *
 * `settled` is the POST's own arrival, and from then on `text` is AUTHORITATIVE —
 * the complete answer, not the concatenation of whichever chunks happened to
 * arrive. That is why a delta is refused once settled (see `applyAsideDelta`): a
 * dropped chunk self-heals, and a duplicated one cannot corrupt the answer.
 */
export type AsideStream = {
	text: string;
	streaming: boolean;
	settled: boolean;
	error: string | null;
};

/** One question put to the aside, and the id its answer streams under. */
export type AsideTurn = {
	asideId: string;
	question: string;
};

/**
 * The aside one session's composer is attached to.
 *
 * `turns` rather than a single question/answer pair: an aside is a conversation —
 * a follow-up continues the same exchange and the model sees the earlier turns —
 * so the panel has to be able to show what came before. The answers are not
 * copied in here: `streams` already holds them under the same ids, and two copies
 * of one text is how they would part.
 */
export type AsideAttachment = {
	turns: AsideTurn[];
	/** A refusal the panel states on itself, in the TUI card's own habit. */
	notice: string | null;
};

export type AsideStore = {
	streams: Record<string, AsideStream>;
	/** Attachments by SESSION id: a session has at most one live aside. */
	attached: Record<string, AsideAttachment>;

	/**
	 * Attach the panel to a session with nothing asked yet (a bare `/btw`).
	 *
	 * An aside already open is LEFT EXACTLY AS IT IS: the exchange on screen is
	 * the one the next question would continue, so re-opening must not clear it.
	 * The refusal from the last ask is dropped, because that sentence answered
	 * that ask and this press is a new one.
	 */
	attachAside: (sessionId: string) => void;
	/**
	 * An ask just left, before any of it is known. Registers the turn and its
	 * stream entry under the id the panel already chose, so a delta that beats the
	 * response lands somewhere real — and clears any refusal the last ask left,
	 * because that sentence answered that ask.
	 */
	beginAsk: (sessionId: string, asideId: string, question: string) => void;
	/** One live chunk. Appends; a no-op once the turn has settled. */
	applyAsideDelta: (asideId: string, delta: string) => void;
	/**
	 * The POST answered. `text` REPLACES whatever the chunks accumulated, which is
	 * the whole self-healing rule: the authoritative answer is the response, so a
	 * lost or repeated delta is corrected here rather than displayed.
	 */
	settleAside: (asideId: string, text: string) => void;
	/** The ask failed. The turn stays on the panel, with its error. */
	failAside: (asideId: string, error: string) => void;
	/** The panel's own refusal sentence, or null to clear it. */
	setAsideNotice: (sessionId: string, notice: string | null) => void;
	/** Close the panel and drop everything about this session's aside. */
	detachAside: (sessionId: string) => void;
};

/**
 * The next stream for a chunk that arrived in time, or `undefined` when it did
 * not.
 *
 * A delta for an id this store has never heard of is DROPPED rather than opening
 * an entry: the panel subscribes before its POST, so an unknown id means either a
 * frame for another window's aside or one that arrived after this panel closed —
 * and materialising an entry for it would leave an answer in the store that no
 * surface will ever read or release.
 *
 * A delta that arrives once the turn has SETTLED or FAILED is dropped for the
 * reason `AsideStream`'s comment gives: `settleAside` already wrote the complete
 * answer, so appending a chunk to it would duplicate that chunk's text, and a
 * failed turn has nothing left to append to.
 *
 * A pure function, exported so both rules are assertable without a browser
 * (`scripts/btw-aside.test.mjs`), the way this tree's other reducers are.
 */
export function applyAsideDelta(
	stream: AsideStream | undefined,
	delta: string,
): AsideStream | undefined {
	if (!stream) return undefined;
	if (stream.settled || stream.error !== null) return undefined;
	return { ...stream, text: stream.text + delta, streaming: true };
}

/**
 * Whether a refusal recorded for this ask would have a surface to land on.
 *
 * The turn's stream entry IS that surface: `failAside` writes the sentence on it
 * and the panel paints the turn it belongs to. `detachAside` deletes both
 * together (see its own note), so an entry's absence is precisely "no surface is
 * holding this ask" — which is the state a user reaches by closing the panel
 * while an answer is still in flight, and the one the composer has to answer for.
 *
 * A pure function, exported for the same reason `applyAsideDelta` is: the rule is
 * a fact about the store that two callers now ask (the store's own write, and the
 * composer deciding whether it must state the refusal itself), and a rule stated
 * twice is a rule that will disagree with itself.
 */
export function asideTurnIsCarried(
	state: Pick<AsideStore, "streams">,
	asideId: string,
): boolean {
	return Boolean(state.streams[asideId]);
}

/** The state an ask opens in: in flight, nothing yet, no error. */
export function beginAsideStream(): AsideStream {
	return { text: "", streaming: true, settled: false, error: null };
}

/** The state a response writes: the answer, complete and trusted. */
export function settledAsideStream(text: string): AsideStream {
	return { text, streaming: false, settled: true, error: null };
}

/** The state a refusal writes: whatever arrived, plus the reason it stopped. */
export function failedAsideStream(
	stream: AsideStream | undefined,
	error: string,
): AsideStream {
	return {
		text: stream?.text ?? "",
		streaming: false,
		settled: false,
		error,
	};
}

export const useAsideStore = create<AsideStore>((set) => ({
	streams: {},
	attached: {},

	attachAside: (sessionId) =>
		set((state) => {
			const attachment = state.attached[sessionId];
			if (attachment && attachment.notice === null) return state;
			return {
				attached: {
					...state.attached,
					[sessionId]: attachment
						? { ...attachment, notice: null }
						: { turns: [], notice: null },
				},
			};
		}),

	beginAsk: (sessionId, asideId, question) =>
		set((state) => ({
			streams: { ...state.streams, [asideId]: beginAsideStream() },
			attached: {
				...state.attached,
				[sessionId]: {
					turns: [
						...(state.attached[sessionId]?.turns ?? []),
						{ asideId, question },
					],
					notice: null,
				},
			},
		})),

	applyAsideDelta: (asideId, delta) =>
		set((state) => {
			const next = applyAsideDelta(state.streams[asideId], delta);
			if (!next) return state;
			return { streams: { ...state.streams, [asideId]: next } };
		}),

	settleAside: (asideId, text) =>
		set((state) => {
			// A settle for a turn this store is not holding belongs to no surface
			// here: it is either another window's aside or one this panel has
			// already released, and opening an entry for it would strand it.
			if (!state.streams[asideId]) return state;
			return {
				streams: { ...state.streams, [asideId]: settledAsideStream(text) },
			};
		}),

	failAside: (asideId, error) =>
		set((state) => {
			if (!asideTurnIsCarried(state, asideId)) return state;
			return {
				streams: {
					...state.streams,
					[asideId]: failedAsideStream(state.streams[asideId], error),
				},
			};
		}),

	setAsideNotice: (sessionId, notice) =>
		set((state) => {
			const attachment = state.attached[sessionId];
			if (!attachment) return state;
			return {
				attached: { ...state.attached, [sessionId]: { ...attachment, notice } },
			};
		}),

	detachAside: (sessionId) =>
		set((state) => {
			const attachment = state.attached[sessionId];
			const attached = { ...state.attached };
			delete attached[sessionId];
			if (!attachment) return { attached };
			/*
			 * The stream entries go with the panel, and that is not tidiness: an
			 * answer left in the store is one the next aside on this session would
			 * never read (its own ids are fresh) and nothing would ever release.
			 */
			const streams = { ...state.streams };
			for (const turn of attachment.turns) delete streams[turn.asideId];
			return { streams, attached };
		}),
}));

/**
 * The id of the LAST turn this session asked, which is what a follow-up hands the
 * backend as its `aside_id` prefix — and the id the composer's next ask streams
 * under.
 *
 * Read off the store rather than threaded through callers: the continuation rule
 * is "the exchange the panel is showing", and the store is the only place that
 * knows which exchange that is.
 */
export function previousAsideId(
	state: Pick<AsideStore, "attached">,
	sessionId: string,
): string | undefined {
	return state.attached[sessionId]?.turns.at(-1)?.asideId;
}
