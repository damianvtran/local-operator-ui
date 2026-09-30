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
import {
	useMeshNetworks,
	useMeshPeers,
	useMeshTransfer,
} from "../../mesh/mesh-store";
import { MOVE_HOLD_DETAIL, arrivalCopy } from "./chat-device-model";
import { useChatDeviceStore } from "./chat-device-store";

/** The row the notice lives in: one line of chrome under the header's own band. */
const ROW = "px-4 pt-2";

/**
 * The route's own ceiling on waiting INSIDE the request (`TransferSession.wait_s
 * <= 300`), which is what the Mesh tab's `busy` remedy re-issues with:
 * `mesh-drop.ts` names it at the refusal that can carry it. It is a ceiling on
 * waiting rather than a promise - the route re-polls and answers when the session
 * goes idle or the budget ends - so the number is the same in both surfaces
 * rather than re-chosen here.
 */
const WAIT_CEILING_S = 300;

export const ChatDeviceNotice: FC<{ sessionId?: string }> = ({ sessionId }) => {
	const move = useChatDeviceStore((state) =>
		sessionId ? state.moves[sessionId] : undefined,
	);
	const beginMove = useChatDeviceStore((state) => state.beginMove);
	const settleMove = useChatDeviceStore((state) => state.settleMove);
	const refuseMove = useChatDeviceStore((state) => state.refuseMove);
	const dismiss = useChatDeviceStore((state) => state.dismissMove);
	const transfer = useMeshTransfer();
	/*
	 * THE SAME TWO READS THE PICKER ALREADY HOLDS, from the store's own cache keys: a
	 * `poll: false` observer reads once per window and rides whatever the rail or the
	 * Mesh tab fetched, so `Check again` costs one read rather than creating a
	 * second poller (see `chat-device-slot.tsx`'s note on the pair).
	 */
	const peers = useMeshPeers(true, { poll: false });
	const networks = useMeshNetworks(true, { poll: false });
	if (!sessionId || !move) return null;

	const close = () => dismiss(sessionId);
	/*
	 * `Check again` RE-READS. The design's remedies are the two a refusal can
	 * support - re-read (reachability is a fact only a read can settle) and wait for
	 * the turn to finish (a `busy` refusal, with the route's own ceiling) - and this
	 * notice shipped BOTH as labels with nothing behind them: `onRecheck` was a noop
	 * and `onWait` only dismissed the notice, so a user was shown a remedy that ran
	 * zero requests (agent review R1-4, QA Q-7).
	 */
	const recheck = () => {
		void peers.refetch();
		void networks.refetch();
	};

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
					canWait={move.canWait && move.plan !== null}
					refusal={move.refusal}
					receipt={null}
					onWait={() => {
						/*
						 * THE PLAN IS THE REFUSED ASK, SO THE REMEDY RE-ISSUES IT ITSELF (agent review
						 * R2-N2). The request below is composed from the plan's OWN destination and mode
						 * with the route's own ceiling (`waitS: 300`), never by re-reading the pane: a
						 * rebuilt request could name a different destination than the refusal answered,
						 * which is what this file claimed while composing it from `move.to`/`move.keep`
						 * and using `plan` only as the button's present/absent gate. `move.to`,
						 * `move.name` and `move.from` stay the pane's own record of the same pick, and
						 * they are what the chip and the notice paint while the re-issue is in flight.
						 */
						const plan = move.plan;
						if (!plan) return;
						beginMove(sessionId, {
							deviceId: move.to,
							name: move.name,
							from: move.from,
						});
						transfer.mutate(
							{
								sessionId,
								to: plan.to,
								keep: plan.keep,
								waitS: WAIT_CEILING_S,
							},
							{
								onSuccess: (outcome) => {
									if (outcome.kind === "moved") {
										settleMove(sessionId, {
											kind: "moved",
											deviceId: move.to,
											name: move.name,
											from: move.from,
											receipt: outcome.receipt,
											engaged: null,
										});
										return;
									}
									refuseMove(sessionId, {
										refusal: outcome.refusal,
										name: move.name,
										canWait: true,
										plan,
										to: plan.to,
										from: move.from,
										keep: plan.keep,
									});
								},
							},
						);
					}}
					onRecheck={recheck}
					onUndo={() => undefined}
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
						 * NO INVENTED PROGRESS: the route answers once, when the move settles, and
						 * streams nothing - so there is no percentage to show. What is true
						 * meanwhile is which side the conversation belongs to and that the app
						 * cannot call it back (agent review R1-N1: the previous line described a
						 * turn in flight, a state the accepted path cannot be in - a busy session
						 * is REFUSED, not drained).
						 */
						detail: MOVE_HOLD_DETAIL,
						undo: null,
					}}
					onWait={() => undefined}
					onRecheck={recheck}
					onUndo={() => undefined}
					/*
					 * NO DISMISS WHILE IT IS IN FLIGHT (UX U4). The button used to be drawn and
					 * do nothing at all; and it cannot do anything here, because clearing this
					 * record would put the chip back on the conversation's OLD placement while
					 * the transfer is still running. The move settles on its own and the
					 * arrival/refusal is dismissible; a control that cannot act is not shown
					 * (this file's own rule for the tombstone's button).
					 */
				/>
			</div>
		);
	}

	const arrival = arrivalCopy({
		engaged: move.engaged,
		name: move.name,
		from: move.from,
		newSessionId: move.receipt.new_session_id,
		sourceRetired: move.receipt.source_retired,
	});
	return (
		<div data-device-notice="moved" className={ROW}>
			<div className="flex flex-col gap-2">
				<MoveNotice
					pending={false}
					canWait={false}
					refusal={null}
					receipt={{ verb: arrival.verb, detail: arrival.detail, undo: null }}
					onWait={() => undefined}
					onRecheck={recheck}
					/*
					 * A RETIRED SOURCE HAS NO UNDO HERE, and no "open it on that device" button
					 * either: this app cannot open a peer's conversation in its chat view today,
					 * and a control that cannot act is not shown. The two facts the tombstone
					 * owes a user are where the conversation went (the verb) and that this copy
					 * was deleted (the detail).
					 */
					onUndo={() => undefined}
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
