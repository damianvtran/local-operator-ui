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
	 * Utterances this renderer sent that no turn end has consumed yet. A count,
	 * not a flag: two quick takes during one turn are still one turn to answer.
	 *
	 * ARMED WHEN THE SEND STARTS, NOT WHEN IT IS ANSWERED. A fast turn (the `test`
	 * mock provider answers in milliseconds) can reach `agent_end` on the stream
	 * before the upload's 200 reaches this window; arming on the answer would miss
	 * exactly that turn. A send that fails disarms (`disarmed`), since nothing was
	 * admitted and no turn will answer it.
	 */
	armed: number;
	/** A turn is running on the session (between `agent_start` and `agent_end`). */
	inFlight: boolean;
	/**
	 * A turn that can answer the armed utterance has been seen: one was already
	 * running when it was sent (it is admitted as a steer, V5), or one started
	 * after. A replayed `agent_end` of a turn that ended before the send is not
	 * the answer.
	 */
	turnSeen: boolean;
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
};

export type VoiceTurnsInput =
	/** This renderer is sending an utterance to the session. */
	| { kind: "armed" }
	/** That send failed: nothing was admitted. */
	| { kind: "disarmed" }
	/** The session's `streaming` flag, as a frontend frame states it. */
	| { kind: "streaming"; streaming: boolean }
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
		armed: 0,
		inFlight: false,
		turnSeen: false,
		lastMessageId: null,
		spoken: [],
		announced: [],
		pendingApproval: null,
	};
}

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
		return {
			state: {
				...state,
				armed: state.armed + 1,
				turnSeen: state.turnSeen || state.inFlight,
			},
			speak: [],
		};
	}
	if (input.kind === "disarmed") {
		const armed = Math.max(0, state.armed - 1);
		return {
			state: { ...state, armed, turnSeen: armed > 0 && state.turnSeen },
			speak: [],
		};
	}
	if (input.kind === "streaming") {
		return {
			state: {
				...state,
				inFlight: input.streaming,
				turnSeen: state.turnSeen || (input.streaming && state.armed > 0),
			},
			speak: [],
		};
	}
	if (input.kind === "stopped") {
		return {
			state: { ...state, pendingApproval: null, inFlight: false },
			speak: [],
		};
	}
	if (input.kind === "gate") {
		const gate = input.gate;
		const requestId =
			gate && gate.kind === "approval" && typeof gate.request_id === "string"
				? gate.request_id
				: "";
		if (requestId === "") {
			return { state: { ...state, pendingApproval: null }, speak: [] };
		}
		const pending = { ...state, pendingApproval: requestId };
		if (state.announced.includes(requestId))
			return { state: pending, speak: [] };
		const seen = {
			...pending,
			announced: remember(state.announced, requestId),
		};
		// A snapshot's gate was parked before this watcher saw it: never spoken.
		if (input.snapshot) return { state: seen, speak: [] };
		/*
		 * ONLY THE WINDOW THAT SENT WORDS ANNOUNCES (U2). Every window holding the
		 * slot watches the same stream, and an approval reached by typing - or by
		 * another window's take - is not this window's to say aloud.
		 */
		if (state.armed === 0) return { state: seen, speak: [] };
		return { state: seen, speak: [{ kind: "gate", requestId }] };
	}
	const event = input.event;
	const type = event.type;
	if (type === "agent_start") {
		// A new turn: an earlier turn's last message is not this one's answer.
		return {
			state: {
				...state,
				inFlight: true,
				turnSeen: state.turnSeen || state.armed > 0,
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
		const ended: VoiceTurnsState = {
			...state,
			inFlight: false,
			lastMessageId: null,
		};
		if (state.armed === 0 || !state.turnSeen) {
			// Not a turn this renderer sent to (typed, a wake, or one that ended
			// before the send): nothing to say.
			return { state: ended, speak: [] };
		}
		const id = state.lastMessageId;
		const next: VoiceTurnsState = { ...ended, armed: 0, turnSeen: false };
		/*
		 * AN INTERRUPTED TURN IS NOT SPOKEN (U3). A stop, an abort or an error
		 * ends the turn without the answer the words asked for; reading out its
		 * last partial message would present a fragment as the reply. The take is
		 * consumed either way - the operator can speak again.
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
