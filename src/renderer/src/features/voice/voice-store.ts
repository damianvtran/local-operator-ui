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
	| "hearing"
	| "speaking"
	| "listening"
	| "working"
	| "error";

/** The live half of the exchange, as the rig reports it. */
export type VoiceActivity = "speaking" | "hearing";

/** Why one exchange failed, as the header says it. */
export type VoiceExchangeError = "not_sent";

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
	/** The last text this window had spoken, with the server's cut flag (§8). */
	lastSpoken: { sessionId: string; truncated: boolean } | null;
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
	setLastSpoken: (spoken: { sessionId: string; truncated: boolean }) => void;
	setPending: (pending: boolean) => void;
	setReplaced: (sessionId: string | null) => void;
	setCardPending: (sessionId: string, pending: boolean) => void;
};

export const useVoiceStore = create<VoiceStoreState & VoiceStoreActions>(
	(set, get) => ({
		active: undefined,
		rig: undefined,
		activity: null,
		lastSpoken: null,
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
				...(moved ? { activity: null } : {}),
			});
		},
		setRig: (rig) => set({ rig }),
		setActivity: (activity) => set({ activity }),
		setLastSpoken: (lastSpoken) => set({ lastSpoken }),
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
