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
 * does not hold the slot, `starting` while the rig loads, `listening` while it is
 * ready and nothing is owed, `working` while a take this window relayed is out
 * or its turn runs, `error` when the rig or the last step failed. Speaking is the
 * rig's (it is heard, in the WebUI), not a phase this window tracks.
 */

import { create } from "zustand";
import type { QwenVoiceStatus } from "../../../../shared/desktop-contract";
import type { DesktopVoiceActive } from "../../../../shared/desktop-control-contract";

export type VoicePhase = "off" | "starting" | "listening" | "working" | "error";

type VoiceStoreState = {
	/** The slot as the server last stated it, or `undefined` before any read. */
	active: DesktopVoiceActive | undefined;
	/** Main's rig status, or `undefined` outside Electron (browser development). */
	rig: QwenVoiceStatus | undefined;
	/** `working` (a take owed an answer) or `error` for one session; else null. */
	exchange: { kind: "working" | "error"; sessionId: string } | null;
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
	) => void;
	setPending: (pending: boolean) => void;
	setReplaced: (sessionId: string | null) => void;
	setCardPending: (sessionId: string, pending: boolean) => void;
};

export const useVoiceStore = create<VoiceStoreState & VoiceStoreActions>(
	(set, get) => ({
		active: undefined,
		rig: undefined,
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
			 */
			const lost =
				exchange !== null && active?.session_id !== exchange.sessionId;
			set(lost ? { active, exchange: null } : { active });
		},
		setRig: (rig) => set({ rig }),
		setExchange: (kind, sessionId) =>
			set({
				exchange: kind && sessionId ? { kind, sessionId } : null,
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

/** The session holding the slot, or null when voice is off everywhere. */
export const voiceSessionOf = (
	active: DesktopVoiceActive | undefined,
): string | null => active?.session_id ?? null;

/**
 * The phase one session's header shows: derived, never stored, so the slot, the
 * rig and the exchange cannot disagree about it.
 */
export function voicePhaseOf(
	state: Pick<VoiceStoreState, "active" | "rig" | "exchange">,
	sessionId: string | undefined,
): VoicePhase {
	if (!sessionId || state.active?.session_id !== sessionId) return "off";
	if (state.exchange?.sessionId === sessionId) return state.exchange.kind;
	const rig = state.rig?.rig;
	if (rig === "error") return "error";
	if (rig === "starting") return "starting";
	// `stopped` while the slot is held (an app relaunch) is `off` with the
	// "Start voice" action; the indicator reads `rig` for that.
	if (rig === "stopped") return "off";
	return "listening";
}
