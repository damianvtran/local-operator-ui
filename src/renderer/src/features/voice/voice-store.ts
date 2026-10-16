/**
 * SESSION VOICE'S RENDERER STATE (`docs/design/session-voice.md`): which session
 * holds the machine-wide slot, and where this window's one voice exchange is.
 *
 * `active` is a MIRROR, never a decision. The slot lives on the server (V3); this
 * store holds the last value the server stated - the GET, a POST's answer, or the
 * feed's `voice` frame - so the toggle, the sidebar marker and the controller all
 * draw one answer. Nothing here writes the slot except by asking the route.
 *
 * `phase` is the exchange: `listening` while the push-to-talk hold is down,
 * `sending` while the take uploads, `working` while the session's turn runs,
 * `speaking` while the answer plays, `error` when the last step failed (cleared by
 * the next hold). It is per window: a second window that holds no take is idle.
 */

import { create } from "zustand";
import type { DesktopVoiceActive } from "../../../../shared/desktop-control-contract";

export type VoicePhase =
	| "idle"
	| "listening"
	| "sending"
	| "working"
	| "speaking"
	| "error";

type VoiceStoreState = {
	/** The slot as the server last stated it, or `undefined` before any read. */
	active: DesktopVoiceActive | undefined;
	phase: VoicePhase;
	/** The session the current phase belongs to, so a switch can drop it. */
	phaseSessionId: string | null;
	/** A control call (enable/disable) is in flight; the toggle shows it. */
	pending: boolean;
	/** The session that just LOST the slot to a switch, for its notice. */
	replaced: string | null;
	/**
	 * Sessions whose stream says an approval is pending, mirrored from the turn
	 * fold so the header can say so (design round 2, D7). The fold stays the
	 * authority push-to-talk reads; this is its render-time copy.
	 */
	approvalPending: Record<string, true>;
};

type VoiceStoreActions = {
	setActive: (active: DesktopVoiceActive) => void;
	setPhase: (phase: VoicePhase, sessionId: string | null) => void;
	setPending: (pending: boolean) => void;
	setReplaced: (sessionId: string | null) => void;
	setApprovalPending: (sessionId: string, pending: boolean) => void;
};

export const useVoiceStore = create<VoiceStoreState & VoiceStoreActions>(
	(set, get) => ({
		active: undefined,
		phase: "idle",
		phaseSessionId: null,
		pending: false,
		replaced: null,
		approvalPending: {},
		setActive: (active) => {
			const { phaseSessionId } = get();
			/*
			 * THE SLOT MOVING ENDS AN EXCHANGE FOR THE SESSION THAT LOST IT. A turn
			 * already admitted keeps running in that session - voice does not cancel
			 * agent work - but its answer is no longer spoken: the operator moved the
			 * microphone somewhere else.
			 */
			const lost =
				phaseSessionId !== null && active?.session_id !== phaseSessionId;
			set(lost ? { active, phase: "idle", phaseSessionId: null } : { active });
		},
		setPhase: (phase, sessionId) =>
			set({ phase, phaseSessionId: phase === "idle" ? null : sessionId }),
		setPending: (pending) => set({ pending }),
		setReplaced: (replaced) => set({ replaced }),
		setApprovalPending: (sessionId, pending) => {
			const current = get().approvalPending;
			if (Boolean(current[sessionId]) === pending) return;
			const next = { ...current };
			if (pending) next[sessionId] = true;
			else delete next[sessionId];
			set({ approvalPending: next });
		},
	}),
);

/** The session holding the slot, or null when voice is off everywhere. */
export const voiceSessionOf = (
	active: DesktopVoiceActive | undefined,
): string | null => active?.session_id ?? null;
