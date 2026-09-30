/**
 * What this pane knows about a move it issued, and how to clear it.
 *
 * WHY A STORE RATHER THAN COMPONENT STATE. The control and the notice live in
 * two different places on screen - the chip is in the header's title block (the
 * only row that can name a device), the notice is a row in the page below it -
 * and the fact they share is one move's outcome. Lifting it to the page would
 * put three props on a component that already takes forty; a tiny store keyed by
 * the pane keeps each read local to the surface that paints it.
 *
 * NOT PERSISTED, DELIBERATELY. A move's outcome is about THIS window's request:
 * `phases` is the transcript of an operation this process performed, and a
 * reload cannot know whether the registry survived it. The durable half of the
 * same fact is the session's own locality, which the backend answers.
 */

import { create } from "zustand";
import type { MovePlan } from "../../mesh/mesh-drop";
import type { MeshRefusal, TransferReceipt } from "../../mesh/mesh-types";

/**
 * One move, as this pane is showing it.
 *
 * `moving` is the GESTURE's own optimism and nothing else: a move may hold a
 * request for minutes and may still be refused after it starts, so the chip says
 * "moving" while it is in flight, and the outcome below replaces it. `moved`
 * carries what the receipt actually said - including where the session landed
 * and whether the destination engaged it - because a receipt is the only thing
 * that may move a chip.
 */
export type DeviceMove =
	| { kind: "moving"; deviceId: string; name: string; from: string | null }
	| {
			kind: "moved";
			deviceId: string;
			name: string;
			/**
			 * The device the conversation came FROM, or `null` when it did not come from a
			 * peer (a recall sets it, and it is what makes the arrival pair a different
			 * sentence: see `arrivalCopy`).
			 */
			from: string | null;
			receipt: TransferReceipt;
			/**
			 * Whether the destination STARTED the conversation, when the wire said
			 * so, and `null` when it did not. `null` is not a failure state: it is
			 * the honest "nobody told us", and it renders the cold arrival sentence
			 * - which is what every peer that predates `engage_on_arrival` actually
			 * does. See `arrivalCopy`.
			 */
			engaged: boolean | null;
	  }
	| {
			kind: "refused";
			refusal: MeshRefusal;
			name: string;
			canWait: boolean;
			/**
			 * The move the refusal is ABOUT, so `Wait for the turn to finish` has
			 * something to re-issue.
			 *
			 * A `busy` refusal is not a failure of the request; it is the route saying
			 * "not while a turn is in flight", and its remedy is the same request with
			 * the route's own ceiling (`wait_s ≤ 300`). Without the plan the button
			 * could only dismiss - which is what both review and QA measured it doing
			 * (agent review R1-4, QA Q-7).
			 */
			plan: MovePlan | null;
			/** The device it was moving to, for the re-issue's chip and notice. */
			to: string;
			from: string | null;
			keep: boolean;
	  };

type ChatDeviceState = {
	/** Keyed by the pane: the session id, or the draft key before one exists. */
	moves: Record<string, DeviceMove>;
	beginMove: (
		key: string,
		move: { deviceId: string; name: string; from: string | null },
	) => void;
	settleMove: (
		key: string,
		move: Extract<DeviceMove, { kind: "moved" }>,
	) => void;
	refuseMove: (
		key: string,
		move: Omit<Extract<DeviceMove, { kind: "refused" }>, "kind">,
	) => void;
	dismissMove: (key: string) => void;
};

export const useChatDeviceStore = create<ChatDeviceState>((set) => ({
	moves: {},
	beginMove: (key, move) =>
		set((state) => ({
			moves: { ...state.moves, [key]: { kind: "moving", ...move } },
		})),
	settleMove: (key, move) =>
		set((state) => ({ moves: { ...state.moves, [key]: move } })),
	refuseMove: (key, move) =>
		set((state) => ({
			moves: { ...state.moves, [key]: { kind: "refused", ...move } },
		})),
	/*
	 * THE WHOLE ENTRY GOES, not a flag on it: the notice is dismissed and the chip
	 * returns to the conversation's own placement, which is the backend's answer
	 * rather than a stale receipt's.
	 */
	dismissMove: (key) =>
		set((state) => {
			const next = { ...state.moves };
			delete next[key];
			return { moves: next };
		}),
}));
