/**
 * The mini FRAME's state machine — pure, so the desktop suite drives every
 * transition without a DOM, and the component stays a drawing of it.
 *
 * WHAT THE RESTYLE CHANGED, and why this file is a fraction of its former
 * self. Before the shared composer, the mini owned its whole send path (the
 * draft, the seat gate, four send phases, the retry taxonomy) and this machine
 * was that path's state machine. The composer owns all of it now — the draft
 * lives in `useMessageInput` keyed by the seat conversation, the send phases
 * live in the store (`sendUnsettledForSession` is the authority, the same rule
 * `chat-content.tsx` documents), and a refusal renders through the composer's
 * own `sendError` slot with its own Retry. What remains on the FRAME is only
 * what the composer cannot know: the resting sentence under the box (`notice`
 * — seat failures and sheet sentences) and the "Sent" flash that precedes the
 * window hiding itself.
 *
 * THE ONE INVARIANT WORTH STATING: a standing `notice` survives a re-summon
 * and only the flash resets (the failure it names has not changed), which is
 * the rule the pre-restyle machine shipped (QA round 1, Q1) kept in its new,
 * smaller shape.
 */

export interface MiniFrameState {
	/**
	 * The sentence under the box when it is not the resting hint, or null.
	 *
	 * The TONE rides with the sentence because the register is part of what the
	 * sentence IS: a seat or switch failure is the error register (danger),
	 * while the context chip's readout is a measurement and states itself in
	 * muted ink. Two slots for one line would let the two disagree about what is
	 * on screen.
	 */
	notice: { text: string; tone: "muted" | "danger" } | null;
	/** The "Sent" flash is up; the hide timer is running. */
	sent: boolean;
}

export const MINI_FRAME_INITIAL: MiniFrameState = {
	notice: null,
	sent: false,
};

export const miniFrameTransitions = {
	/** Say one sentence under the box, replacing any standing one. */
	noted(
		state: MiniFrameState,
		sentence: string,
		tone: "muted" | "danger" = "danger",
	): MiniFrameState {
		return { ...state, notice: { text: sentence, tone } };
	},

	/** The notice's subject moved on (a successful pick, a cleared failure). */
	clearNotice(state: MiniFrameState): MiniFrameState {
		if (state.notice === null) return state;
		return { ...state, notice: null };
	},

	/** The message was admitted: the flash goes up and the notice comes down. */
	sentUp(state: MiniFrameState): MiniFrameState {
		return { ...state, notice: null, sent: true };
	},

	/**
	 * A re-summon. Only the "Sent" flash resets, and only the flash: a
	 * standing notice keeps standing because the failure it names has not
	 * changed (the pre-restyle machine's rule, kept).
	 */
	summoned(state: MiniFrameState): MiniFrameState {
		if (!state.sent) return state;
		return { ...state, sent: false };
	},
};

/**
 * THE THEME A PREFERENCES WRITE CARRIES, for the popout's live sync.
 *
 * WHY THIS EXISTS. `ui-preferences-store` is zustand-persist: each document
 * hydrates ONE copy at import and zustand does not listen for other documents'
 * writes. The mini published its theme once at boot and re-read its own stale
 * in-memory copy on every summon, so a theme selected in the main window never
 * reached the popout - the operator photographed the popout on tokyoNightStorm
 * while the app ran obsidian. The platform's own `storage` event is the
 * transport the draft store already uses across these two documents
 * (`conversation-input-sync.ts`); this is the reader that says which write is a
 * theme change and what it says.
 *
 * Pure and import-free so the desktop suite drives malformed blobs without a
 * window: a foreign key, a missing value and anything that is not the persisted
 * `{ state: { themeName } }` shape all answer null, and the caller leaves the
 * palette it has.
 */
export function themeNameFromPreferencesWrite(input: {
	eventKey: string | null;
	storeKey: string;
	newValue: string | null;
}): string | null {
	if (input.eventKey !== input.storeKey || input.newValue === null) return null;
	try {
		const parsed = JSON.parse(input.newValue) as {
			state?: { themeName?: unknown };
		};
		const name = parsed.state?.themeName;
		return typeof name === "string" && name.length > 0 ? name : null;
	} catch {
		return null;
	}
}
