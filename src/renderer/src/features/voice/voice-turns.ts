/**
 * THE SPEAK-TRIGGER RULE for session voice (`docs/design/session-voice.md`, the
 * frozen contract's last bullets), as one pure step function so a node test can
 * drive it frame by frame.
 *
 * What it decides, and nothing else:
 *
 * - A TURN THIS RENDERER SENT AN UTTERANCE TO ends (`agent_end`): speak that turn's last
 *   assistant `message_end` that carried text. A turn the operator typed into is
 *   not spoken - voice answers voice.
 *
 * A TAKE IS BOUND BY IDENTITY, NEVER BY TIMING (design V14, review round 5,
 * R5-M1). The turn that answers a take is the one whose stream carries the
 * take's OWN user `message_start`: the server mints that message with
 * `message.id == the utterance's request_id`, on the prompt path, a steer drained
 * at a tool boundary, and a steer drained by the end-of-turn flush alike, live
 * and on replay (measured against lo-voice b2533239d). Nothing else binds: not a
 * turn already running when the take was sent, not an `agent_start` seen after
 * it, and not `input_mode`, which the stream does not carry. A take whose message
 * never appears on the stream is never answered - silence is the safe failure.
 * - An APPROVAL appears (`pending_gate.kind === "approval"`): announce it. The
 *   announcement is the server's own gate text (V8); the approval itself is only
 *   ever answered on screen (V7). Nothing in this module, or anything it emits,
 *   can answer a gate: its only output is a request to SPEAK a source reference.
 *
 * DEDUPE IS BY ID, NOT BY ARRIVAL. A reconnect replays the stream from `after_seq`,
 * so the same `message_end` and `agent_end` can arrive twice; a message id that was
 * spoken once is never spoken again, and a gate's `request_id` is announced once.
 * The id sets are bounded (oldest dropped first) so a long session cannot grow
 * them without limit; a replay window is far shorter than the bound.
 */

/** A speak request: a SOURCE REFERENCE the server resolves, never text (V8). */
export type VoiceSpeakSource =
	| { kind: "message"; messageId: string }
	| { kind: "gate"; requestId: string };

export type VoiceTurnsState = {
	/**
	 * The request ids of takes this renderer sent whose user message the stream
	 * has not carried yet, oldest first (bounded). Several can be out at once and
	 * each binds only to its own message, so the order they are admitted in
	 * cannot hand one take's answer to another.
	 *
	 * ARMED WHEN THE SEND STARTS, NOT WHEN IT IS ANSWERED. A fast turn (the `test`
	 * mock provider answers in milliseconds) can put the take's message on the
	 * stream before the upload's 200 reaches this window; arming on the answer
	 * would miss exactly that turn. A send that fails disarms its own id
	 * (`disarmed`), since nothing was admitted.
	 */
	takes: string[];
	/**
	 * The turn in flight carried one of this window's takes, so its `agent_end`
	 * is answered. Two takes bound into one turn are one answer.
	 */
	answering: boolean;
	/**
	 * The `generation` of the turn being answered, or null while it is not known
	 * yet (review round 6, R6-M1). A take bound while no turn runs (the prompt
	 * path, the end-of-turn flush) learns it at the turn's start; one bound into
	 * a running turn takes that turn's. A snapshot naming any other generation,
	 * or arriving while this is still unknown, unbinds: the bound turn's end may
	 * be among the frames the snapshot absorbed, and silence is the safe side.
	 */
	boundGeneration: number | null;
	/** The session's latest `generation`, as any frame stated it, or null. */
	generation: number | null;
	/**
	 * Takes the server holds in its steering queue right now (`queued_steering`),
	 * by request id. A held take is exempt from expiry: its row lands at the next
	 * tool boundary, however long the running step takes (R6-m1).
	 */
	held: string[];
	/** A turn is running on the session (between `agent_start` and `agent_end`). */
	inFlight: boolean;
	/** The last assistant message of the turn in flight that carried text. */
	lastMessageId: string | null;
	/** Message ids already spoken, oldest first (bounded). */
	spoken: string[];
	/**
	 * Approval gate ids this window has SEEN, oldest first (bounded) - announced
	 * or not. A gate is announced at most once, and only by the window that armed
	 * a take (U2); one seen while nothing was armed is recorded so a later take
	 * cannot announce an approval that was already on screen before it.
	 */
	announced: string[];
	/** The approval gate pending on the session right now, or null. */
	pendingApproval: string | null;
	/**
	 * ANY card pending on the session - an approval or a blocking ask - or null
	 * (review round 3, R3-m2). The route's V13 refuses words at every parked card
	 * (`_card_pending`: `pending_gate is not None`), because a blocking ask is
	 * withdrawn by a steer exactly like an approval; the push-to-talk pre-check
	 * reads this so it refuses what the server would. Announcing stays
	 * approval-only (`pendingApproval`).
	 */
	pendingCard: string | null;
};

export type VoiceTurnsInput =
	/** This renderer is sending an utterance, keyed by its own `request_id`. */
	| { kind: "armed"; requestId: string }
	/**
	 * Nothing was admitted under that id: the send failed, or the stream said
	 * `admission.failed` for it (R6-m1).
	 */
	| { kind: "disarmed"; requestId: string }
	/**
	 * The take's row did not arrive within `VOICE_TAKE_ROW_TTL_MS` (R6-m1). Drops
	 * it unless the server is still holding it as a queued steer.
	 */
	| { kind: "expired"; requestId: string }
	/** The session's steering queue, by request id, as a frontend frame states it. */
	| { kind: "queued"; requestIds: string[] }
	/**
	 * The session's `streaming` flag. `snapshot` marks one read off a SNAPSHOT:
	 * the authoritative state after a (re)subscribe, which is how a turn that
	 * ended while the stream was away is learned (review round 4, R4-M1, path H).
	 */
	| {
			kind: "streaming";
			streaming: boolean;
			snapshot?: boolean;
			/** The frame's `generation`, when it states one. */
			generation?: number;
	  }
	/**
	 * The ids of the history entries a SNAPSHOT carries. A take whose own message
	 * is already among them landed in the window the snapshot absorbed (frames
	 * published between the resume's cutoff and the snapshot read are delivered as
	 * state, never as events), so its `message_start` will never arrive to bind it.
	 */
	| { kind: "history"; entryIds: string[] }
	/**
	 * Continuity was lost: a resume answered with a gap or a new epoch, so the
	 * frames between the last one folded and now are gone (R4-M1, paths E/F).
	 */
	| { kind: "reset" }
	/** One canonical AgentEvent off the session stream (`frame.type === "event"`). */
	| { kind: "event"; event: Record<string, unknown> }
	/**
	 * The session's blocking gate as a snapshot/update/replace frame states it.
	 * `snapshot` marks a gate read off a SNAPSHOT: state that was already on
	 * screen, recorded so a take can be refused, never announced (Q4).
	 */
	| {
			kind: "gate";
			gate: { request_id?: unknown; kind?: unknown } | null | undefined;
			snapshot?: boolean;
	  }
	/**
	 * The stream watcher stopped: it can no longer see a gate clear or a turn
	 * end, so neither may keep being asserted (review round 2, N1).
	 */
	| { kind: "stopped" };

/** How many ids each dedupe set keeps. */
export const VOICE_DEDUPE_LIMIT = 256;

export function initialVoiceTurns(): VoiceTurnsState {
	return {
		takes: [],
		answering: false,
		boundGeneration: null,
		generation: null,
		held: [],
		inFlight: false,
		lastMessageId: null,
		spoken: [],
		announced: [],
		pendingApproval: null,
		pendingCard: null,
	};
}

/** How many unbound takes are kept; a take that never binds is dropped oldest-first. */
export const VOICE_TAKES_LIMIT = 8;

/**
 * How long a take may wait for its user row before it is dropped (R6-m1).
 *
 * 150 s = the longest a send can stay out, plus room for the row. The relay
 * aborts an utterance upload at 120 s (`desktop-media.ts`,
 * `AbortSignal.timeout(120000)`), which matches the server's whole STT budget
 * (`STT_OVERALL_TIMEOUT_S = 120.0`, `stt/cascade.py`); a prompt's row is minted
 * at admission, inside that window. The extra 30 s covers a steer that drains
 * at the next tool boundary. A steer the server is still HOLDING (it is listed
 * in `queued_steering`) is never expired, so a long tool step cannot drop it.
 * A take that outlives this is answered by nothing - silence, the safe side -
 * and stops counting as outstanding, so it cannot make this window announce a
 * typed turn's approval (probe N5b) or hold the header on "Working".
 */
export const VOICE_TAKE_ROW_TTL_MS = 150_000;

/** Whether this window still owes the session an answer (a take out or bound). */
export function takeOutstanding(state: VoiceTurnsState): boolean {
	return state.takes.length > 0 || state.answering;
}

/** Stop answering the bound turn, without speaking. */
function unbind(state: VoiceTurnsState): VoiceTurnsState {
	return {
		...state,
		answering: false,
		boundGeneration: null,
		lastMessageId: null,
	};
}

const finiteGeneration = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

function remember(list: string[], id: string): string[] {
	const next = [...list, id];
	return next.length > VOICE_DEDUPE_LIMIT
		? next.slice(next.length - VOICE_DEDUPE_LIMIT)
		: next;
}

/**
 * Whether a message's content carries any text a person would hear. A turn whose
 * last message is a bare tool call has nothing to say, and asking the server to
 * synthesise it would spend a TTS call on silence.
 */
function hasText(message: Record<string, unknown>): boolean {
	const content = message.content;
	if (typeof content === "string") return content.trim() !== "";
	if (!Array.isArray(content)) return false;
	return content.some((block) => {
		if (block === null || typeof block !== "object") return false;
		const { type, text } = block as { type?: unknown; text?: unknown };
		return (
			(type ?? "text") === "text" &&
			typeof text === "string" &&
			text.trim() !== ""
		);
	});
}

export function stepVoiceTurns(
	state: VoiceTurnsState,
	input: VoiceTurnsInput,
): { state: VoiceTurnsState; speak: VoiceSpeakSource[] } {
	if (input.kind === "armed") {
		// No id, no binding: a take without one could never be matched to its turn.
		if (
			typeof input.requestId !== "string" ||
			input.requestId === "" ||
			state.takes.includes(input.requestId)
		)
			return { state, speak: [] };
		const takes = [...state.takes, input.requestId];
		return {
			state: {
				...state,
				takes:
					takes.length > VOICE_TAKES_LIMIT
						? takes.slice(takes.length - VOICE_TAKES_LIMIT)
						: takes,
			},
			speak: [],
		};
	}
	if (input.kind === "expired") {
		if (!state.takes.includes(input.requestId)) return { state, speak: [] };
		if (state.held.includes(input.requestId)) return { state, speak: [] };
		return {
			state: {
				...state,
				takes: state.takes.filter((id) => id !== input.requestId),
			},
			speak: [],
		};
	}
	if (input.kind === "queued") {
		return { state: { ...state, held: input.requestIds }, speak: [] };
	}
	if (input.kind === "disarmed") {
		return {
			state: {
				...state,
				takes: state.takes.filter((id) => id !== input.requestId),
			},
			speak: [],
		};
	}
	if (input.kind === "history") {
		/*
		 * AN ABSORBED TAKE IS DROPPED SILENTLY. Its turn may already have ended
		 * inside the same absorbed window, and this window cannot tell which turn
		 * is running now, so binding it here would be timing again. Dropping it
		 * keeps the header from waiting on "Working" for an answer that cannot
		 * come; the operator can speak again.
		 */
		const takes = state.takes.filter((id) => !input.entryIds.includes(id));
		return takes.length === state.takes.length
			? { state, speak: [] }
			: { state: { ...state, takes }, speak: [] };
	}
	if (input.kind === "streaming") {
		/*
		 * A BOUND TURN THAT ENDED UNSEEN IS NOT ANSWERED LATER (R4-M1, path H). An
		 * idle SNAPSHOT while a bound turn is in flight means its `agent_end` fell
		 * into the window the snapshot absorbed; left bound, the NEXT turn's end -
		 * typed, nobody spoke into it - would be read aloud. A live `frontend.update`
		 * does not unbind: on the prompt path the take's message lands BEFORE the
		 * session flips to streaming (measured: user message_start @4, streaming
		 * true @6), so an idle update can precede the very turn it binds.
		 */
		const generation = finiteGeneration(input.generation);
		const next = {
			...state,
			inFlight: input.streaming,
			generation: generation ?? state.generation,
		};
		if (input.snapshot && state.answering) {
			if (!input.streaming) return { state: unbind(next), speak: [] };
			/*
			 * A RUNNING SNAPSHOT IS THE BOUND TURN ONLY IF IT SAYS SO (R6-M1). The
			 * bound turn's `agent_end` and the NEXT turn's `agent_start` can both
			 * fall into the absorbed window, leaving a snapshot that says
			 * `streaming: true` about a different turn (measured: bound generation
			 * 1, snapshot generation 2, the typed steer's turn). Only the same
			 * generation keeps the binding (K2); a different one, or one this window
			 * cannot compare, unbinds silently.
			 */
			if (
				state.boundGeneration === null ||
				generation === null ||
				generation !== state.boundGeneration
			)
				return { state: unbind(next), speak: [] };
			return { state: next, speak: [] };
		}
		// A live frame saying a turn started resolves a binding still waiting for it.
		if (
			!input.snapshot &&
			input.streaming &&
			state.answering &&
			state.boundGeneration === null &&
			generation !== null
		)
			return { state: { ...next, boundGeneration: generation }, speak: [] };
		return { state: next, speak: [] };
	}
	/*
	 * CONTINUITY LOST (a gap or a new epoch): BOTH halves are dropped, for
	 * different reasons. The bound turn's end may be among the lost frames, and a
	 * later end would then be a turn nobody spoke into. A pending take's own
	 * message may be among them too, so it could never bind, and holding it would
	 * keep the header on "Working" for an answer that cannot come.
	 */
	if (input.kind === "reset")
		return { state: { ...unbind(state), takes: [] }, speak: [] };
	if (input.kind === "stopped") {
		/*
		 * A stopped watcher can no longer see a card clear, so neither card may
		 * keep being asserted (N1). TAKES ARE KEPT (review round 5, R5-M2): binding
		 * is by identity, so a retry that resumes without a gap still delivers the
		 * take's own message and its turn's end, and that answer is owed (K2); a
		 * resume that cannot vouch for the frames between says so with a reset.
		 */
		return {
			state: {
				...state,
				pendingApproval: null,
				pendingCard: null,
				inFlight: false,
			},
			speak: [],
		};
	}
	if (input.kind === "gate") {
		const gate = input.gate;
		const cardId =
			gate && typeof gate.request_id === "string" ? gate.request_id : "";
		const carded = {
			...state,
			pendingCard: cardId === "" ? null : cardId,
		};
		const requestId = gate?.kind === "approval" ? cardId : "";
		if (requestId === "") {
			return { state: { ...carded, pendingApproval: null }, speak: [] };
		}
		const pending = { ...carded, pendingApproval: requestId };
		if (state.announced.includes(requestId))
			return { state: pending, speak: [] };
		const seen = {
			...pending,
			announced: remember(state.announced, requestId),
		};
		// A snapshot's gate was parked before this watcher saw it: never spoken.
		if (input.snapshot) return { state: seen, speak: [] };
		/*
		 * ONLY THE TURN THAT CARRIES THIS WINDOW'S WORDS ANNOUNCES (U2, and by
		 * identity since review round 6, R6-m1). Every window holding the slot
		 * watches the same stream, and an approval reached by typing - or by
		 * another window's take - is not this window's to say aloud. A take still
		 * waiting for its row is not enough: the gate on screen then belongs to
		 * whatever turn is running, typed or not (probe N5b).
		 */
		if (!state.answering) return { state: seen, speak: [] };
		return { state: seen, speak: [{ kind: "gate", requestId }] };
	}
	const event = input.event;
	const type = event.type;
	if (type === "agent_start") {
		/*
		 * A new turn: an earlier turn's last message is not this one's answer. It
		 * does NOT bind and does not unbind: on the prompt path the take's own
		 * message arrives before this event, and it is that message that binds.
		 */
		const generation = finiteGeneration(event.generation) ?? state.generation;
		return {
			state: {
				...state,
				inFlight: true,
				generation,
				lastMessageId: null,
				// The bound take's turn starts here when it was bound while idle.
				boundGeneration:
					state.answering && state.boundGeneration === null
						? generation
						: state.boundGeneration,
			},
			speak: [],
		};
	}
	if (type === "message_start") {
		const message = event.message as Record<string, unknown> | undefined;
		const id = message?.id;
		if (
			message?.role !== "user" ||
			typeof id !== "string" ||
			!state.takes.includes(id)
		)
			return { state, speak: [] };
		/*
		 * THE BINDING: this turn carries the take's own words. Whatever the
		 * assistant said before them (a steer lands mid-turn) answered something
		 * else, so the answer is only what follows.
		 */
		return {
			state: {
				...state,
				takes: state.takes.filter((take) => take !== id),
				answering: true,
				// Into a running turn: that turn's. While idle: learned at its start.
				boundGeneration: state.answering
					? state.boundGeneration
					: state.inFlight
						? state.generation
						: null,
				lastMessageId: null,
			},
			speak: [],
		};
	}
	if (type === "message_end") {
		const message = event.message as Record<string, unknown> | undefined;
		if (!message || message.role !== "assistant") return { state, speak: [] };
		const id = message.id;
		if (typeof id !== "string" || id === "" || !hasText(message))
			return { state, speak: [] };
		// A message cut short is not an answer (U3): it is not what the agent said.
		if (message.stop_reason === "aborted" || message.stop_reason === "error")
			return { state, speak: [] };
		return { state: { ...state, lastMessageId: id }, speak: [] };
	}
	if (type === "agent_end") {
		const endedGeneration = finiteGeneration(event.generation);
		const ended: VoiceTurnsState = {
			...unbind(state),
			inFlight: false,
			generation: endedGeneration ?? state.generation,
		};
		/*
		 * The end of a turn other than the bound one answers nothing: it can only
		 * arrive here when frames between were lost, so silence (R6-M1).
		 */
		const otherTurn =
			endedGeneration !== null &&
			state.boundGeneration !== null &&
			endedGeneration !== state.boundGeneration;
		if (!state.answering || otherTurn) {
			// Not a turn that carried this window's words (typed, a wake, or one
			// that ended before a take's message arrived): nothing to say.
			return { state: ended, speak: [] };
		}
		const id = state.lastMessageId;
		const next: VoiceTurnsState = ended;
		/*
		 * AN INTERRUPTED TURN IS NOT SPOKEN (U3). A stop, an abort or an error
		 * ends the turn without the answer the words asked for; reading out its
		 * last partial message would present a fragment as the reply. The binding
		 * is consumed either way - the operator can speak again.
		 */
		const interrupted =
			event.aborted === true ||
			(typeof event.error === "string" && event.error !== "") ||
			(typeof event.cut_off_cause === "string" && event.cut_off_cause !== "");
		if (interrupted || id === null || state.spoken.includes(id))
			return { state: next, speak: [] };
		return {
			state: { ...next, spoken: remember(state.spoken, id) },
			speak: [{ kind: "message", messageId: id }],
		};
	}
	return { state, speak: [] };
}

/**
 * The blocking gate a session-stream frame states, or `undefined` when the frame
 * says nothing about it. `null` is a real answer ("no gate") and is passed through,
 * which is what lets a later approval with a reused id still be told apart from
 * the frame that cleared the first.
 */
export function gateOfFrame(
	frame: { type?: unknown; payload?: unknown } | null | undefined,
): { request_id?: unknown; kind?: unknown } | null | undefined {
	if (!frame || typeof frame.payload !== "object" || frame.payload === null)
		return undefined;
	const payload = frame.payload as Record<string, unknown>;
	const read = (snapshot: unknown) => {
		if (!snapshot || typeof snapshot !== "object") return undefined;
		if (!("pending_gate" in snapshot)) return undefined;
		return (
			snapshot as {
				pending_gate: { request_id?: unknown; kind?: unknown } | null;
			}
		).pending_gate;
	};
	if (frame.type === "snapshot") {
		return read(
			(payload.frontend as { snapshot?: unknown } | undefined)?.snapshot,
		);
	}
	if (frame.type === "frontend.replace") {
		return read(
			(payload.frontend as { snapshot?: unknown } | undefined)?.snapshot,
		);
	}
	if (frame.type === "frontend.update") return read(payload.changes);
	return undefined;
}

/**
 * The session's `streaming` flag a frontend frame states, or `undefined` when it
 * says nothing. Read so an utterance sent into a turn already running (a steer)
 * counts that turn as its answer.
 */
export function streamingOfFrame(
	frame: { type?: unknown; payload?: unknown } | null | undefined,
): boolean | undefined {
	if (!frame || typeof frame.payload !== "object" || frame.payload === null)
		return undefined;
	const payload = frame.payload as Record<string, unknown>;
	const snapshot =
		frame.type === "snapshot" || frame.type === "frontend.replace"
			? (payload.frontend as { snapshot?: unknown } | undefined)?.snapshot
			: frame.type === "frontend.update"
				? payload.changes
				: undefined;
	if (!snapshot || typeof snapshot !== "object") return undefined;
	const value = (snapshot as { streaming?: unknown }).streaming;
	return typeof value === "boolean" ? value : undefined;
}

/**
 * The ids of the history entries a SNAPSHOT frame carries, or `undefined` for
 * any other frame. Only the snapshot is read: it is the one frame that states
 * the history page as state, which is where an absorbed take's message lives.
 */
export function historyIdsOfFrame(
	frame: { type?: unknown; payload?: unknown } | null | undefined,
): string[] | undefined {
	if (!frame || frame.type !== "snapshot") return undefined;
	if (typeof frame.payload !== "object" || frame.payload === null)
		return undefined;
	const history = (frame.payload as { history?: unknown }).history;
	if (!history || typeof history !== "object") return undefined;
	const entries = (history as { entries?: unknown }).entries;
	if (!Array.isArray(entries)) return undefined;
	const ids: string[] = [];
	for (const entry of entries) {
		const id = (entry as { id?: unknown } | null)?.id;
		if (typeof id === "string" && id !== "") ids.push(id);
	}
	return ids;
}

/**
 * The session's `generation` a frame states, or `undefined`: on a turn's own
 * `agent_start`/`agent_end` event, on a frontend update's changes, or on a
 * snapshot or replace's frontend snapshot.
 */
export function generationOfFrame(
	frame: { type?: unknown; payload?: unknown } | null | undefined,
): number | undefined {
	if (!frame || typeof frame.payload !== "object" || frame.payload === null)
		return undefined;
	const payload = frame.payload as Record<string, unknown>;
	const holder =
		frame.type === "snapshot" || frame.type === "frontend.replace"
			? (payload.frontend as { snapshot?: unknown } | undefined)?.snapshot
			: frame.type === "frontend.update"
				? payload.changes
				: frame.type === "event"
					? payload
					: undefined;
	if (!holder || typeof holder !== "object") return undefined;
	const value = (holder as { generation?: unknown }).generation;
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * The request ids in the session's steering queue a frontend frame states, or
 * `undefined` when it says nothing about the queue.
 */
export function queuedSteeringOfFrame(
	frame: { type?: unknown; payload?: unknown } | null | undefined,
): string[] | undefined {
	if (!frame || typeof frame.payload !== "object" || frame.payload === null)
		return undefined;
	const payload = frame.payload as Record<string, unknown>;
	const holder =
		frame.type === "snapshot" || frame.type === "frontend.replace"
			? (payload.frontend as { snapshot?: unknown } | undefined)?.snapshot
			: frame.type === "frontend.update"
				? payload.changes
				: undefined;
	if (!holder || typeof holder !== "object") return undefined;
	const queue = (holder as { queued_steering?: unknown }).queued_steering;
	if (!Array.isArray(queue)) return undefined;
	const ids: string[] = [];
	for (const row of queue) {
		const id = (row as { id?: unknown } | null)?.id;
		if (typeof id === "string" && id !== "") ids.push(id);
	}
	return ids;
}
