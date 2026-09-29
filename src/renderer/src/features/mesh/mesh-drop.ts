/**
 * What a drop MEANS, decided without pixels.
 *
 * ONE PURE FUNCTION, and that is a design requirement rather than tidiness: every
 * refusal path in this feature has to be testable without a renderer, a backend or
 * a second machine, because that is the only way the expensive half - a real move
 * between two devices - stays a confirmation of the semantics rather than the
 * place they were first exercised. `scripts/mesh-tab.test.mjs` drives this module
 * through the whole matrix; the bench drives the same verdicts through a pointer.
 *
 * ## The protocol decides the shape, and it is not the obvious one
 *
 * THERE IS NO PUSH VERB. A device cannot move a conversation ONTO another device;
 * the device that will HOLD the conversation issues the move and pulls it
 * (`guide://network`). So every drag here is a REQUEST, and the drop indicator
 * names the operation the two devices are about to perform - "Move to
 * devon-laptop", "Recall to this device" - rather than a generic "+".
 *
 * That gives three verdicts and no fourth:
 *
 *   - **`plan`** - a valid target. The plan names the resulting operation, whether
 *     it needs a confirmation, and (separately) the alternative that is not
 *     destructive: a `keep` copy, which mints a new id at the destination and
 *     leaves the source running, so "undo" is honest rather than a claim that a
 *     deleted copy came back.
 *   - **`none`** - the target is the session's own home. Not an error, not a
 *     refusal: the user dropped a thing where it already is, and the UI says
 *     nothing rather than inventing a problem.
 *   - **`refused`** - with the code the route would have used where the route owns
 *     the decision, and the sentence that goes with it.
 *
 * ## Refusals come from two places, and the codes keep them apart
 *
 * A refusal can be **the move's own** - one of `MOVE_REFUSAL_CODES` in
 * `local_operator/network/mobility.py`, mirrored here by the ones a client can know
 * BEFORE asking - or **this client's**, for the two facts the wire does not carry
 * as a move refusal: a `suspect` device (a security fact that outranks
 * reachability, PR #498's `stateOf` precedence) and a revoked membership. The
 * client-side two are named `suspect_device` and `revoked_membership` and are
 * deliberately NOT spelled as move codes, so a reader can tell which side decided
 * - `busy` and `unreachable` mean "the route will say this", and the other two mean
 * "this app will not ask".
 *
 * ## The BUSY case is a refusal rather than a wait, and the wait is offered
 *
 * A session with a turn in flight refuses a move rather than being interrupted
 * (`busy`: "the refusal changes nothing"). The client therefore does not pretend
 * a drop will work: it says so while hovering, and offers the one honest action -
 * wait for the turn to finish - which is a SECOND request with the route's own
 * `wait_s` ceiling rather than a client-side hold. A drop that looked instant and
 * then held a request for five minutes without saying so is the failure this
 * avoids.
 */

import type { MeshDevice, MeshNetwork } from "./mesh-graph";
import { type MeshSessionRow, sessionIsBusy } from "./mesh-types";

/** What the pointer is over. */
export type DropTarget =
	| { kind: "device"; deviceId: string }
	| { kind: "network"; networkId: string }
	| { kind: "ground" };

/** The session being dragged, with the facts a verdict needs. */
export type DragPayload = {
	session: MeshSessionRow;
	/** The device that holds it NOW, resolved (a local row's owner is this device). */
	ownerDeviceId: string;
	ownerLabel: string;
};

/** The context a verdict is decided in: the reads, as the canvas drew them. */
export type DropContext = {
	selfDeviceId: string | null;
	devices: ReadonlyMap<string, MeshDevice>;
	networks: ReadonlyMap<string, MeshNetwork>;
};

/**
 * The one operation a drop would perform.
 *
 * `to` is the route's own parameter, and its two forms are the two protocols:
 * a device id is "ask that device to pull this", and `"local"` is "pull it here".
 * `keep` is the reversible half: the destination mints a NEW id (`new_session_id`
 * on the receipt) and the source's copy is not retired, which is why the undo is
 * a real erasure rather than a claim.
 */
export type MovePlan = {
	sessionId: string;
	to: string;
	keep: boolean;
	/** The indicator's words: what this drop DOES, as a sentence fragment. */
	verb: string;
	/** The `wait_s` this request carries. `0` unless the user asked to wait. */
	waitS: number;
	/**
	 * Null when the move is safe to make without a question, otherwise what the
	 * confirmation names as lost. See {@link planConfirm}.
	 */
	lost: string | null;
};

/** The action that fixes a refusal, when there is one. */
export type Remedy =
	| { kind: "wait"; label: string; waitS: number }
	| { kind: "resume"; label: string }
	| { kind: "open"; label: string; deviceId: string };

export type DropVerdict =
	| { kind: "plan"; plan: MovePlan; alternatives: MovePlan[]; risky: boolean }
	| { kind: "none" }
	| {
			kind: "refused";
			code: string;
			sentence: string;
			remedy: Remedy | null;
			/**
			 * The move that was refused, when the refusal is about ONE move rather than about
			 * a destination (agent review round 1, F2). The `wait` remedy re-issues it with
			 * the route's own ceiling: without the plan the remedy has nothing to re-issue and
			 * the button the notice draws does nothing - which is exactly what it did on every
			 * path that can produce a `busy` refusal, because the page read the plan off a
			 * `pendingMove` the refusal had already cleared.
			 */
			plan?: MovePlan | null;
	  };

/**
 * What a live runtime costs to move, in the user's terms.
 *
 * "CONFIRM BY RISK" (the decisions file, item 5) needs a definition of risk, and
 * the one this build can actually measure is the backend's own liveness word for
 * the session: `attached` means a front end is on this conversation right now, and
 * `busy` means a turn is in flight - which this client refuses rather than
 * confirms, because interrupting is not the user's other option here. What the
 * wire does NOT publish is "uncommitted state"; there is no field for it, so a
 * session with no live runtime confirms nothing and the `keep` copy is offered as
 * the undo instead. That is the honest reading of the signal available rather than
 * a claim that a quiet session cannot hold unsaved work.
 */
export function hasLiveRuntime(session: MeshSessionRow): boolean {
	return session.live_state.trim().toLowerCase() === "attached";
}

/**
 * Whether the plan has to be confirmed before it is sent.
 *
 * A MOVE DELETES THE SOURCE'S COPY once the handoff commits
 * (`source_retired = (mode == "move")`), so the confirmation names exactly that.
 * A `keep` copy never confirms: it is the reversible half, and its undo is the
 * erasure of the copy it made.
 */
export function planConfirm(
	plan: MovePlan,
	risky: boolean,
): { body: string; confirmLabel: string; risky: boolean } | null {
	if (plan.keep || !plan.lost) return null;
	return {
		body: plan.lost,
		// THE LABEL NAMES THE VERB THE INDICATOR NAMED, so the dialog cannot claim a
		// different operation from the one the drop offered (Grafana's node contract:
		// one meaning per channel).
		confirmLabel: plan.to === "local" ? "Recall it" : "Move it",
		/*
		 * RISK IS CARRIED RATHER THAN FOLDED INTO THE SENTENCE, because it decides the
		 * dialog's EMPHASIS and not merely its words: a session with a live runtime
		 * leads with what is lost and recommends the copy, while a quiet one leads with
		 * the move and states the loss as a fact. Both confirm, which is the rule the
		 * decisions file states first - "a destructive move confirms and names what is
		 * lost" - and `risky` is what keeps the confirmation from reading the same in
		 * the two cases it exists to tell apart.
		 */
		risky,
	};
}

/** The sentence a destructive move reads out before it is sent. */
/**
 * What a move costs, in one sentence, naming BOTH ends.
 *
 * The plan's rule is that the confirmation names what is lost rather than asking
 * "are you sure", and the loss is not symmetric between the two directions: an
 * offload deletes the copy HERE, a recall deletes the copy THERE. A single
 * sentence written from one end would be wrong half the time - which is how a
 * dialog comes to say "the copy here is deleted" about a copy that is not here.
 */
export function lossSentence(deletedOn: string, gainedBy: string): string {
	return `The copy on ${deletedOn} is deleted once ${gainedBy} has it.`;
}

/**
 * The risk clause, when the session is running somewhere while it is asked to move.
 *
 * A LIVE RUNTIME IS THE RISK THIS CONFIRMATION EXISTS FOR, and it is what
 * `hasLiveRuntime` reads: a move of a session that is open somewhere can retire a
 * copy whose in-memory state (an in-flight turn, an unsent draft) has no place on
 * the other device. The busy case never gets this far - a turn in flight is a
 * REFUSAL, not a confirmation - so this clause is about the quieter half: attached,
 * with nothing in flight.
 *
 * UNCOMMITTED STATE CANNOT BE READ FROM THIS WIRE, and that is stated rather than
 * approximated: no field on a session row says whether a draft exists, so the
 * confirmation names the runtime it can see and does not claim anything about what
 * the runtime holds.
 */
function runtimeSentence(session: MeshSessionRow, where: string): string {
	return `${session.name || "This conversation"} is running ${where} right now.`;
}

/** Where a device's label is shown; the id's tail when it never told us a name. */
function peerLabel(device: MeshDevice | undefined, deviceId: string): string {
	return device?.label || deviceId.slice(-6);
}

/**
 * The refusal a device node gives, from what this client knows before asking.
 *
 * THE ORDER IS THE POINT. A `suspect` device takes precedence over everything,
 * including unreachability: a duplicate key is a security fact, and a node that
 * said "unreachable" about a suspect device would let the user read the wrong
 * reason and retry. Reachability is second because "nothing changed" is what the
 * user is deciding about. `busy` is not here - it is a fact about the SESSION, and
 * it is asked first in {@link resolveDrop}, because a busy source refuses every
 * target and there is no reason to check the target's state to say so.
 */
function deviceRefusal(
	device: MeshDevice,
	deviceId: string,
): Extract<DropVerdict, { kind: "refused" }> | null {
	if (device.suspect) {
		return {
			kind: "refused",
			code: "suspect_device",
			sentence: `${device.label} has a duplicated key${device.reason ? ` (${device.reason})` : ""}, so nothing is moved to it until that is resolved.`,
			remedy: { kind: "open", label: "See this device", deviceId },
		};
	}
	if (device.memberships.every((membership) => !membership.active)) {
		return {
			kind: "refused",
			code: "revoked_membership",
			sentence: `${device.label} is no longer a member of any network this device shares.`,
			remedy: { kind: "open", label: "See this device", deviceId },
		};
	}
	if (!device.reachable) {
		return {
			kind: "refused",
			code: "unreachable",
			sentence: `${device.label} is not answering${device.reason ? ` (${device.reason})` : ""}, so nothing was moved.`,
			remedy: { kind: "resume", label: "Check again" },
		};
	}
	return null;
}

/**
 * What dropping `payload` on `target` would do.
 *
 * THE SESSION'S OWN STATE IS ASKED FIRST, before the target's: a `busy` session
 * refuses every target in the same words, and a verdict that reached the target's
 * checks first would report an unreachable peer for a refusal the source had
 * already decided.
 */
export function resolveDrop(
	payload: DragPayload,
	target: DropTarget,
	context: DropContext,
): DropVerdict {
	const { session, ownerDeviceId, ownerLabel } = payload;
	const { selfDeviceId, devices, networks } = context;

	if (target.kind === "ground") return { kind: "none" };

	if (target.kind === "network") {
		/*
		 * A CONVERSATION BELONGS TO A DEVICE, NOT TO A NETWORK. This is not a
		 * protocol refusal but a modelling one, and it says so in the user's terms:
		 * the network node is a container, and dragging a chip onto it cannot mean
		 * "put this in the container" because the container is not where a session
		 * lives. (Dropping a DEVICE on a network is the gesture the protocol itself
		 * refuses - admission is two-sided - and it is why that gesture is not a drag
		 * in this build at all; see `mesh-page.tsx`'s invite action.)
		 */
		const network = networks.get(target.networkId);
		return {
			kind: "refused",
			code: "not_a_device",
			sentence: `A conversation lives on a device. ${network?.label ?? "A network"} holds devices, not conversations.`,
			remedy: null,
		};
	}

	if (sessionIsBusy(session)) {
		/*
		 * `waitS` is the route's own ceiling (`TransferSession.wait_s <= 300`), and it
		 * is a ceiling on waiting INSIDE the request rather than a promise: the route
		 * re-polls for the session to go idle and answers when it does or when the
		 * budget ends. The chip enters a waiting state so a request that may hold for
		 * minutes is never a silent one.
		 */
		return {
			kind: "refused",
			code: "busy",
			sentence: `${session.name || "This conversation"} has a turn in flight, so it is not moved — the refusal changes nothing.`,
			remedy: {
				kind: "wait",
				label: "Wait for the turn to finish",
				waitS: 300,
			},
			/*
			 * THE MOVE THIS REFUSAL IS ABOUT, so the remedy can re-issue it (see the verdict's
			 * own comment). It is the move the plan arm below would have built for the same
			 * drop - the destination, the direction, and the non-destructive `keep: false` the
			 * gesture meant - so choosing to wait continues the move the reader asked for
			 * rather than posing the question again.
			 */
			plan: {
				sessionId: session.id,
				to: target.deviceId === selfDeviceId ? "local" : target.deviceId,
				keep: false,
				verb:
					target.deviceId === selfDeviceId
						? "Recall to this device"
						: `Move to ${peerLabel(devices.get(target.deviceId), target.deviceId)}`,
				waitS: 0,
				lost: null,
			},
		};
	}

	if (ownerDeviceId === target.deviceId) {
		/*
		 * Dropping a conversation back on the device that already holds it. Nothing to
		 * do and nothing to say: this is the most common mis-drop in a canvas where the
		 * chips and their node are one target, and answering it with a refusal would
		 * teach the user that the canvas is fragile.
		 */
		return { kind: "none" };
	}

	const destination = devices.get(target.deviceId);
	const refused = destination
		? deviceRefusal(destination, target.deviceId)
		: {
				code: "unknown_device",
				sentence: "That device is no longer in any network this tab can read.",
				remedy: null,
			};
	if (refused) return { kind: "refused", ...refused };

	const destinationLabel = peerLabel(destination, target.deviceId);
	const sourceIsLocal = session.locality === "local";

	/*
	 * A RECALL NEEDS THE SOURCE TO ANSWER. The session lives on a peer and this
	 * device is asking for it back, so an owner that has stopped answering is a
	 * refusal about the SOURCE rather than about the target - and it is the same
	 * `unreachable` code, because it is the same fact: a device that is not
	 * answering, so nothing changed.
	 */
	if (!sourceIsLocal) {
		const owner = devices.get(ownerDeviceId);
		if (owner && !owner.reachable) {
			return {
				kind: "refused",
				code: "unreachable",
				sentence: `${ownerLabel} is not answering${owner.reason ? ` (${owner.reason})` : ""}, so it could not hand this conversation over.`,
				remedy: { kind: "resume", label: "Check again" },
			};
		}
		if (target.deviceId !== selfDeviceId) {
			/*
			 * `third_device`: "a move asked for by a device that is neither end". This
			 * desktop can ask a peer to pull from HERE, and it can pull home; it cannot
			 * order two other devices to swap a conversation, and pretending otherwise
			 * would put a request on the wire that the route refuses.
			 */
			return {
				kind: "refused",
				code: "third_device",
				sentence: `This conversation is on ${ownerLabel}. It has to travel through this device: recall it here first.`,
				remedy: null,
			};
		}
	}

	if (target.deviceId === selfDeviceId) {
		// The recall: this device asks for a conversation a peer holds.
		const plan: MovePlan = {
			sessionId: session.id,
			to: "local",
			keep: false,
			verb: "Recall to this device",
			waitS: 0,
			lost: hasLiveRuntime(session)
				? `${runtimeSentence(session, `on ${ownerLabel}`)} ${lossSentence(ownerLabel, "this device")}`
				: lossSentence(ownerLabel, "this device"),
		};
		return {
			kind: "plan",
			plan,
			// A recall's risk is about the SOURCE, which is the peer: this device asks
			// for the conversation and the peer deletes its copy once the handoff
			// commits, exactly as an offload deletes this device's.
			risky: hasLiveRuntime(session),
			alternatives: [
				{
					...plan,
					keep: true,
					verb: "Copy here, leave it there",
					lost: null,
				},
			],
		};
	}

	if (session.locality === "local" && target.deviceId === ownerDeviceId) {
		// Unreachable in practice (the owner IS this device for a local row) and kept
		// as a named case rather than an `if` that cannot fire: `ownerDeviceId` is
		// resolved by the caller, and a caller that resolved it from a stale row would
		// otherwise get the offload plan for a drop onto the session's own node.
		return { kind: "none" };
	}

	// The offload: this device asks the peer to take it.
	const risky = hasLiveRuntime(session);
	const plan: MovePlan = {
		sessionId: session.id,
		to: target.deviceId,
		keep: false,
		verb: `Move to ${destinationLabel}`,
		waitS: 0,
		lost: risky
			? `${runtimeSentence(session, "on this device")} ${lossSentence("this device", destinationLabel)}`
			: lossSentence("this device", destinationLabel),
	};
	return {
		kind: "plan",
		plan,
		risky,
		alternatives: [
			{
				...plan,
				keep: true,
				verb: `Copy to ${destinationLabel}`,
				lost: null,
			},
		],
	};
}

/**
 * The prospective sentence a hover shows over a refused target.
 *
 * The plan's own rule, and it is Atlassian's: only valid targets accept, and the
 * indicator states the resulting operation - so an INVALID target states the
 * refusal while the pointer is still over it, rather than accepting the drop and
 * then answering "no". The actual refusal, when one arrives from the route, carries
 * the route's own sentence instead of this one; this is the sentence for a
 * question the client can already answer.
 */
export function hoverSentence(verdict: DropVerdict): string | null {
	if (verdict.kind === "refused")
		return `Drop will be refused: ${verdict.sentence}`;
	if (verdict.kind === "plan") return verdict.plan.verb;
	return null;
}

/**
 * The two asks a refusal can offer, as the surface's own action set.
 *
 * `wait` re-issues the SAME move with the route's `wait_s` ceiling; `resume`
 * re-reads, because the thing that changed is a device's reachability and only a
 * read can say whether it is still true. A referee that offered a generic "retry"
 * would be offering the one action that is wrong for both: retrying a busy session
 * immediately is what `busy` refuses, and retrying an unreachable peer without
 * re-reading is how a user builds a second request for a move that already failed.
 */
export function remedyIntent(remedy: Remedy | null): string | null {
	if (!remedy) return null;
	return remedy.kind === "wait" ? "wait-for-idle" : remedy.kind;
}
