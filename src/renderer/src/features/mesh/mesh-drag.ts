/**
 * The drag, as a state machine rather than as a pile of pointer booleans.
 *
 * WHY A REDUCER. The plan's drag has five visible states, four transient, and the
 * failures that matter are all about a state lasting longer than its cause: a
 * ghost that outlives its pointer, a target that stays highlighted after the drag
 * ends, a chip stuck at `moving…` because a refusal arrived while a re-read was in
 * flight. Handing the transitions to one pure function makes each of them a
 * transition a test can take, with no renderer and no pointer - and the renderer
 * then has nothing to remember, which is what keeps "one style write per frame"
 * true of the ghost as well as of the transform.
 *
 * WHAT IT IS NOT: it is not the network's state machine. The transfer's own phases
 * arrive completed on a receipt (the route is ONE ANSWER, not a stream), so this
 * machine carries only what a pointer can produce: which chip is lifted, which
 * target it is over, and what the target's verdict is.
 *
 * ONE DRAG AT A TIME, enforced by construction: `begin` is ignored while a drag is
 * in flight, so a second finger cannot lift a second chip. That is a decision about
 * the protocol rather than about pointers - two concurrent asks about one
 * conversation is what `in_progress` refuses on the route
 * (`MOVE_REFUSAL_CODES`), and a UI that could produce it would be generating
 * refusals for a user to read.
 */

import type { DragPayload, DropTarget } from "./mesh-drop";

/** How far the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

export type DragState =
	/** Nothing is being dragged, and no pointer is down. */
	| { kind: "idle" }
	/** A pointer is down on a chip, but this may still be a click. */
	| {
			kind: "pressing";
			payload: DragPayload;
			originX: number;
			originY: number;
			pointerId: number;
	  }
	/** The chip is lifted: a ghost follows the pointer and targets resolve. */
	| {
			kind: "dragging";
			payload: DragPayload;
			/** Where the ghost is, in CLIENT coordinates. */
			x: number;
			y: number;
			/** What the pointer is over, resolved by `closest()` at the last frame. */
			target: DropTarget;
			pointerId: number;
	  }
	/** The pointer was released over a target; the verdict is being decided. */
	| { kind: "settling"; payload: DragPayload; target: DropTarget };

export type DragEvent =
	/** A pointer press on a chip that may become a drag. */
	| {
			kind: "press";
			payload: DragPayload;
			x: number;
			y: number;
			pointerId: number;
	  }
	/** Pointer motion: promotes a press to a drag past the threshold, else moves. */
	| { kind: "move"; x: number; y: number; target: DropTarget }
	/** The pointer was released. */
	| { kind: "release" }
	/** The pointer was cancelled (a system gesture, a lost capture, a blur). */
	| { kind: "cancel" }
	/** The drag's outcome landed (a receipt, a refusal, or nothing to do). */
	| { kind: "settled" };

export const IDLE_DRAG: DragState = { kind: "idle" };

/** The chip currently lifted, for a renderer that needs to mark it. */
export function draggedSessionId(state: DragState): string | null {
	switch (state.kind) {
		case "dragging":
		case "settling":
			return state.payload.session.id;
		case "pressing":
			// A press is not yet a drag, and it is NOT marked as one: a chip that
			// showed a lifted state the moment it was touched would flicker under
			// every click, which is the whole reason the threshold exists.
			return null;
		default:
			return null;
	}
}

/** The target a verdict should be computed for, or null when there is none. */
export function activeTarget(state: DragState): DropTarget | null {
	switch (state.kind) {
		case "dragging":
			return state.target;
		case "settling":
			return state.target;
		default:
			return null;
	}
}

/**
 * The next state, from the current one and one event.
 *
 * THE TRANSITIONS THAT MATTER, each named because each one is a bug someone has
 * shipped:
 *
 *   - `press` while anything but `idle` is IGNORED. A second pointer cannot lift a
 *     second chip, and a press cannot arrive in the middle of a settle.
 *   - `move` promotes `pressing` to `dragging` only past `DRAG_THRESHOLD_PX` - the
 *     distance, not the time, so a slow deliberate click is still a click and a
 *     flick is still a drag.
 *   - `release` from `pressing` is a CLICK and returns to `idle`: the pointer went
 *     down and up on the same chip without travelling, so the chip's own activation
 *     runs and no move is asked for.
 *   - `release` from `dragging` goes to `settling` over the SAME target, so the
 *     verdict is decided for where the pointer actually was - not for wherever the
 *     last animation frame happened to leave the highlight.
 *   - `cancel` and `settled` both return to `idle`, and `cancel` is reachable from
 *     every state: a browser that takes the pointer (a system gesture, a lost
 *     capture) must not leave a ghost on screen, which is the state a drag rig
 *     leaks and a user then reads as a stuck UI.
 */
export function dragReducer(state: DragState, event: DragEvent): DragState {
	switch (event.kind) {
		case "press":
			if (state.kind !== "idle") return state;
			return {
				kind: "pressing",
				payload: event.payload,
				originX: event.x,
				originY: event.y,
				pointerId: event.pointerId,
			};
		case "move":
			if (state.kind === "pressing") {
				const travelled = Math.max(
					Math.abs(event.x - state.originX),
					Math.abs(event.y - state.originY),
				);
				if (travelled < DRAG_THRESHOLD_PX) return state;
				return {
					kind: "dragging",
					payload: state.payload,
					x: event.x,
					y: event.y,
					target: event.target,
					pointerId: state.pointerId,
				};
			}
			if (state.kind === "dragging") {
				return { ...state, x: event.x, y: event.y, target: event.target };
			}
			return state;
		case "release":
			if (state.kind === "dragging") {
				return {
					kind: "settling",
					payload: state.payload,
					target: state.target,
				};
			}
			if (state.kind === "pressing") return IDLE_DRAG;
			return state;
		case "cancel":
		case "settled":
			return IDLE_DRAG;
		default:
			return state;
	}
}
