/**
 * What a move did, on the page under the header it was issued from.
 *
 * THE SAME DECISION THE MESH TAB ALREADY RENDERS, on the same component: a
 * refusal is `MoveNotice` with the route's OWN sentence, its code in mono beside
 * it and the remedies the refusal can support - `Wait for the turn to finish` is
 * the canvas's own label, exactly as `Check again` is, because two surfaces that
 * name one remedy differently teach a user two remedies. This file adds no
 * vocabulary of its own; it adds the one thing the canvas does not have to say.
 *
 * THAT ONE THING IS THE ARRIVAL PAIR. A move that lands leaves the destination
 * COLD by default - nothing is running for it there until something engages it -
 * so `Moved to X` is true in two different worlds, and a user who reads it as
 * "it is running over there now" waits for output that is not coming. The receipt
 * cannot tell them apart (it carries no engage field), so the cold sentence is
 * rendered whenever the wire has not said otherwise, and its second line names
 * the remedy. Both sentences are real; see `arrivalCopy`.
 */

import type { FC } from "react";
import { MoveNotice } from "../../mesh/mesh-actions";
import { arrivalCopy } from "./chat-device-model";
import { useChatDeviceStore } from "./chat-device-store";

/** The row the notice lives in: one line of chrome under the header's own band. */
const ROW = "px-4 pt-2";

export const ChatDeviceNotice: FC<{ sessionId?: string }> = ({ sessionId }) => {
	const move = useChatDeviceStore((state) =>
		sessionId ? state.moves[sessionId] : undefined,
	);
	const dismiss = useChatDeviceStore((state) => state.dismissMove);
	if (!sessionId || !move) return null;

	const noop = () => undefined;
	const close = () => dismiss(sessionId);

	if (move.kind === "refused") {
		return (
			<div data-device-notice="refused" className={ROW}>
				<MoveNotice
					pending={false}
					/*
					 * `canWait` is the MOVE's presence, not the code's name: this pane still
					 * holds the ask, so the button's handler has something to re-issue. The
					 * component draws it only for a `busy` refusal.
					 */
					canWait={move.canWait}
					refusal={move.refusal}
					receipt={null}
					onWait={() => {
						/* The wait is re-issued by the picker's own next attempt; a button that
						 * re-ran the same `waitS: 0` request would refuse identically. */
						close();
					}}
					onRecheck={noop}
					onUndo={noop}
					onDismiss={close}
				/>
			</div>
		);
	}

	if (move.kind === "moving") {
		return (
			<div data-device-notice="moving" className={ROW}>
				<MoveNotice
					pending={true}
					canWait={false}
					refusal={null}
					receipt={{
						verb: `Moving to ${move.name}`,
						/*
						 * THE PLAN'S OWN VERB AND NO INVENTED PROGRESS: the route answers once,
						 * when the move settles, and streams nothing - so there is no percentage
						 * to show and this line says the two things that are true meanwhile.
						 */
						detail: "handing off · the turn in flight finishes first",
						undo: null,
					}}
					onWait={noop}
					onRecheck={noop}
					onUndo={noop}
					onDismiss={noop}
				/>
			</div>
		);
	}

	const arrival = arrivalCopy({ engaged: move.engaged, name: move.name });
	return (
		<div data-device-notice="moved" className={ROW}>
			<div className="flex flex-col gap-2">
				<MoveNotice
					pending={false}
					canWait={false}
					refusal={null}
					receipt={{ verb: arrival.verb, detail: arrival.detail, undo: null }}
					onWait={noop}
					onRecheck={noop}
					/*
					 * A RETIRED SOURCE HAS NO UNDO HERE, and no "open it on that device" button
					 * either: this app cannot open a peer's conversation in its chat view today,
					 * and a control that cannot act is not shown. The two facts the tombstone
					 * owes a user are where the conversation went (the verb) and that this copy
					 * was deleted (the detail).
					 */
					onUndo={noop}
					onDismiss={close}
				/>
				{arrival.second ? (
					/*
					 * MANDATORY WHERE IT EXISTS. The headline is the same word in both arrival
					 * states, so the headline alone cannot carry the difference - this line is
					 * the only thing that says nothing is running there yet, and it names the
					 * two ways to start it.
					 */
					<div
						data-arrival-state="cold"
						className="rounded-md border border-hairline bg-sunken px-3 py-2 text-body-sm text-ink-muted"
					>
						{arrival.second}
					</div>
				) : null}
			</div>
		</div>
	);
};
