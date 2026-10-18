/**
 * SESSION VOICE'S RENDERER STATE (the backend's docs/design/qwen-voice.md): which
 * session holds the machine-wide slot, where the rig is, and where this window's
 * one voice exchange is.
 *
 * `active` is a MIRROR, never a decision. The slot lives on the server (V3); this
 * store holds the last value the server stated - the GET, a POST's answer, or the
 * feed's `voice` frame - so the toggle, the sidebar marker and the controller all
 * draw one answer. Nothing here writes the slot except by asking the route.
 *
 * `rig` mirrors main's `voice.qwen.status`: the Qwen rig (s2s and the Gateway)
 * is main's to start and stop, and this window only shows it.
 *
 * `phase` is the exchange, hands-free now (design Q8): `off` when this session
 * does not hold the slot, `starting` while the rig loads, `unheard` while the rig
 * is ready but nothing can hear (the header says which failure), `hearing` while
 * the rig's VAD says Ben is speaking, `speaking` while the rig is playing a
 * reply, `listening` while it is ready, a page is connected and nothing is owed,
 * `working` while a take this window relayed is out or its turn runs, `error`
 * when the rig or the last step failed. `hearing` and `speaking` come from the
 * Gateway's allowlisted events (`voice.qwen.event`), because only the rig knows
 * when audio is actually moving.
 */

import { create } from "zustand";
import type { QwenVoiceStatus } from "../../../../shared/desktop-contract";
import type { DesktopVoiceActive } from "../../../../shared/desktop-control-contract";

export type VoicePhase =
	| "off"
	| "starting"
	| "unheard"
	| "mic_prompting"
	| "mic_blocked"
	| "paused"
	| "hearing"
	| "speaking"
	| "listening"
	| "working"
	| "error";

/** The live half of the exchange, as the rig reports it. */
export type VoiceActivity = "speaking" | "hearing";

/** Why one exchange failed, as the strip says it. */
export type VoiceExchangeError = "not_sent";

/**
 * THE TWO TRANSIENT WORDS, each said once and then replaced by "Listening"
 * (design D2/D3). They are store state rather than component state because the
 * EVENTS that start them - a reply that ended, a playback that was cut - arrive
 * in the controller, one window's single subscription to the rig.
 *
 * `at` is when the word went up, so the strip can retire it without guessing.
 */
export type VoiceTick =
	| { kind: "ended"; sessionId: string; at: number; text: string | null }
	| { kind: "interrupted"; sessionId: string; at: number; seconds: number };

/**
 * ONE ROW OF THE COMPOSER'S HISTORY: an exchange (what was heard and what was
 * said back), or an event that belongs in the same list because the spoken half
 * never happened (an interruption, a take the card refused).
 *
 * The rows are this window's own record - the rig keeps no history the renderer
 * can read - and they are bounded by `VOICE_STORY_LIMIT`; "last 5" is the panel's
 * whole claim.
 */
export type VoiceStoryRow =
	| {
			kind: "exchange";
			at: number;
			sessionId: string;
			heard: string;
			spoken: string | null;
			truncated: boolean;
	  }
	| { kind: "interrupted"; at: number; sessionId: string; seconds: number }
	| { kind: "not_sent"; at: number; sessionId: string; heard: string };

/** How many rows the history panel keeps; "last 5" is its stated bound. */
export const VOICE_STORY_LIMIT = 5;

type VoiceStoreState = {
	/** The slot as the server last stated it, or `undefined` before any read. */
	active: DesktopVoiceActive | undefined;
	/** Main's rig status, or `undefined` outside Electron (browser development). */
	rig: QwenVoiceStatus | undefined;
	/**
	 * What the rig is doing with audio right now (`voice.qwen.event`), or null.
	 * Cleared by its own stop/end events, so a lost event leaves "Listening"
	 * rather than a stuck "Speaking".
	 */
	activity: VoiceActivity | null;
	/**
	 * The last text this window had spoken, with the server's cut flag (§8). The
	 * TEXT is kept because the strip's caption and the history row both quote it;
	 * it is the server's own words for the answer, never a renderer-composed line.
	 */
	lastSpoken: {
		sessionId: string;
		text: string;
		truncated: boolean;
		/** When the words went out, so the cut chip can retire on the next take. */
		at: number;
	} | null;
	/**
	 * The last take this window relayed, so the strip can say "You said …" while
	 * the answer is being worked out. The take's text is the rig's transcript of
	 * what was heard - there is no partial transcript to show, so this is the
	 * first and only text of a take the renderer ever sees.
	 */
	lastTake: { sessionId: string; text: string; at: number } | null;
	/** Where the reply being played started, on the Gateway's clock, or null. */
	playbackStartedAt: number | null;
	/** The transient word in the strip, or null when there is none. */
	tick: VoiceTick | null;
	/** The composer history panel's rows, oldest first, at most VOICE_STORY_LIMIT. */
	story: VoiceStoryRow[];
	/**
	 * When a take was DROPPED for length (BRIEF-1), on the Gateway's clock, or
	 * null. The VAD discards a segment over `--max_speech_ms`, so the strip owes
	 * the person a line instead of silence.
	 */
	droppedTakeAt: number | null;
	/** `working` (a take owed an answer) or `error` for one session; else null. */
	exchange: {
		kind: "working" | "error";
		sessionId: string;
		reason?: VoiceExchangeError;
	} | null;
	/** A control call (enable/disable) is in flight; the toggle shows it. */
	pending: boolean;
	/** The session that just LOST the slot to a switch, for its notice. */
	replaced: string | null;
	/**
	 * Sessions whose stream says a card is pending - an approval or a blocking
	 * ask - mirrored from the turn fold so the header can say so.
	 */
	cardPending: Record<string, true>;
};

type VoiceStoreActions = {
	setActive: (active: DesktopVoiceActive) => void;
	setRig: (rig: QwenVoiceStatus) => void;
	setExchange: (
		kind: "working" | "error" | null,
		sessionId: string | null,
		reason?: VoiceExchangeError,
	) => void;
	setActivity: (activity: VoiceActivity | null) => void;
	setLastSpoken: (spoken: {
		sessionId: string;
		text: string;
		truncated: boolean;
		at: number;
	}) => void;
	setDroppedTake: (at: number | null) => void;
	/** A take was relayed: the strip's subject and the history's `You:` half. */
	noteTake: (sessionId: string, text: string, at: number) => void;
	/** A take was refused because a card is on screen: an event row, no words. */
	noteNotSent: (sessionId: string, heard: string, at: number) => void;
	/**
	 * The rig's audio moved. `started` arms the interruption clock; `ended` says
	 * "Reply ended" for 1.5 s; `cancelled` says "Interrupted at m:ss" for 3 s and
	 * never plays the end cue (design D2/D3).
	 */
	notePlayback: (
		kind: "started" | "ended" | "cancelled",
		sessionId: string,
		at: number,
	) => void;
	/** Retire a transient word (the strip's own timer calls this). */
	clearTick: () => void;
	setPending: (pending: boolean) => void;
	setReplaced: (sessionId: string | null) => void;
	setCardPending: (sessionId: string, pending: boolean) => void;
};

/** Oldest rows fall off the front, so the panel's "last 5" is the whole bound. */
function capStory(story: VoiceStoryRow[]): VoiceStoryRow[] {
	return story.length > VOICE_STORY_LIMIT
		? story.slice(story.length - VOICE_STORY_LIMIT)
		: story;
}

/** Fill the newest unanswered exchange for a session, or add nothing. */
function completeStoryRow(
	story: VoiceStoryRow[],
	spoken: { sessionId: string; text: string; truncated: boolean; at: number },
): VoiceStoryRow[] {
	for (let index = story.length - 1; index >= 0; index--) {
		const row = story[index];
		if (
			row.kind !== "exchange" ||
			row.sessionId !== spoken.sessionId ||
			row.spoken !== null
		)
			continue;
		const next = [...story];
		next[index] = { ...row, spoken: spoken.text, truncated: spoken.truncated };
		return next;
	}
	return story;
}

export const useVoiceStore = create<VoiceStoreState & VoiceStoreActions>(
	(set, get) => ({
		active: undefined,
		rig: undefined,
		activity: null,
		lastSpoken: null,
		lastTake: null,
		playbackStartedAt: null,
		tick: null,
		story: [],
		droppedTakeAt: null,
		exchange: null,
		pending: false,
		replaced: null,
		cardPending: {},
		setActive: (active) => {
			const { exchange } = get();
			/*
			 * THE SLOT MOVING ENDS AN EXCHANGE FOR THE SESSION THAT LOST IT. A turn
			 * already admitted keeps running in that session - voice does not cancel
			 * agent work - but its answer is no longer spoken.
			 *
			 * It also clears the live activity: the rig cancels on a move, but a
			 * lost cancel must not leave the new holder's header saying "Speaking".
			 */
			const lost =
				exchange !== null && active?.session_id !== exchange.sessionId;
			const moved = get().active?.session_id !== active?.session_id;
			set({
				active,
				...(lost ? { exchange: null } : {}),
				/*
				 * A TRANSIENT WORD DOES NOT SURVIVE A MOVE: "Interrupted at 0:24"
				 * belongs to the session that lost the slot, and the new holder's strip
				 * must not open with a sentence about audio it never played.
				 */
				...(moved ? { activity: null, tick: null } : {}),
			});
		},
		/*
		 * A RIG THAT IS NOT READY, OR A PAGE THAT IS GONE, HAS NO LIVE ACTIVITY
		 * (review M1): a lost `playback.ended` must not leave "Speaking" up after
		 * the rig stopped or the page dropped, so the mirror clears whenever the
		 * status could no longer support the claim.
		 */
		setRig: (rig) =>
			set((state) => ({
				rig,
				activity:
					rig.rig === "ready" && (rig.clients ?? 0) > 0 ? state.activity : null,
			})),
		setActivity: (activity) => set({ activity }),
		setLastSpoken: (lastSpoken) =>
			set((state) => ({
				lastSpoken,
				/*
				 * The history's `Voice:` half lands on the row its take opened: the take is
				 * relayed first and the reply is spoken afterwards, so the newest row for
				 * this session that nothing has answered yet is that take's own row. A
				 * spoken line with no such row (a gate announcement, or a reply spoken
				 * after the window was reloaded) has no exchange to complete and adds
				 * none - a row with no question would say nothing true.
				 */
				story: completeStoryRow(state.story, lastSpoken),
			})),
		setDroppedTake: (droppedTakeAt) => set({ droppedTakeAt }),
		noteTake: (sessionId, text, at) =>
			set((state) => ({
				lastTake: { sessionId, text, at },
				story: capStory([
					...state.story,
					{
						kind: "exchange",
						at,
						sessionId,
						heard: text,
						spoken: null,
						truncated: false,
					},
				]),
			})),
		noteNotSent: (sessionId, heard, at) =>
			set((state) => ({
				story: capStory([
					...state.story,
					{ kind: "not_sent", at, sessionId, heard },
				]),
			})),
		notePlayback: (kind, sessionId, at) => {
			const state = get();
			if (kind === "started") {
				set({ playbackStartedAt: at });
				return;
			}
			if (kind === "ended") {
				set({
					playbackStartedAt: null,
					tick: {
						kind: "ended",
						sessionId,
						at,
						text: state.lastSpoken?.text ?? null,
					},
				});
				return;
			}
			/*
			 * A CANCELLED PLAYBACK IS AN INTERRUPTION, and how far into the reply it
			 * happened is the one number that separates a real barge-in from a
			 * phantom cut (design D3). With no start time on record the words would
			 * have to be invented, so the strip says nothing instead.
			 */
			const startedAt = state.playbackStartedAt;
			if (startedAt === null) {
				set({ activity: null });
				return;
			}
			const seconds = Math.max(0, Math.round((at - startedAt) / 1000));
			set({
				playbackStartedAt: null,
				tick: { kind: "interrupted", sessionId, at, seconds },
				story: capStory([
					...state.story,
					{ kind: "interrupted", at, sessionId, seconds },
				]),
			});
		},
		clearTick: () => set({ tick: null }),
		setExchange: (kind, sessionId, reason) =>
			set({
				exchange:
					kind && sessionId
						? reason
							? { kind, sessionId, reason }
							: { kind, sessionId }
						: null,
			}),
		setPending: (pending) => set({ pending }),
		setReplaced: (replaced) => set({ replaced }),
		setCardPending: (sessionId, pending) => {
			const current = get().cardPending;
			if (Boolean(current[sessionId]) === pending) return;
			const next = { ...current };
			if (pending) next[sessionId] = true;
			else delete next[sessionId];
			set({ cardPending: next });
		},
	}),
);

/**
 * What one Gateway event does to the activity: a new activity, `"idle"` to
 * clear it, or null when the event says nothing about audio (a response
 * finishing, a task moving). `playback.ended` and `playback.cancelled` both
 * clear; the cancelled one never plays the end earcon, which the caller owns.
 */
export function activityOfEvent(type: string): VoiceActivity | "idle" | null {
	switch (type) {
		case "realtime.playback.started":
			return "speaking";
		case "realtime.provider.speech_started":
			return "hearing";
		case "realtime.playback.ended":
		case "realtime.playback.cancelled":
		case "realtime.provider.speech_stopped":
			return "idle";
		default:
			return null;
	}
}

/** The session holding the slot, or null when voice is off everywhere. */
export const voiceSessionOf = (
	active: DesktopVoiceActive | undefined,
): string | null => active?.session_id ?? null;

/**
 * The phase one session's header shows: derived, never stored, so the slot, the
 * rig and the exchange cannot disagree about it.
 */
export function voicePhaseOf(
	state: Pick<VoiceStoreState, "active" | "rig" | "exchange" | "activity">,
	sessionId: string | undefined,
): VoicePhase {
	if (!sessionId || state.active?.session_id !== sessionId) return "off";
	const rig = state.rig?.rig;
	// A RIG error wins over this window's exchange (UX round 2, U9): a stale
	// "not sent" would hide the rig's reason and its "Try again".
	if (rig === "error") return "error";
	// A failed take is the state the person must act on, even while they talk.
	if (
		state.exchange?.sessionId === sessionId &&
		state.exchange.kind === "error"
	)
		return "error";
	/*
	 * THE MICROPHONE OUTRANKS THE READY/STOPPED WORDS (review M3): a pending
	 * prompt is what is happening right now, and a denial is the thing to fix.
	 * Without these a stopped rig would offer "Start voice" over a blocked mic,
	 * and a start waiting on the OS dialog would read "Starting voice" forever.
	 */
	/*
	 * PAUSE OUTRANKS THE MICROPHONE AND THE READY WORDS: while paused the page is
	 * closed, so there is nothing hearing, nothing to speak through and no
	 * microphone to be blocked - the mic's verdict is about a page that is not
	 * there. The rig's ERROR above it still wins: dead models are news.
	 */
	if (state.rig?.paused) return "paused";
	if (state.rig?.mic === "denied") return "mic_blocked";
	if (state.rig?.mic === "prompting") return "mic_prompting";
	if (rig === "starting") return "starting";
	// `stopped` while the slot is held (an app relaunch) is `off` with the
	// "Start voice" action; the indicator reads `rig` for that.
	if (rig === "stopped") return "off";
	// Outside Electron there is no rig to ask (browser development): as before.
	if (state.rig === undefined) return "listening";
	/*
	 * AUDIO MOVING BEATS "WORKING": the moment the rig plays a reply the turn is
	 * no longer what the person is waiting on, and while they speak, "Hearing
	 * you" is the honest word even if a turn is out.
	 */
	if (state.activity) return state.activity;
	if (state.exchange?.sessionId === sessionId) return state.exchange.kind;
	return (state.rig.clients ?? 0) > 0 ? "listening" : "unheard";
}
