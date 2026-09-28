/**
 * Where a conversation runs, and the sentences that say so.
 *
 * WHY THIS FILE IS SEPARATE FROM THE CONTROL. Every string below is a decision
 * about a CLAIM the app makes ("this is running here", "this does not exist
 * yet"), and a claim that lives inside JSX cannot be tested without a browser.
 * So the placement type, its labels, the picker's rows and the arrival pair are
 * pure functions here, and `chat-header-device.tsx` only paints them.
 *
 * THE MINIMAL PAIR THIS FILE EXISTS FOR: `New on X` (a conversation that does
 * not exist yet WILL be created on X) against `On X` (it exists, on X). The
 * operator asked for this control on a new chat, before any runtime is mounted,
 * and the failure mode to design against is a user reading a DRAFT as a live
 * session and waiting for output that is not coming. The word `New` is the
 * whole defence, which is why the draft arm cannot fall through to a label that
 * omits it.
 *
 * WHAT THIS MODULE DOES NOT KNOW. It does not read the mesh, the session
 * catalogue or the wire: it is handed the facts and answers the copy. That is
 * also the seam that keeps `engage_on_arrival` honest - see `arrivalCopy`
 * below, which renders the cold sentence whenever nobody told us otherwise.
 */

import type { NetworkSummary, PeerRow } from "../../mesh/mesh-types";
import type { DeviceMove } from "./chat-device-store";

/* ------------------------------------------------------------- placements */

/**
 * Where the conversation is, or will be.
 *
 * `deviceId` is the wire's device id (`d_…`) except in the draft arm, where
 * `null` is THIS device: a draft's destination is not a peer the backend has
 * named back to us, it is a choice the user has not exercised yet.
 */
export type DevicePlacement =
	/** A new chat: nothing exists, so the chip answers "where will this be created". */
	| { kind: "draft"; deviceId: string | null; name: string }
	/** A live conversation this device runs. */
	| { kind: "local" }
	/**
	 * A live conversation another device runs.
	 *
	 * `reachable` IS TRI-STATE AND THAT IS THE HONEST SHAPE: `null` means no read
	 * has made a claim about that device since this window moved the conversation,
	 * and the chip then draws NO dot - the dot exists to state a reachability fact,
	 * so without one there is nothing for it to say. Reading `null` as `false` would
	 * paint a warning about a device nobody has asked.
	 */
	| {
			kind: "remote";
			deviceId: string;
			name: string;
			reachable: boolean | null;
			reason: string;
	  }
	/** This device's copy is gone because the conversation moved away. */
	| { kind: "gone"; deviceId: string; name: string }
	/** A move this pane issued is in flight. */
	| { kind: "moving"; deviceId: string; name: string };

/** The device a placement names, or `null` for this device. */
export function placementDeviceId(placement: DevicePlacement): string | null {
	switch (placement.kind) {
		case "draft":
			return placement.deviceId;
		case "local":
			return null;
		default:
			return placement.deviceId;
	}
}

/** The name a placement shows for a peer, or `""` when the answer is "here". */
export function placementDeviceName(placement: DevicePlacement): string {
	switch (placement.kind) {
		case "draft":
			return placement.name;
		case "local":
			return "";
		default:
			return placement.name;
	}
}

/**
 * The chip's five words.
 *
 * THE TENSE MARKER IS ONE WORD (`New`), and it is why the draft arm is checked
 * first: every other arm describes something that exists.
 */
export function placementLabel(placement: DevicePlacement): string {
	switch (placement.kind) {
		case "draft":
			return placement.deviceId
				? `New on ${placement.name}`
				: "New on this device";
		case "local":
			return "On this device";
		case "remote":
		case "gone":
			return `On ${placement.name}`;
		case "moving":
			return `Moving to ${placement.name}`;
	}
}

/**
 * The accessible name: everything the five words cannot say.
 *
 * A tooltip was rejected for the draft/host distinction deliberately - a
 * tooltip cannot stop a glance from reading "This device" as "it is running
 * here" - so the sentence carries the tense AND the affordance, and the chip's
 * visible label stays short enough to sit in the title block.
 */
export function placementSentence(placement: DevicePlacement): string {
	switch (placement.kind) {
		case "draft":
			return placement.deviceId
				? `New conversations are created on ${placement.name}. Click to choose a different device.`
				: "New conversations are created on this device. Click to choose a different device.";
		case "local":
			return "This conversation runs on this device. Click to move it to another device.";
		case "remote":
			return placement.reachable
				? `This conversation runs on ${placement.name}. Click to recall it here or move it on.`
				: `This conversation runs on ${placement.name}, which did not answer the last read (${placement.reason}).`;
		case "gone":
			return `This conversation moved to ${placement.name}. The copy that was here was deleted. Click to open it there.`;
		case "moving":
			return `Moving this conversation to ${placement.name}.`;
	}
}

/**
 * Whether the chip draws a reachability dot, and in which tone.
 *
 * THE DOT APPEARS ONLY WHERE THERE IS A REACHABILITY FACT TO STATE, which is
 * why it never needs a legend: this device is here by definition and a draft has
 * nothing to be reachable yet, so neither draws one. `quiet` is the ordinary
 * live remote; `warning` is a device that did not answer the last read - never
 * `success` and never `accent`, because nothing has gone wrong and nothing is
 * being asked for.
 */
export function placementDot(
	placement: DevicePlacement,
): "none" | "quiet" | "warning" {
	if (placement.kind === "remote")
		return placement.reachable ? "quiet" : "warning";
	if (placement.kind === "gone") return "quiet";
	return "none";
}

/* --------------------------------------------------------------- the picker */

export type DeviceRowState = "candidate" | "current" | "ineligible";

/** One device, as the picker states it: the facts the app actually holds. */
export type DeviceRow = {
	deviceId: string;
	name: string;
	/** Rendered joined by `·`, in this order. */
	facts: string[];
	state: DeviceRowState;
	/** Why the row cannot be picked, in the words the fact came in. */
	why?: string;
};

/** One network's devices, headed by the network's own name. */
export type DeviceSection = {
	key: string;
	name: string;
	/** Every member except this device; the heading's own count. */
	count: number;
	rows: DeviceRow[];
};

export type DevicePickerModel = {
	/** `Move this conversation to` / `Start the conversation on`. */
	heading: string;
	self: DeviceRow;
	sections: DeviceSection[];
	/**
	 * The consequence line, PINNED below the scrolling list in the move states
	 * only: a fact that can be scrolled out of sight is not stated, and in a new
	 * chat the choice is free and reversible so there is nothing to warn about.
	 */
	footer: string | null;
	/** The pairing sentence for a device in no network, or `null`. */
	guidance: string | null;
	/**
	 * The membership exists and NOTHING in it answered: the list keeps its rows
	 * and their reasons, and this is the one offer left - a re-read, because
	 * reachability is a fact only a read can settle.
	 */
	offerCheckAgain: boolean;
};

/** The exact consequence the default (deleting) move carries. */
export const MOVE_FOOTER =
	"The copy on this device is deleted when the move commits.";

/**
 * The pairing line for a device in no network.
 *
 * WHY IT IS A TERMINAL COMMAND: the Mesh tab's rail row is gated on membership
 * (a rail item is an invitation, and one for a network the user is not in is a
 * dead end - `app.tsx` says so), and network CREATION is CLI-only. There is no
 * desktop "pair a device" surface to send them to, so the honest instruction is
 * the command that exists rather than a button that does not.
 */
export const PAIRING_GUIDANCE =
	"This device is in no network. Create one with `lop network init`, or join one with `lop network join <token>`.";

/** `1 conversation` / `3 conversations`. */
function conversations(n: number): string {
	return `${n} ${n === 1 ? "conversation" : "conversations"}`;
}

/**
 * `1 device` / `2 devices`, the one spelling of a section heading's count.
 *
 * EXPORTED because the heading lives in `chat-header-device.tsx` and the count is
 * an arithmetic on the membership (`members.length - 1`, this device excluded) - two
 * places writing the plural by hand is how the list and its heading drift.
 */
export function devices(n: number): string {
	return `${n} ${n === 1 ? "device" : "devices"}`;
}
/**
 * Why a row cannot be picked, in the words the fact arrived in.
 *
 * THE BACKEND'S OWN LIMIT OUTRANKS THE PEER'S: if this daemon cannot move a
 * conversation at all (`features.session_transfer`), then every row is refused for
 * that reason rather than for a peer's - blaming a device for a capability this
 * device lacks is the wrong sentence on every row.
 */
function ineligibleReason(input: {
	canTransfer: boolean;
	reachable: boolean;
}): string {
	if (!input.canTransfer) return "this backend cannot move a conversation yet";
	return input.reachable
		? "cannot receive a move"
		: "did not answer the last read";
}

export type PickerInput = {
	placement: DevicePlacement;
	/** This device's own name, and how many conversations it holds. */
	selfName: string;
	selfConversations: number;
	/**
	 * This device's id inside the membership, or `""` when the topology did not
	 * name one. Rows are matched to `this device` by ID and never by name: two
	 * machines can be called `macbook`, and a name collision would draw another
	 * device as the row the user is standing on.
	 */
	selfDeviceId: string;
	networks: NetworkSummary[];
	peers: PeerRow[];
	/**
	 * `features.session_transfer`, which gates the MOVE and only it.
	 *
	 * A daemon can host a network, mint invites and remove members without being
	 * able to move a conversation, and the chip's placement fact stays true and
	 * useful there - so this is not a reason to hide the control. It IS a reason
	 * no row can be picked: every offer below becomes ineligible with that one
	 * sentence, rather than a row that 404s when pressed.
	 */
	canTransfer: boolean;
};

/**
 * The placement a pane's own facts support.
 *
 * A DRAFT AND A LIVE CONVERSATION ARE DIFFERENT QUESTIONS, and the branch order is
 * the design's: a draft is asked "where will this be created", so it never consults
 * the session's state - `New on this device` is right even on a first-run install
 * that has never seen a network.
 */
export function panePlacement(input: {
	/** The draft's destination, when this pane is a new chat. */
	draft: { deviceId: string | null; name: string } | null;
	move: DeviceMove | undefined;
	reachableFor: (deviceId: string) => boolean | null;
}): DevicePlacement {
	const { draft, move, reachableFor } = input;
	if (move?.kind === "moving") {
		return { kind: "moving", deviceId: move.deviceId, name: move.name };
	}
	if (move?.kind === "moved") {
		/*
		 * A MOVE THAT RETIRED THE SOURCE leaves this device with nothing to say "this
		 * device" about: the chip names where the conversation went, which is the one
		 * fact a reader of a window still open on the old id needs.
		 */
		if (move.receipt.source_retired && move.receipt.locality === "remote") {
			return { kind: "gone", deviceId: move.deviceId, name: move.name };
		}
		return {
			kind: "remote",
			deviceId: move.deviceId,
			name: move.name,
			reachable: reachableFor(move.deviceId),
			reason: "",
		};
	}
	if (draft)
		return { kind: "draft", deviceId: draft.deviceId, name: draft.name };
	return { kind: "local" };
}

/**
 * The picker's whole content, from the facts the app holds.
 *
 * CANDIDATE AND INELIGIBLE SHARE ONE ROW SHAPE, deliberately: a device that
 * cannot take a move stays VISIBLE, READABLE and EXPLAINED, because hiding it
 * leaves the user asking "where did build-box go". Only the reason line and the
 * affordance differ.
 *
 * INELIGIBILITY IS NOT A COLOUR. The first render drew the row with
 * `ink-disabled` and measured 1.99:1 against `elevated` on localOperatorDark
 * (2.96:1 on light) - below AA on the one row whose whole job is to be read, so
 * the name stays `ink-muted` and the state is carried by `aria-disabled`, the
 * reason line and the absent hover wash.
 *
 * NO LAN / VPN / PUBLIC-INTERNET DIVIDERS, and this is the design's spine rather
 * than a preference: the backend publishes addresses and classifies none of them
 * (`addresses.py`'s only classifier is "not loopback, not multicast, not
 * link-local", and a tunnel address is deliberately kept), so a WireGuard
 * `10.88.0.x` and an ethernet address arrive indistinguishable and a divider
 * would assert a boundary the app cannot see. The boundary it CAN see is the
 * network the user created, so the sections are networks, headed by their names.
 */
export function devicePickerModel(input: PickerInput): DevicePickerModel {
	const { placement, selfDeviceId, networks, peers } = input;
	/*
	 * The SAME predicate decides the heading, the reason lines and the footer, so
	 * the three cannot disagree about whether a move is being planned: `gone` is
	 * not a move (the conversation is already elsewhere, and this device's row is
	 * a candidate to bring it BACK, which the route calls a recall).
	 */
	const moving = placement.kind === "local" || placement.kind === "remote";
	const destination =
		placement.kind === "remote" || placement.kind === "draft"
			? placement.deviceId
			: null;
	const byDeviceId = new Map(peers.map((peer) => [peer.device_id, peer]));

	/*
	 * THIS DEVICE'S ROW IS ALSO THE RECALL ROW. There is no second control and no
	 * separate "recall" verb in the UI: the direction is which row you pick, which
	 * is why the row is a candidate (not a disabled "you are here") whenever the
	 * conversation is somewhere else.
	 */
	const self: DeviceRow = {
		deviceId: selfDeviceId,
		name: input.selfName,
		facts: [conversations(input.selfConversations), "this device"],
		state:
			placement.kind === "local" || placement.kind === "draft"
				? "current"
				: input.canTransfer
					? "candidate"
					: "ineligible",
		why:
			placement.kind === "local" ||
			placement.kind === "draft" ||
			input.canTransfer
				? undefined
				: ineligibleReason({ canTransfer: false, reachable: true }),
	};

	const sections: DeviceSection[] = networks.map((network) => {
		const rows: DeviceRow[] = network.members
			.filter((member) => member.device_id !== selfDeviceId)
			.map((member) => {
				const peer = byDeviceId.get(member.device_id);
				/*
				 * THE FIELDS THE WIRE ACTUALLY CARRIES, and nothing inferred: the role,
				 * the conversation count when the peer catalogue published one, and the
				 * reachability word only where no reason line will state it (in the move
				 * states the reason line carries it and a second copy would be the same
				 * fact said twice).
				 */
				const facts = [
					member.role,
					peer ? conversations(peer.session_count) : "",
				].filter(Boolean);
				if (!member.reachable && !moving) facts.push("unreachable");
				const eligible =
					input.canTransfer &&
					member.capabilities.includes("move") &&
					member.reachable;
				return {
					deviceId: member.device_id,
					name: member.name,
					facts,
					state:
						destination !== null && member.device_id === destination
							? "current"
							: moving && !eligible
								? "ineligible"
								: "candidate",
					why:
						moving && !eligible
							? ineligibleReason({
									canTransfer: input.canTransfer,
									reachable: member.reachable,
								})
							: undefined,
				} satisfies DeviceRow;
			});
		return {
			key: network.network_id,
			name: network.name,
			count: rows.length,
			rows,
		};
	});

	/*
	 * "NOTHING ANSWERED" IS READ FROM THE MEMBERSHIP, not from whether any row is
	 * eligible: a device can answer and still refuse a move (no `move` capability),
	 * and that is a different fact from a network where every cable is out.
	 */
	const answered = networks.some((network) =>
		network.members.some(
			(member) => member.device_id !== selfDeviceId && member.reachable,
		),
	);

	return {
		heading: moving ? "Move this conversation to" : "Start the conversation on",
		self,
		sections,
		footer: moving ? MOVE_FOOTER : null,
		guidance: networks.length === 0 ? PAIRING_GUIDANCE : null,
		offerCheckAgain: networks.length > 0 && !answered,
	};
}

/* --------------------------------------------------------------- the arrival */

/**
 * What to say when a move answers.
 *
 * TWO SENTENCES, AND BOTH ARE REAL. The default destination sits COLD: the
 * design leaves the lease unclaimed so the first engage wins it, so a moved
 * conversation is, as often as not, not running anywhere yet - and "moved"
 * cannot cover both "running over there" and "there, with nothing to pick it
 * up". A user who reads the first while the second is true waits for output that
 * is not coming, which is why the cold arm carries a MANDATORY second line
 * naming the remedy.
 *
 * `engaged` COMES FROM THE WIRE OR IT IS `null`, and `null` renders the cold
 * sentence. Nothing here guesses from the peer's build: per-peer feature version
 * is not on the wire (`PeerRow` carries no version, and capability lives on the
 * membership rather than on a device version), so "that device is too old to
 * engage it" is not a sentence this app is entitled to render. Until the receipt
 * (or the row) publishes the fact, every arrival renders the sentence that is
 * true for every peer that predates `engage_on_arrival` - cold.
 */
export function arrivalCopy(input: { engaged: boolean | null; name: string }): {
	verb: string;
	detail: string;
	/** Non-null only for the cold arrival; the surface must render it when set. */
	second: string | null;
} {
	const { engaged, name } = input;
	if (engaged === true) {
		return {
			verb: `Moved to ${name}`,
			detail: "the conversation is running there now; the copy here is deleted",
			second: null,
		};
	}
	return {
		verb: `Moved to ${name}`,
		detail: "the conversation is there; the copy here is deleted",
		second: `Nothing is running on ${name} yet. Send a message to start it there, or open the conversation on that device.`,
	};
}

/**
 * The source side of a completed move: the copy here is gone.
 *
 * The chip is `On <device>` (there is nothing left here to say "this device"
 * about) and this sentence is the notice's detail, so the transcript is not
 * silently empty - the two facts the tombstone carries are WHERE it went and
 * that this copy was deleted.
 */
export const SOURCE_RETIRED_DETAIL =
	"the copy on this device was deleted when the move committed";

/** The words a picker row and a chip both need for a device: never an empty label. */
export function deviceName(name: string, deviceId: string): string {
	const trimmed = name.trim();
	return trimmed || deviceId.slice(-8);
}
