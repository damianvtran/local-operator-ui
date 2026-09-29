/**
 * The device control as VALUES: what each placement says, what the picker offers,
 * and which arrival sentence a receipt supports.
 *
 * WHY THIS FILE EXISTS. Almost every rule in this feature is a CLAIM rather than a
 * layout: `New on X` versus `On X` (a thing that will exist versus one that does),
 * which rows a move may offer, why a row may not be picked, and whether a move that
 * landed is running anywhere. A JSX edit can break any of them while every frame
 * still "looks fine" - a draft chip reading `On this device` photographs perfectly -
 * so the rules live as pure functions (`chat-device-model.ts`) and are pinned here
 * without a DOM.
 *
 * WHAT THIS CANNOT SAY, and what answers it instead: that the chip sits in the title
 * block without moving the cluster, that the picker paints, that the ineligible row
 * is legible, and that a press opens the menu. Those are the rendered set's
 * (`docs/evidence/chat-device/`, captured by `scripts/capture-evidence.mjs`, whose
 * picker rows claim the panel is present) and the QA pass's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/device/chat-device-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	arrivalCopy,
	devicePickerModel,
	MESH_READ_FAILURE,
	movePair,
	panePlacement,
	placementLabel,
	placementSentence,
	PAIRING_GUIDANCE,
	MOVE_FOOTER,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SELF = "d_self";
const BUILD = "d_build";
const PIXEL = "d_pixel";
const GRADIENT = "d_gradient";

const member = (over) => ({
	device_id: SELF,
	name: "damian-mbp",
	role: "admin",
	capabilities: ["list", "view", "prompt", "move"],
	active: true,
	suspect: false,
	endpoints: [],
	last_seen_at: 1,
	reachable: true,
	reason: "",
	...over,
});

const NETWORKS = [
	{
		network_id: "n_home",
		name: "home",
		epoch: 7,
		trust: "operator",
		members: [
			member({}),
			member({ device_id: BUILD, name: "build-box", role: "drive" }),
			member({
				device_id: PIXEL,
				name: "pixel-8",
				role: "read",
				capabilities: ["list", "view"],
			}),
		],
	},
	{
		network_id: "n_lan",
		name: "studio-lan",
		epoch: 2,
		trust: "operator",
		members: [
			member({}),
			member({
				device_id: GRADIENT,
				name: "gradient-m-4h",
				role: "drive",
				reachable: false,
				reason: "no answer from this device on the last read",
			}),
		],
	},
];

const PEERS = [
	{
		device_id: BUILD,
		name: "build-box",
		reachable: true,
		unreachable_reason: "",
		last_seen_at: 1,
		session_count: 3,
		rtt_ms: null,
	},
	{
		device_id: PIXEL,
		name: "pixel-8",
		reachable: true,
		unreachable_reason: "",
		last_seen_at: 1,
		session_count: 1,
		rtt_ms: null,
	},
	{
		device_id: GRADIENT,
		name: "gradient-m-4h",
		reachable: false,
		unreachable_reason: "no answer from this device on the last read",
		last_seen_at: 1,
		session_count: 2,
		rtt_ms: null,
	},
];

const picker = (over = {}) =>
	devicePickerModel({
		placement: { kind: "local" },
		selfDeviceId: SELF,
		selfName: "damian-mbp",
		selfConversations: 12,
		networks: NETWORKS,
		peers: PEERS,
		canTransfer: true,
		/*
		 * WHAT THE READS ANSWERED IS AN INPUT, not an absence: `ok` here is the same
		 * tree a live window reads, and the two other values below have their own tests
		 * because an unanswered read used to be published as "this device is in no
		 * network" (QA Q-4).
		 */
		meshRead: "ok",
		busy: false,
		...over,
	});

const rowFor = (model, deviceId) => {
	const rows = model.sections.flatMap((section) => section.rows);
	return rows.find((row) => row.deviceId === deviceId);
};

test("the tense word is the whole design: a draft says New, a live session does not", () => {
	assert.equal(
		placementLabel({ kind: "draft", deviceId: null, name: "" }),
		"New on this device",
	);
	assert.equal(
		placementLabel({ kind: "draft", deviceId: BUILD, name: "build-box" }),
		"New on build-box",
	);
	assert.equal(placementLabel({ kind: "local" }), "On this device");
	assert.equal(
		placementLabel({
			kind: "remote",
			deviceId: BUILD,
			name: "build-box",
			reachable: true,
			reason: "",
		}),
		"On build-box",
	);
	assert.equal(
		placementLabel({
			kind: "gone",
			deviceId: BUILD,
			name: "build-box",
			reachable: true,
		}),
		"On build-box",
	);
	assert.equal(
		placementLabel({ kind: "moving", deviceId: BUILD, name: "build-box" }),
		"Moving to build-box",
	);
});

test("the accessible name carries the tense, the affordance and the reason the label cannot", () => {
	assert.equal(
		placementSentence({ kind: "draft", deviceId: null, name: "" }),
		"New conversations are created on this device. Click to choose a different device.",
	);
	assert.match(
		placementSentence({ kind: "draft", deviceId: BUILD, name: "build-box" }),
		/^New conversations are created on build-box\./,
	);
	assert.equal(
		placementSentence({ kind: "local" }),
		"This conversation runs on this device. Click to move it to another device or recall it later.",
	);
	assert.match(
		placementSentence({
			kind: "remote",
			deviceId: BUILD,
			name: "build-box",
			reachable: true,
			reason: "",
		}),
		/recall it here or move it on/,
	);
	assert.match(
		placementSentence({
			kind: "remote",
			deviceId: GRADIENT,
			name: "gradient-m-4h",
			reachable: false,
			reason: "no answer from this device on the last read",
		}),
		/did not answer the last read \(no answer from this device on the last read\)/,
	);
});

test("a draft never consults the session's state, and a move this pane issued wins", () => {
	// A draft: the destination is the app's own, so nothing else can move the chip.
	assert.deepEqual(
		panePlacement({
			draft: { deviceId: null, name: "" },
			move: undefined,
			reachableFor: () => true,
		}),
		{ kind: "draft", deviceId: null, name: "" },
	);

	const moving = panePlacement({
		draft: null,
		move: { kind: "moving", deviceId: BUILD, name: "build-box" },
		reachableFor: () => true,
	});
	assert.equal(moving.kind, "moving");

	// A move that RETIRED the source leaves nothing here to be "this device".
	const gone = panePlacement({
		draft: null,
		move: {
			kind: "moved",
			deviceId: BUILD,
			name: "build-box",
			engaged: null,
			receipt: {
				locality: "remote",
				owner_device: BUILD,
				source_retired: true,
				session_id: "s",
				new_session_id: "s",
				mode: "move",
				phases: [],
			},
		},
		reachableFor: () => true,
	});
	assert.equal(gone.kind, "gone");

	// A `keep` COPY leaves this device's own conversation running where it is, and the
	// chip names the device that now holds a second copy: only a MOVE retires the
	// source, which is why `source_retired` is what separates the two arms.
	const copied = panePlacement({
		draft: null,
		move: {
			kind: "moved",
			deviceId: BUILD,
			name: "build-box",
			engaged: null,
			receipt: {
				locality: "remote",
				owner_device: BUILD,
				source_retired: false,
				session_id: "s",
				new_session_id: "s2",
				mode: "keep",
				phases: [],
			},
		},
		reachableFor: () => true,
	});
	assert.equal(copied.kind, "remote");

	// Nothing known: this device's conversation, which is what a pane with a live
	// session and no move outcome IS.
	assert.deepEqual(
		panePlacement({ draft: null, move: undefined, reachableFor: () => true }),
		{ kind: "local" },
	);
});

test("a reachability with no read behind it draws no dot, so it is neither true nor false", () => {
	const placement = panePlacement({
		draft: null,
		move: {
			kind: "moved",
			deviceId: BUILD,
			name: "build-box",
			engaged: null,
			receipt: {
				locality: "remote",
				owner_device: BUILD,
				source_retired: false,
				session_id: "s",
				new_session_id: "s",
				mode: "move",
				phases: [],
			},
		},
		reachableFor: () => null,
	});
	assert.equal(placement.kind, "remote");
	assert.equal(placement.reachable, null);
});

test("the picker offers this device first, then one section per network by name", () => {
	const model = picker();
	assert.equal(model.heading, "Move this conversation to");
	assert.equal(model.self.deviceId, SELF);
	assert.equal(model.self.state, "current");
	assert.deepEqual(
		model.sections.map((section) => [section.name, section.count]),
		[
			["home", 2],
			["studio-lan", 1],
		],
	);
	// This device is never a row inside its own network's section.
	assert.equal(
		model.sections.every((section) =>
			section.rows.every((row) => row.deviceId !== SELF),
		),
		true,
	);
	// The facts are the wire's: the role and the peer's own count.
	assert.deepEqual(rowFor(model, BUILD).facts, ["drive", "3 conversations"]);
	assert.equal(rowFor(model, PIXEL).facts.includes("1 conversation"), true);
});

test("a new chat is a free and reversible choice: no fixed consequence, and nobody is ineligible yet", () => {
	const model = picker({
		placement: { kind: "draft", deviceId: null, name: "" },
	});
	assert.equal(model.heading, "Start the conversation on");
	assert.equal(model.footer, null);
	assert.equal(model.self.state, "current");
	for (const row of model.sections.flatMap((section) => section.rows)) {
		assert.equal(
			row.state,
			"candidate",
			`${row.name} must be a candidate in a new chat`,
		);
		assert.equal(row.why, undefined);
	}
	// The unreachable word rides the FACT line here, because no reason line will.
	assert.equal(rowFor(model, GRADIENT).facts.includes("unreachable"), true);
});

test("a move narrows eligibility, and the ineligible row stays readable and explained", () => {
	const model = picker();
	const pixel = rowFor(model, PIXEL);
	assert.equal(pixel.state, "ineligible");
	assert.equal(pixel.why, "cannot receive a move");
	const gradient = rowFor(model, GRADIENT);
	assert.equal(gradient.state, "ineligible");
	assert.equal(gradient.why, "did not answer the last read");
	// The reason carries reachability, so the fact line does not say it twice.
	assert.equal(gradient.facts.includes("unreachable"), false);
	// The consequence is pinned, and it is the default move's own.
	assert.equal(model.footer, MOVE_FOOTER);
	assert.match(model.footer, /copy on this device is deleted/);
});

test("a backend that cannot move keeps the fact and loses every offer, with its own reason", () => {
	const model = picker({ canTransfer: false });
	for (const row of model.sections.flatMap((section) => section.rows)) {
		assert.equal(row.state, "ineligible");
		assert.equal(row.why, "this backend cannot move a conversation yet");
	}
});

test("a device in no network is told the command that exists, not a button that does not", () => {
	const model = picker({ networks: [], peers: [] });
	assert.equal(model.sections.length, 0);
	assert.equal(model.guidance, PAIRING_GUIDANCE);
	assert.match(model.guidance, /lop network join/);
	// This device is still the one row, and still says which device it is.
	assert.equal(model.self.facts.includes("this device"), true);
	assert.equal(model.offerCheckAgain, false);
});

test("membership with nothing answering offers the one remedy a read can settle", () => {
	const silent = NETWORKS.map((network) => ({
		...network,
		members: network.members.map((entry) => ({ ...entry, reachable: false })),
	}));
	const model = picker({ networks: silent });
	assert.equal(model.offerCheckAgain, true);
	// The rows and their reasons are still there: a silent network does not empty
	// the list, it explains it.
	assert.equal(model.sections.flatMap((section) => section.rows).length, 3);

	const answered = picker();
	/*
	 * AND THE OFFER IS NOT ONLY FOR THE SILENT-NETWORK CASE (UX U5). The default
	 * fixture holds one unreachable device among reachable ones, which used to be the
	 * state where the panel explained a device and then left the user with nothing to
	 * do about it: a re-read is the one action the app has, so it is offered wherever
	 * a reachability fact is what stands a row down. Nothing else about the panel
	 * changes - the rows, their reasons and the consequence line stay.
	 */
	assert.equal(answered.offerCheckAgain, true);

	// Every device answering: there is no reachability fact left to settle.
	const allAnswering = NETWORKS.map((network) => ({
		...network,
		members: network.members.map((entry) => ({ ...entry, reachable: true })),
	}));
	assert.equal(picker({ networks: allAnswering }).offerCheckAgain, false);
});

test("two arrival sentences, and the cold one's second line is mandatory", () => {
	const cold = arrivalCopy({
		engaged: null,
		name: "build-box",
		from: null,
		sourceRetired: true,
	});
	assert.equal(cold.verb, "Moved to build-box");
	assert.equal(
		cold.detail,
		"the conversation is there; the copy here is deleted",
	);
	assert.equal(
		cold.second,
		"Nothing is running on build-box yet. Send a message to start it there, or open the conversation on that device.",
	);

	// `false` is a wire that said "not engaged", and it is the same sentence as
	// "nobody said": both mean nothing is running there yet.
	assert.equal(
		arrivalCopy({
			engaged: false,
			name: "build-box",
			from: null,
			sourceRetired: true,
		}).second,
		cold.second,
	);

	const live = arrivalCopy({
		engaged: true,
		name: "build-box",
		from: null,
		sourceRetired: true,
	});
	assert.equal(live.verb, "Moved to build-box");
	assert.equal(
		live.detail,
		"the conversation is running there now; the copy here is deleted",
	);
	assert.equal(live.second, null);
});

test("a recall lands the pane back on this device, and never in the peer arm", () => {
	/*
	 * THE ONE CLAIM THE CONTROL EXISTS TO MAKE, on a first-class designed action
	 * (agent review R1-1, QA Q-1, UX U3, design D1). A recall's receipt says
	 * `locality: "local"` and `source_retired: true` - and keying on `source_retired`
	 * alone put THIS DEVICE in the `remote` arm under the literal device id `local`,
	 * where its accessible name claimed a failed read about the machine the user is
	 * sitting at and the picker re-offered a move that had already happened.
	 */
	const recalled = panePlacement({
		draft: null,
		move: {
			kind: "moved",
			deviceId: "local",
			name: "this device",
			from: "build-box",
			engaged: null,
			receipt: {
				locality: "local",
				owner_device: "local",
				source_retired: true,
				session_id: "s",
				new_session_id: "s",
				mode: "move",
				phases: [],
			},
		},
		reachableFor: () => null,
	});
	assert.deepEqual(recalled, { kind: "local" });
	// The chip's own words, and the whole of what a sighted reader sees.
	assert.equal(placementLabel(recalled), "On this device");
	assert.equal(
		placementSentence(recalled),
		"This conversation runs on this device. Click to move it to another device or recall it later.",
	);
});

test("a recall's arrival says it came home, not that a copy here was deleted", () => {
	// UX U2: the arrival pair is composed for a move AWAY, and reusing it for a
	// recall told the user the copy they had just brought back was deleted, on the
	// machine they were looking at.
	const recalled = arrivalCopy({
		engaged: null,
		name: "this device",
		from: "build-box",
		sourceRetired: true,
	});
	assert.equal(recalled.verb, "Moved back to this device");
	assert.equal(
		recalled.detail,
		"the conversation is here now; the copy on build-box was deleted",
	);
	// No second line: it exists to stop a reader waiting for output on a machine
	// they are not sitting at, and a recall put the conversation under their hands.
	assert.equal(recalled.second, null);
	// And with no retirement there is no deletion to report.
	assert.equal(
		arrivalCopy({
			engaged: null,
			name: "this device",
			from: "build-box",
			sourceRetired: false,
		}).detail,
		"the conversation is here now",
	);
});

test("the sentence never invents a failed read, and never renders empty brackets", () => {
	// Agent review R1-2: `reachable: null` is the tri-state's "nobody asked yet",
	// and the falsy arm announced it as a failure with an empty parenthetical.
	const unasked = placementSentence({
		kind: "remote",
		deviceId: BUILD,
		name: "build-box",
		reachable: null,
		reason: "",
	});
	assert.equal(
		unasked,
		"This conversation runs on build-box. Click to recall it here or move it on.",
	);
	assert.equal(unasked.includes("did not answer"), false);
	// A real refusal with no reason still says which read failed, and says it once.
	const refused = placementSentence({
		kind: "remote",
		deviceId: GRADIENT,
		name: "gradient-m-4h",
		reachable: false,
		reason: "",
	});
	assert.equal(
		refused,
		"This conversation runs on gradient-m-4h, which did not answer the last read.",
	);
	assert.equal(refused.includes("()"), false);
	assert.equal(
		placementSentence({
			kind: "remote",
			deviceId: GRADIENT,
			name: "gradient-m-4h",
			reachable: false,
			reason: "link down",
		}),
		"This conversation runs on gradient-m-4h, which did not answer the last read (link down).",
	);
});

test("the tombstone names an action the control can take, not one it cannot", () => {
	// QA Q-2 / UX U6: "Click to open it there" promised a place this app has no way
	// to open, and pressing the chip opens this picker.
	const sentence = placementSentence({
		kind: "gone",
		deviceId: BUILD,
		name: "build-box",
		reachable: true,
	});
	assert.equal(
		sentence,
		"This conversation moved to build-box. The copy that was here was deleted. Click to bring it back here.",
	);
	assert.equal(sentence.includes("open it there"), false);
});

test("a pane whose conversation moved away is a move surface, with the holder marked", () => {
	/*
	 * Design D3 and QA Q-3: `gone` was left out of the "a move is being planned"
	 * predicate, so the panel flipped to the CREATE vocabulary, lost the pinned
	 * consequence line and marked NO row ineligible - in the state where a user is
	 * most likely to act, and where the pick does delete a copy (the peer's).
	 */
	const model = picker({
		placement: {
			kind: "gone",
			deviceId: BUILD,
			name: "build-box",
			reachable: true,
		},
	});
	assert.equal(model.heading, "Move this conversation to");
	// The consequence line names the copy THIS pick deletes, which is the one on the
	// device that holds the conversation.
	assert.equal(
		model.footer,
		"The copy on build-box is deleted once this device has it.",
	);
	// This device is the recall row (a candidate), and the device that HOLDS the
	// conversation is the current one.
	assert.equal(model.self.state, "candidate");
	assert.equal(rowFor(model, BUILD).state, "current");
	// The eligibility discipline is back with it.
	assert.equal(rowFor(model, PIXEL).state, "ineligible");
	assert.equal(rowFor(model, PIXEL).why, "cannot receive a move");
	assert.equal(rowFor(model, GRADIENT).why, "did not answer the last read");
});

test("a read that did not answer is not a membership fact, and neither is one in flight", () => {
	// QA Q-4: `networks.data ?? []` reads the same for "nothing there" and "nothing
	// answered", and the second was published with a `lop network init` instruction.
	const failed = picker({
		networks: [],
		peers: [],
		selfName: "",
		meshRead: "failed",
	});
	assert.equal(failed.guidance, null);
	assert.equal(failed.readFailure, MESH_READ_FAILURE);
	assert.equal(failed.offerCheckAgain, true);
	// The self row keeps its own name in that case.
	assert.equal(failed.self.name, "This device");
	assert.deepEqual(failed.self.facts, ["12 conversations"]);

	// Nothing has answered yet: neither sentence is true yet, so neither is drawn.
	const pending = picker({ networks: [], peers: [], meshRead: "pending" });
	assert.equal(pending.guidance, null);
	assert.equal(pending.readFailure, null);
	assert.equal(pending.offerCheckAgain, false);

	// An answered empty read is the one case the pairing line IS for.
	assert.equal(picker({ networks: [], peers: [] }).guidance, PAIRING_GUIDANCE);
});

test("a move in flight stands the picker down in words", () => {
	// Agent review R1-5, QA Q-8, UX U4: mid-flight the rows stayed pickable, so a
	// second press issued a SECOND destructive move that the chip then adopted.
	const model = picker({
		placement: { kind: "moving", deviceId: BUILD, name: "build-box" },
		busy: true,
	});
	assert.equal(
		model.inFlight,
		"This conversation is moving to build-box. It continues there; nothing sent from here would be delivered.",
	);
	// The rows are still the move's own set (the painter stands them down), so the
	// heading and the consequence line do not change under the user mid-gesture.
	assert.equal(model.heading, "Move this conversation to");
	assert.equal(model.footer, MOVE_FOOTER);
	assert.equal(picker().inFlight, null);
});

test("the confirmation pair is the Mesh tab's own, in both directions", () => {
	// Agent review R1-3 / QA Q-6: the pick fired a `keep: false` transfer with no
	// confirmation and no reachable `keep`. The pair below is what the dialog now
	// shows; the verbs are `mesh-drop.ts`'s own strings, so one operation is not
	// taught under two names.
	const offload = movePair({
		sessionId: "s",
		recall: false,
		destination: "build-box",
		source: null,
	});
	assert.equal(offload.plan.keep, false);
	assert.equal(offload.plan.verb, "Move to build-box");
	assert.equal(
		offload.plan.lost,
		"The copy on this device is deleted once build-box has it.",
	);
	assert.equal(offload.alternatives.length, 1);
	assert.equal(offload.alternatives[0].keep, true);
	assert.equal(offload.alternatives[0].verb, "Copy to build-box");
	assert.equal(offload.alternatives[0].lost, null);

	const recall = movePair({
		sessionId: "s",
		recall: true,
		destination: "this device",
		source: "build-box",
	});
	assert.equal(recall.plan.to, "local");
	assert.equal(recall.plan.verb, "Recall to this device");
	assert.equal(
		recall.plan.lost,
		"The copy on build-box is deleted once this device has it.",
	);
	assert.equal(recall.alternatives[0].verb, "Copy here, leave it there");
});

test("a draft aimed at a peer marks THAT device, not this one, and warns nobody", () => {
	const model = picker({
		placement: { kind: "draft", deviceId: BUILD, name: "build-box" },
	});
	// Two current rows would leave a reader unable to tell which machine the chip
	// is naming; the pick on the self row here is a RESET, not a move.
	assert.equal(model.self.state, "candidate");
	assert.equal(rowFor(model, BUILD).state, "current");
	assert.equal(model.footer, null);
});
