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

import type { MovePlan } from "../../mesh/mesh-drop";
import { lossSentence } from "../../mesh/mesh-drop";
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
	/**
	 * This device's copy is gone because the conversation moved away.
	 *
	 * `reachable` IS THE SAME TRI-STATE `remote` CARRIES, and it is here for the same
	 * reason: the conversation now lives on a machine that can stop answering, and
	 * that is exactly the moment a reader most needs to know it (design review round
	 * 1, D4 - the arm had no reachability at all, so the dot the design names could
	 * never be louder than the calm one).
	 */
	| {
			kind: "gone";
			deviceId: string;
			name: string;
			reachable: boolean | null;
	  }
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
			/*
			 * `OR RECALL IT LATER` IS THE SECOND HALF OF THE AFFORDANCE (agent review round
			 * 1, R1-N4): the sentence names both directions a live local conversation can
			 * take from this control, which is the design's own reading of it, because the
			 * chip's five visible words cannot say either one.
			 */
			return "This conversation runs on this device. Click to move it to another device or recall it later.";
		case "remote":
			/*
			 * `reachable` IS TRI-STATE AND THE THIRD VALUE IS NOT A FAILURE (agent review
			 * round 1, R1-2). `null` means no read has made a claim about that device since
			 * this window moved the conversation, so the sentence carries the placement and
			 * the affordance and says nothing about reachability - reading `null` as `false`
			 * announced a failed read nobody had made, with an EMPTY parenthetical, as this
			 * chip's accessible name and its tooltip. The reason is rendered only when the
			 * wire gave one, so the sentence can never end in `()`.
			 */
			if (placement.reachable === false) {
				const because = placement.reason ? ` (${placement.reason})` : "";
				return `This conversation runs on ${placement.name}, which did not answer the last read${because}.`;
			}
			return `This conversation runs on ${placement.name}. Click to recall it here or move it on.`;
		case "gone":
			/*
			 * THE TOMBSTONE NAMES AN ACTION THIS CONTROL CAN TAKE. It used to end "Click to
			 * open it there", and there is no such place: pressing the chip opens this
			 * picker, and the app cannot open a peer's conversation in its chat view (the
			 * notice's own comment says so). The recall - this device's row, which is the
			 * picker's first - is the one thing here that exists, so it is what the
			 * sentence promises (QA Q-2, UX U6). Where it went stays in the first two
			 * clauses, which is the pair of facts the tombstone owes a reader.
			 *
			 * AN UNANSWERED HOLDER IS SAID OUT LOUD (agent review R2-4). `remote` states
			 * the same fact in its own sentence while this arm ignored `reachable`
			 * entirely, so the only channel carrying it was the dot - which is `aria-hidden`
			 * and painted for exactly the reader who does not need the words. The clause is
			 * `reachable === false` and nothing else: `null` is "nobody asked", and a reason
			 * is not invented for a read that did not answer (the tri-state rule design
			 * round 1's D4 settled).
			 */
			if (placement.reachable === false) {
				return `This conversation moved to ${placement.name}, which did not answer the last read. The copy that was here was deleted. Click to bring it back here.`;
			}
			return `This conversation moved to ${placement.name}. The copy that was here was deleted. Click to bring it back here.`;
		case "moving":
			return `Moving this conversation to ${placement.name}.`;
	}
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
	 *
	 * IT NAMES THE COPY THIS PICK ACTUALLY DELETES, which is why it is not one
	 * constant any more: an offload deletes the copy HERE and a recall deletes the
	 * copy THERE, and a single sentence written from one end is wrong half the
	 * time - the mistake `lossSentence` exists for in the Mesh tab's dialog.
	 */
	footer: string | null;
	/** The pairing sentence for a device in no network, or `null`. */
	guidance: string | null;
	/**
	 * The membership COULD NOT BE READ and this is not a fact about the network: an
	 * unanswered read must not be published as "this device is in no network", and
	 * it must not hand the user a remedy for a state they are not in (QA Q-4).
	 * Rendered in the pinned band with the re-read beside it, because a re-read is
	 * the only thing that settles it.
	 */
	readFailure: string | null;
	/**
	 * A move this pane issued is in flight: every row stands down, and this sentence
	 * says why rather than leaving rows that look pickable (agent review R1-5, QA
	 * Q-8, UX U4).
	 */
	inFlight: string | null;
	/**
	 * The membership exists and NOTHING in it answered, or a row's reachability is
	 * the thing standing a row down: the list keeps its rows and their reasons, and
	 * this is the one offer left - a re-read, because reachability is a fact only a
	 * read can settle.
	 */
	offerCheckAgain: boolean;
};

/** The exact consequence the default (deleting) move carries. */
export const MOVE_FOOTER =
	"The copy on this device is deleted when the move commits.";

/**
 * Why a third device cannot be picked from a pane that no longer holds the
 * conversation (agent review R2-1).
 *
 * IT NAMES THE REMEDY RATHER THAN THE BLOCKER, which is the shape the other two
 * reasons have (`cannot receive a move`, `did not answer the last read`): the device
 * is not at fault here, and the sentence a reader needs is how to get where they are
 * going. `mesh-drop.ts` states the same refusal in full (`This conversation is on X.
 * It has to travel through this device: recall it here first.`); this is the row's
 * own short half of it.
 */
export const NOT_HERE_WHY =
	"the conversation is not here to move; recall it here first";

/**
 * What this device's row says when no read has named it.
 *
 * NOT `deviceName()`'s id tail: the tail of a device id is machine voice with
 * nothing to act on, and on the row the app is most sure about - the machine it is
 * running on - the plain word is both shorter and true. The `this device` fact is
 * dropped in the same case so the row does not say it twice.
 */
export const THIS_DEVICE_LABEL = "This device";

/**
 * The pairing line for a device in no network.
 *
 * WHY IT IS A TERMINAL COMMAND: the Mesh tab's rail row is gated on membership
 * (a rail item is an invitation, and one for a network the user is not in is a
 * dead end - `app.tsx` says so), and network CREATION is CLI-only. There is no
 * desktop "pair a device" surface to send them to, so the honest instruction is
 * the command that exists rather than a button that does not.
 *
 * IT IS ONLY TRUE OF AN ANSWERED READ. `networks.data?.networks ?? []` reads the
 * same for "no memberships" and "the read did not answer", so the model only
 * draws this line when the read came back (`PickerInput.meshRead`); the failure
 * has its own sentence below.
 */
export const PAIRING_GUIDANCE =
	"This device is in no network. Create one with `lop network init`, or join one with `lop network join <token>`.";

/**
 * What a read that did not answer may be called.
 *
 * THE OTHER HALF OF THE PAIRING LINE'S RULE, and the case the design's four gates
 * (§3.5) did not name: the device list is empty because nobody answered, which is
 * not a membership fact about this device and has a different remedy.
 */
export const MESH_READ_FAILURE =
	"The device list could not be read, so this is what the last answer holds.";

/**
 * The sentence a pick in flight puts in the picker's pinned band.
 *
 * THE SAME SENTENCE THE COMPOSER HOLDS WITH (SPEC §2.4): the runtime is retired
 * during the handoff, so a second pick would race the first and anything typed here
 * would be delivered nowhere. One state, one wording, two surfaces.
 */
export function moveHoldSentence(name: string): string {
	return `This conversation is moving to ${name}. It continues there; nothing sent from here would be delivered.`;
}

/**
 * The in-flight notice's detail line, which must not describe a busy turn.
 *
 * The design's own draft line read `handing off · the turn in flight finishes
 * first`, and the accepted path cannot be in that state: a session with a turn in
 * flight is REFUSED with `busy` (SPEC §2.5), so the sentence named a state this
 * branch never reaches (agent review R1-N1). What is true meanwhile is which side
 * the conversation belongs to and that the app cannot call it back.
 */
export const MOVE_HOLD_DETAIL =
	"handing off · it continues there; this cannot be stopped from here";

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
	/**
	 * What the two mesh reads answered, as three states rather than one empty list.
	 *
	 * `pending` is not decoration: the first frames of every window are pending, and
	 * a model that reads `networks.data ?? []` publishes "this device is in no
	 * network" - with a `lop network init` instruction - before anything has
	 * answered. `failed` is the same defect from the other end: an error is not a
	 * membership fact (QA Q-4).
	 */
	meshRead: "pending" | "ok" | "failed";
	/**
	 * A move this pane issued is in flight, from the pane's own store rather than
	 * from anything the reads can say.
	 */
	busy: boolean;
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
	/**
	 * WHERE A LIVE CONVERSATION LIVES, when its row states a device other than
	 * this one.
	 *
	 * THE ROW'S OWN STATEMENT, never a second inference: `locality` and
	 * `owner_device` are the wire's fields for it, and a conversation created on
	 * a picked peer carries them from the moment the create lands
	 * (`canonical-sessions-store`'s `createSession`). Without this arm the chip
	 * fell back to `local` the moment the draft it was born from stopped
	 * existing - the operator's "the device selection reverted to local on
	 * send" (2026-09-30): on create success the store patches `sessionId`, the
	 * message's `finishDraft` retires the draft, and the only fact left was
	 * "not a move this pane issued".
	 *
	 * `null` IS "NO ROW HAS SAID ANYTHING" - a local row, a row from a listing
	 * that never asked for peers, or no row at all - and the fallback stays
	 * `local`, which is what every conversation that never left this device
	 * shows. The arm can never overrule a move this pane ISSUED (that receipt
	 * is checked first), and it is reached only through `locality: "remote"`,
	 * so a row that says otherwise is never repainted as remote.
	 */
	host: { deviceId: string; name: string } | null;
	move: DeviceMove | undefined;
	reachableFor: (deviceId: string) => boolean | null;
}): DevicePlacement {
	const { draft, host, move, reachableFor } = input;
	if (move?.kind === "moving") {
		return { kind: "moving", deviceId: move.deviceId, name: move.name };
	}
	if (move?.kind === "moved") {
		/*
		 * A MOVE THAT CAME HOME IS LOCAL, and this arm is the whole of agent review
		 * R1-1 / QA Q-1 / UX U2-U3 / design D1. The route answers a recall with
		 * `locality: "local"`, so the pane is exactly where it started: the same chip,
		 * the same sentences, the same picker as a conversation that never left. Keying
		 * on `source_retired` alone (true in BOTH directions) put a recall into the
		 * `remote` arm with `deviceId: "local"`, and this device was then rendered as a
		 * peer - the accessible name claimed this machine "did not answer the last
		 * read", the arrival notice told the user to open the conversation "on that
		 * device" (the machine they are sitting at), and the picker re-offered a move
		 * that had already happened, under a destructive footer.
		 *
		 * THE RECEIPT DECIDES, not the ask: `move.deviceId === "local"` is what this
		 * window requested, and a receipt is the only thing that may move a chip. Both
		 * are checked because an older refusal path can settle a move without one.
		 */
		if (move.receipt.locality === "local" || move.deviceId === "local") {
			return { kind: "local" };
		}
		/*
		 * A MOVE THAT RETIRED THE SOURCE leaves this device with nothing to say "this
		 * device" about: the chip names where the conversation went, which is the one
		 * fact a reader of a window still open on the old id needs - and it carries the
		 * destination's reachability, because a machine that has stopped answering is
		 * the fact most worth stating here (design D4).
		 */
		if (move.receipt.source_retired) {
			return {
				kind: "gone",
				deviceId: move.deviceId,
				name: move.name,
				reachable: reachableFor(move.deviceId),
			};
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
	/*
	 * THE CONVERSATION THAT EXISTS ELSEWHERE. Reachability is the move paths'
	 * own tri-state (`reachableFor`): `null` draws no dot rather than announcing
	 * a read nobody made.
	 */
	if (host)
		return {
			kind: "remote",
			deviceId: host.deviceId,
			name: host.name,
			reachable: reachableFor(host.deviceId),
			reason: "",
		};
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
	 * the three cannot disagree about whether the pick DELETES A COPY.
	 *
	 * `gone` IS A MOVE SURFACE (agent review R1-5 is not this - design D3 and QA Q-3
	 * are): the pane whose conversation moved away is exactly the pane whose first
	 * row is a move BACK, and leaving it out flipped the panel to the create
	 * vocabulary ("Start the conversation on"), dropped the pinned consequence line
	 * for the pick that does delete a copy - the peer's - and marked no row
	 * ineligible in the one state where the user is most likely to act.
	 */
	const moving =
		placement.kind === "local" ||
		placement.kind === "remote" ||
		placement.kind === "gone" ||
		/*
		 * AND AN IN-FLIGHT `moving` PANE KEEPS THE MOVE'S OWN PANEL (QA Q-8, UX U4): a
		 * pane whose move is in flight looked at through its picker is a conversation
		 * that exists, so its panel keeps the move's heading and the move's consequence
		 * line while every row stands down under the in-flight sentence.
		 */
		placement.kind === "moving";
	/*
	 * THE CONVERSATION IS NOT HERE TO MOVE, so nothing but the recall can be picked
	 * (agent review R2-1). In `gone` this device's copy is already deleted, and a
	 * pick on a third device would ask it to take the conversation from the device
	 * that holds it - two devices this one is not an end of, which the route refuses
	 * (`third_device`). It ships as an INELIGIBLE row with the reason rather than as
	 * a hidden one (the rule this list already follows), because the device is fine:
	 * it is the direction that does not exist from here.
	 */
	const notHere = placement.kind === "gone";
	/*
	 * WHERE THE CONVERSATION IS, for the row that must be marked `current`. A draft's
	 * destination is where it WILL be created; a live conversation's is where it is.
	 */
	const destination =
		placement.kind === "remote" ||
		placement.kind === "draft" ||
		placement.kind === "gone"
			? placement.deviceId
			: null;
	/*
	 * THIS DEVICE IS THE CURRENT ROW ONLY WHERE IT IS ACTUALLY HERE. A draft aimed at a
	 * peer has TWO rows that match the destination otherwise (the peer's, and this
	 * device's, whose `draft` arm used to mark itself current unconditionally), and a
	 * list with two current rows cannot tell a reader which machine the chip is naming.
	 */
	const selfIsHere =
		placement.kind === "local" ||
		(placement.kind === "draft" && placement.deviceId === null);
	const byDeviceId = new Map(peers.map((peer) => [peer.device_id, peer]));
	/*
	 * THE SELF ROW'S NAME COMES FROM THE MEMBERSHIP, AND ITS ABSENCE IS NOT A FACT
	 * ABOUT THIS MACHINE. When neither read answered (or the topology named no self
	 * device) there is no name to print, and an empty name cell is the deformation QA
	 * measured; the app's own word is true in every one of those cases, so it is what
	 * the row says - and the redundant `this device` fact is dropped with it.
	 */
	const selfName = input.selfName.trim();

	/*
	 * THIS DEVICE'S ROW IS ALSO THE RECALL ROW. There is no second control and no
	 * separate "recall" verb in the UI: the direction is which row you pick, which
	 * is why the row is a candidate (not a disabled "you are here") whenever the
	 * conversation is somewhere else.
	 */
	const self: DeviceRow = {
		deviceId: selfDeviceId,
		name: selfName || THIS_DEVICE_LABEL,
		facts: selfName
			? [conversations(input.selfConversations), "this device"]
			: [conversations(input.selfConversations)],
		state: selfIsHere
			? "current"
			: input.canTransfer
				? "candidate"
				: "ineligible",
		why:
			selfIsHere || input.canTransfer
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
				/*
				 * THE HOLDER IS `current` AND KEEPS ITS OWN FACTS: the device holding the
				 * conversation is reachable and capable, so without this split the row the
				 * recall is pressed on would be refused by the recall's own reason.
				 */
				const holder = destination !== null && member.device_id === destination;
				const standsDown = moving && (!eligible || (notHere && !holder));
				return {
					deviceId: member.device_id,
					name: member.name,
					facts,
					state: holder ? "current" : standsDown ? "ineligible" : "candidate",
					/*
					 * THE ROW'S OWN REASON OUTRANKS THE DIRECTION'S. A device that cannot
					 * receive a move, or that did not answer the last read, says THAT - the
					 * direction reason is added only where it is the whole of the objection,
					 * so a reader of a `gone` pane still learns which of their devices is
					 * capable and which is answering. The `eligible` arm below is reached
					 * only when `standsDown` is true, i.e. when `notHere && !holder` is what
					 * refused the row.
					 */
					why: !standsDown
						? undefined
						: eligible
							? NOT_HERE_WHY
							: ineligibleReason({
									canTransfer: input.canTransfer,
									reachable: member.reachable,
								}),
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
	/*
	 * A ROW STOOD DOWN FOR REACHABILITY IS A REASON TO OFFER THE RE-READ, and it is
	 * the row's own remedy: nothing else in this panel can tell the user whether a
	 * device that did not answer the last read is there now (UX U5).
	 */
	const unreachableRow = networks.some((network) =>
		network.members.some(
			(member) =>
				member.device_id !== selfDeviceId &&
				input.canTransfer &&
				!member.reachable,
		),
	);
	const failed = input.meshRead === "failed";

	return {
		heading: moving ? "Move this conversation to" : "Start the conversation on",
		self,
		sections,
		/*
		 * THE FOOTER NAMES THE COPY THIS PICK DELETES, from whichever end it is on: an
		 * offload deletes the copy here, a recall deletes the copy on the peer. A single
		 * sentence written from this side was wrong for every recall (design D3).
		 */
		footer:
			placement.kind === "local" ||
			placement.kind === "remote" ||
			placement.kind === "moving"
				? MOVE_FOOTER
				: placement.kind === "gone"
					? lossSentence(placement.name, "this device")
					: null,
		/*
		 * THE PAIRING LINE IS ONLY TRUE OF AN ANSWERED READ. `pending` gets neither
		 * sentence: the panel is still reading, and "this device is in no network" is
		 * the one claim a reader would act on.
		 */
		guidance:
			input.meshRead === "ok" && networks.length === 0
				? PAIRING_GUIDANCE
				: null,
		readFailure: failed ? MESH_READ_FAILURE : null,
		inFlight: input.busy
			? moveHoldSentence(placementDeviceName(placement) || "another device")
			: null,
		offerCheckAgain:
			failed || (networks.length > 0 && (!answered || unreachableRow)),
	};
}

/* --------------------------------------------------------------- the arrival */

/**
 * What to say when a transfer answers - a move OR a copy.
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
 *
 * A KEEP RECEIPT IS NOT A MOVE, AND THE NOTICE OWES IT COPY WORDS (QA Q3-1).
 * The control's confirmation offers the copy as its second option (`Copy to
 * build-box`, "the original stays where it is"), and the contract makes the
 * distinction explicit: `source_retired = (mode == "move")`, so a kept source
 * is the one thing a move receipt cannot say. Reading `sourceRetired` in the
 * recall arm alone let a keep receipt render "the copy here is deleted" - a
 * sentence true of every move and false of every copy, contradicting the dialog
 * the user pressed one step earlier. The keep arm below states the same three
 * facts the Mesh tab's own keep branch states for the same receipt
 * (`mesh-page.tsx`: "Copied" / "<dest> holds a copy as <id-tail>; the original
 * is still here."), because two surfaces naming one operation must not disagree
 * about it.
 */
export function arrivalCopy(input: {
	engaged: boolean | null;
	name: string;
	/**
	 * The device the conversation came FROM, when the move brought it back here.
	 *
	 * NON-NULL IS THE RECALL ARM, and it is a different sentence from the pair
	 * below: a recall's destination is the machine the user is looking at, so
	 * "nothing is running THERE yet, open it ON THAT DEVICE" is an instruction about
	 * their own desk, and "the copy here is deleted" is the opposite of what
	 * happened - the copy here is the one that just came back (UX U2, QA Q-1).
	 */
	from: string | null;
	/** The receipt's `new_session_id` - the id the copy was minted under. */
	newSessionId: string;
	/** Whether the receipt said the source copy was retired. */
	sourceRetired: boolean;
}): {
	verb: string;
	detail: string;
	/** Non-null only for the cold arrival; the surface must render it when set. */
	second: string | null;
} {
	const { engaged, name, from, newSessionId, sourceRetired } = input;
	if (from !== null) {
		return {
			verb: "Moved back to this device",
			detail: sourceRetired
				? `the conversation is here now; the copy on ${from} was deleted`
				: "the conversation is here now",
			/*
			 * NO SECOND LINE, and it is the cold arrival's own condition that says why:
			 * the mandatory line exists to stop a reader waiting for output on a machine
			 * they are not sitting at. A recall put the conversation back under their
			 * hands, where the pane they are typing in is the answer to it.
			 */
			second: null,
		};
	}
	if (!sourceRetired) {
		return {
			verb: `Copied to ${name}`,
			detail: `${name} holds a copy as ${newSessionId.slice(-6)}; the original is still here`,
			/*
			 * THE COLD LINE ADAPTS, and "in the copy" is not decoration: the move arm's
			 * "start it there" reads back to its nearest noun, which in this arm is "the
			 * original" - an offer to start, on a machine it never left, the conversation
			 * the user is looking at. The copy is what starts there, and the dialog's own
			 * sentence ("The copy can be erased again from the session list",
			 * mesh-actions.tsx) is where a reader meets it again.
			 */
			second:
				engaged === true
					? null
					: `Nothing is running on ${name} yet. Send a message in the copy to start it there, or open it from the session list.`,
		};
	}
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

/* ------------------------------------------------------- the one decision */

/**
 * The pair a destructive pick is confirmed with: the move, and the copy.
 *
 * WHY THE PICK DOES NOT FIRE FROM THE ROW ANY MORE (agent review R1-3, QA Q-6).
 * A pick on a live conversation DELETES the local copy (`keep: false`), and the
 * Mesh tab's own dialog is documented as *the* confirmation for exactly that -
 * "THE DIALOG IS THE CONFIRMATION for every destructive move ... The alternative
 * is always present, because the decision is the user's" (`mesh-actions.tsx`).
 * The picker used to fire the mutation straight from `onSelect`, so one press
 * deleted a copy with nothing asked and no path to `keep` from this control at
 * all. It now hands the same dialog the same pair, and the VERBS ARE THE MESH
 * TAB'S OWN STRINGS (`mesh-drop.ts`), because two surfaces that name one
 * operation differently teach a user two operations.
 *
 * `waitS: 0` IS THE SHIPPED ASK, and it stays: the design's refusal path is the
 * `busy` refusal, whose remedy re-issues THIS plan with the route's own ceiling
 * (see `chat-device-notice.tsx`).
 *
 * THE PLAN'S `to` IS THE WIRE ADDRESS, SO IT IS THE DEVICE ID, and the NAME is
 * what the verbs say (agent review R2-2 / QA Q2-1: this function used to take one
 * string for both, so a live pick sent `to: "build-box"` and the pane could not
 * resolve the device it had just addressed - `findRow` is keyed by `device_id` -
 * which is what made the in-flight chip read "Moving to this device" and the
 * `gone` surface unreachable). One argument carrying two meanings is the defect;
 * the two fields below are the fix, and every consumer reads the one it needs.
 */
export function movePair(input: {
	sessionId: string;
	/** True when the pick brings the conversation back to this device. */
	recall: boolean;
	/** The destination: the ID the route addresses, the NAME the verbs say. */
	destination: { deviceId: string; name: string };
	/** Where the conversation is now, when that is a device other than this one. */
	source: string | null;
}): { plan: MovePlan; alternatives: MovePlan[] } {
	const common = { sessionId: input.sessionId, waitS: 0 };
	const destination = input.destination.name;
	/*
	 * THE COPY AN OFFLOAD DELETES IS THE ONE ON THIS DEVICE, and `source` is not
	 * that end: it names where the conversation RUNS when that is elsewhere, which
	 * after a `keep: true` arrival is a device that keeps its own copy while the one
	 * here is the copy that travels (agent review R2-1's first option would have
	 * named the running end here and been false in exactly that state). The one
	 * placement where this device has no copy to hand over is `gone`, and its rows
	 * for a third device are `ineligible` in `devicePickerModel` rather than
	 * composed here - so no reachable pick reaches this arm with a different end.
	 */
	const handedOver = "this device";
	if (input.recall) {
		return {
			plan: {
				...common,
				to: "local",
				keep: false,
				verb: "Recall to this device",
				lost: lossSentence(input.source ?? "the other device", "this device"),
			},
			alternatives: [
				{
					...common,
					to: "local",
					keep: true,
					verb: "Copy here, leave it there",
					lost: null,
				},
			],
		};
	}
	return {
		plan: {
			...common,
			to: input.destination.deviceId,
			keep: false,
			verb: `Move to ${destination}`,
			lost: lossSentence(handedOver, destination),
		},
		alternatives: [
			{
				...common,
				to: input.destination.deviceId,
				keep: true,
				verb: `Copy to ${destination}`,
				lost: null,
			},
		],
	};
}

/* ----------------------------------- this device's own conversations, counted */

/**
 * The self row's count: THIS device's own conversations.
 *
 * WHY ONE FUNCTION FOR ONE `reduce`. The ambient federated read lands other
 * devices' rows in the SAME canonical store (the shared convention), and a
 * plain catalogue page's rows carry no `locality` at all - so the test is "not
 * remote", not "local", and the naive `sessions.length` would credit this
 * device with another one's conversations. The rule was inline in the slot's
 * selector, where no test could reach it (agent review round 1, N1); extracted
 * so the reading is a value with its own test, like every other claim in this
 * module.
 */
export function localConversationCount(
	rows: readonly { locality?: unknown }[],
): number {
	let count = 0;
	for (const row of rows) if (row.locality !== "remote") count += 1;
	return count;
}
