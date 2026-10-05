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
 *
 * THE ONE ANCHOR READ, and why it is here rather than in a DOM suite: round 2's
 * blocker was not a wrong value in this module but a wrong value HANDED to it - the
 * header composed the plan from the row's display name, so `plan.to` (the address,
 * the thing `findRow` resolves and the route parses) was a name. The model's
 * contract cannot catch that: `movePair` is correct for whatever destination the
 * caller states, and naming a name is the caller's mistake. So the call site is read
 * as source, following `chat-sidebar-archive.test.mjs`'s trade - a rename inside the
 * slice keeps this file red, and that is the point.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/** Comments stripped, so a rule can never be satisfied by prose about the rule. */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

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
	NOT_HERE_WHY,
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

test("the plan's destination is the row's device ID, and the address is what gets sent", () => {
	/*
	 * QA round 2's blocker, pinned where it happened: the pick composes the plan from
	 * `row.name`, so a live pick to build-box carried `to: "build-box"` - while the
	 * model is keyed by `device_id`, the create carries an id, and the receipt echoes
	 * what was sent. The daemon's destination is a device id; a display name is not an
	 * address, and the app cannot resolve one it invented.
	 */
	const header = code(
		"src/renderer/src/features/chat/device/chat-header-device.tsx",
	);
	const pick = header.slice(
		header.indexOf("const pair = movePair({"),
		header.indexOf("setAsk({"),
	);
	assert.match(
		pick,
		/destination:\s*\{\s*deviceId:\s*row\.deviceId,\s*name:\s*row\.name\s*\}/,
		"the plan must be addressed by the row's device id and named by its name",
	);
	/*
	 * AND WHAT THE CONFIRMATION HANDS BACK IS THE ADDRESS: `plan.to` is the id the
	 * transfer carries (or `local`, the route's own word for a recall) - never the
	 * verb's name, which is the shape that produced the un-resolvable destination.
	 */
	const choose = header.slice(
		header.indexOf("onChoose={(plan) => {"),
		header.indexOf("</>", header.indexOf("onChoose={(plan) => {")),
	);
	assert.match(
		choose,
		/onPick\(plan\.to === "local" \? null : plan\.to, plan\.keep\)/,
	);
	/*
	 * AND THE RECEIVER RESOLVES BY THE SAME KEY: the slot looks the id up in a model
	 * keyed by `device_id`, and puts that same value on the wire. `findRow(model, name)`
	 * finding nothing is what painted "Moving to this device" for a move to build-box.
	 */
	const slot = code(
		"src/renderer/src/features/chat/device/chat-device-slot.tsx",
	);
	assert.match(
		slot,
		/const row = deviceId \? findRow\(model, deviceId\) : null;/,
		"the row is resolved by the id the model is keyed by",
	);
	assert.match(slot, /const name = row \? row\.name : "this device";/);
	assert.match(slot, /const to = deviceId \?\? "local";/);
	/* The address on the wire is that same value, and the draft keeps the id, not the name. */
	assert.match(slot, /\{ sessionId, to, keep \}/);
	assert.match(slot, /setDraftPeer\(draftKey, row \? row\.deviceId : null\)/);
});

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
			host: null,
			reachableFor: () => true,
		}),
		{ kind: "draft", deviceId: null, name: "" },
	);

	const moving = panePlacement({
		draft: null,
		move: { kind: "moving", deviceId: BUILD, name: "build-box" },
		host: null,
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
		host: null,
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
		host: null,
		reachableFor: () => true,
	});
	assert.equal(copied.kind, "remote");

	// Nothing known: this device's conversation, which is what a pane with a live
	// session and no move outcome IS.
	assert.deepEqual(
		panePlacement({
			draft: null,
			host: null,
			move: undefined,
			reachableFor: () => true,
		}),
		{ kind: "local" },
	);
});

test("a conversation born on a peer keeps that device once the draft is gone, and a move outranks the row", () => {
	/*
	 * THE OPERATOR'S REPORT, pinned as a value (2026-09-30): "he selected the
	 * remote device in the new-chat window ... on hitting enter, the device
	 * selection reverted to local". The mechanism was the draft's retirement:
	 * `finishDraft` deletes the row the destination lived on, so the pane's
	 * remaining facts were its own move state - and the chip fell through to
	 * `local` over a conversation a peer had just minted. The `host` arm is the
	 * ROW's own answer, read from `locality: "remote"` + `owner_device` (the
	 * fields `createSession` stamps when the create named a peer).
	 */
	const born = panePlacement({
		draft: null,
		move: undefined,
		host: { deviceId: BUILD, name: "build-box" },
		reachableFor: () => true,
	});
	assert.deepEqual(born, {
		kind: "remote",
		deviceId: BUILD,
		name: "build-box",
		reachable: true,
		reason: "",
	});
	// The chip's own words: `On`, not `New` - the conversation exists now.
	assert.equal(placementLabel(born), "On build-box");

	/*
	 * REACHABILITY IS THE MOVE ARMS' OWN TRI-STATE, which is the "never claim
	 * remote when the row says otherwise" half: a read nobody made draws no dot,
	 * and a device that did not answer says so.
	 */
	assert.equal(
		panePlacement({
			draft: null,
			move: undefined,
			host: { deviceId: BUILD, name: "build-box" },
			reachableFor: () => null,
		}).reachable,
		null,
	);
	assert.equal(
		panePlacement({
			draft: null,
			move: undefined,
			host: { deviceId: BUILD, name: "build-box" },
			reachableFor: () => false,
		}).reachable,
		false,
	);

	/*
	 * A MOVE THIS PANE ISSUED STILL WINS over the row: the receipt is what may
	 * move a chip, and a recall that lands home reads local even while the row
	 * still carries the remote mark a later listing settles.
	 */
	const recalled = panePlacement({
		draft: null,
		host: { deviceId: BUILD, name: "build-box" },
		move: {
			kind: "moved",
			deviceId: "local",
			name: "this device",
			from: BUILD,
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
	assert.equal(
		panePlacement({
			draft: null,
			host: { deviceId: BUILD, name: "build-box" },
			move: { kind: "moving", deviceId: BUILD, name: "build-box" },
			reachableFor: () => true,
		}).kind,
		"moving",
	);

	/*
	 * AND THE SEAM THAT FEEDS IT IS A SOURCE FACT THIS FILE CAN SEE. The model is
	 * correct for whatever `host` it is handed; the store half (a create naming a
	 * peer stamps the row) and the slot half (only `locality: "remote"` becomes a
	 * host) are call-site facts, so they are read as source - the trade this
	 * file's own header states for the pick's address (review round 2's blocker).
	 */
	const slot = code(
		"src/renderer/src/features/chat/device/chat-device-slot.tsx",
	);
	assert.match(
		slot,
		/if \(!row \|\| row\.locality !== "remote"\) return null;/,
		"a host exists only where the row itself says remote",
	);
	assert.match(
		slot,
		/\bhost,\s*\n\s*move,/,
		"the slot hands the host to panePlacement",
	);
	const store = code(
		"src/renderer/src/shared/store/canonical-sessions-store.ts",
	);
	assert.match(
		store,
		/settlePlacement\(result\.session_id, \{\s*locality: "remote",\s*owner_device: peer,/,
		"a create that named a peer stamps the peer on the row, through the one placement writer",
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
		host: null,
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
		newSessionId: "session-1",
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
			newSessionId: "session-1",
			sourceRetired: true,
		}).second,
		cold.second,
	);

	const live = arrivalCopy({
		engaged: true,
		name: "build-box",
		from: null,
		newSessionId: "session-1",
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
		host: null,
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
			newSessionId: "session-1",
			sourceRetired: false,
		}).detail,
		"the conversation is here now",
	);
});

test("a copy's arrival says the original stays, in the mesh tab's own words (QA Q3-1)", () => {
	/*
	 * THE DEFECT THIS ARM EXISTS FOR (QA round 3, Q3-1). The picker's dialog offers
	 * `Copy to build-box` as its second option, and a `keep: true` receipt answers
	 * with `source_retired: false`; the arrival notice read `sourceRetired` in the
	 * recall arm alone, so a copy rendered in move vocabulary and told the user "the
	 * copy here is deleted" - the opposite of the dialog they had just confirmed.
	 * The facts asserted here are the ones the Mesh tab states for the same receipt
	 * (`mesh-page.tsx`'s keep branch): the copy, its id's tail, and the original
	 * staying.
	 */
	const coldCopy = arrivalCopy({
		engaged: null,
		name: "build-box",
		from: null,
		newSessionId: "c7ecaf735812f1",
		sourceRetired: false,
	});
	assert.equal(coldCopy.verb, "Copied to build-box");
	assert.equal(
		coldCopy.detail,
		"build-box holds a copy as 5812f1; the original is still here",
	);
	assert.equal(
		coldCopy.detail.includes("deleted"),
		false,
		"a keep receipt's arrival must never claim a deletion - that was Q3-1",
	);
	assert.equal(
		coldCopy.second,
		"Nothing is running on build-box yet. Send a message in the copy to start it there, or open it from the session list.",
	);
	// An engaged destination is running the copy, so the cold line is not owed.
	assert.equal(
		arrivalCopy({
			engaged: true,
			name: "build-box",
			from: null,
			newSessionId: "c7ecaf735812f1",
			sourceRetired: false,
		}).second,
		null,
	);
	// A recall that kept the far copy is untouched by this arm: it never came from
	// a peer direction, and its own test above pins its sentence.
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
	/*
	 * AN UNANSWERED HOLDER IS SAID IN THE SENTENCE, NOT ONLY IN THE DOT (agent review
	 * round 2, R2-4). `dotTone` painted `warning` for the same fact while `StateDot` is
	 * `aria-hidden`, so the state where "the destination stopped answering" matters most
	 * was available only to sighted readers - and the `remote` arm already spells it out.
	 * The clause is `reachable === false` alone: `null` is "nobody asked", and a read
	 * that did not answer gets no invented reason.
	 */
	assert.equal(
		placementSentence({
			kind: "gone",
			deviceId: BUILD,
			name: "build-box",
			reachable: false,
		}),
		"This conversation moved to build-box, which did not answer the last read. The copy that was here was deleted. Click to bring it back here.",
	);
	const unanswered = placementSentence({
		kind: "gone",
		deviceId: BUILD,
		name: "build-box",
		reachable: null,
	});
	assert.equal(
		unanswered,
		"This conversation moved to build-box. The copy that was here was deleted. Click to bring it back here.",
	);
	assert.equal(unanswered.includes("did not answer"), false);
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

test("a pane that no longer holds the conversation offers the recall and nothing else", () => {
	/*
	 * Agent review round 2, R2-1, driven as the reviewer drove it: with a THIRD device
	 * that is reachable and capable - the only kind that could stand as a candidate - a
	 * `gone` pane offered it, and the confirmation that press opened read "The copy on
	 * this device is deleted once attic-nuc has it" while the tombstone two lines above
	 * said the copy that was here was already deleted. The copy arithmetic is not the
	 * bug to fix (an offload deletes the copy on this device, in every state where one
	 * exists); the OFFER is, because this device cannot order two peers to swap a
	 * conversation - `mesh-drop.ts` refuses that move as `third_device` and names the
	 * remedy, which is the reason line below.
	 */
	const THIRD = "d_third";
	const withThird = [
		{
			...NETWORKS[0],
			members: [
				...NETWORKS[0].members,
				member({ device_id: THIRD, name: "attic-nuc", role: "drive" }),
			],
		},
		NETWORKS[1],
	];
	const model = picker({
		networks: withThird,
		placement: {
			kind: "gone",
			deviceId: BUILD,
			name: "build-box",
			reachable: true,
		},
	});
	// The device itself is fine - reachable, capable, in a network this device can read -
	// so the row states the DIRECTION, not a fault, and it stays visible and explained.
	assert.equal(rowFor(model, THIRD).state, "ineligible");
	assert.equal(rowFor(model, THIRD).why, NOT_HERE_WHY);
	// The two picks that do exist are unchanged: the holder is current, and this device's
	// own row is the recall.
	assert.equal(rowFor(model, BUILD).state, "current");
	assert.equal(model.self.state, "candidate");
	/*
	 * AND THE PINNED LINE NOW MATCHES THE ONLY PICK: it is composed for the recall
	 * because the recall is what a `gone` panel can send. `movePair` still carries the
	 * offload arm for the states that hold a copy (a `remote` pane keeps its own, which
	 * is why the arm's `lost` names THIS device rather than the device the conversation
	 * runs on - the reviewer's first option would have named the running end and been
	 * false in exactly that state).
	 */
	assert.equal(
		model.footer,
		"The copy on build-box is deleted once this device has it.",
	);
	const offload = movePair({
		sessionId: "s",
		recall: false,
		destination: { deviceId: THIRD, name: "attic-nuc" },
		source: "build-box",
	});
	assert.equal(
		offload.plan.lost,
		"The copy on this device is deleted once attic-nuc has it.",
	);
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
		/*
		 * THE DESTINATION IS TWO FACTS (QA round 2, Q2-1). `to` is the ADDRESS the route
		 * resolves and the key `devicePickerModel`'s rows are indexed by; the verbs say
		 * the display name. One argument carrying both meanings is what put
		 * `to: "build-box"` on the wire while the app looked the destination up by
		 * `device_id`, so the pane could not resolve the device it had just addressed -
		 * the in-flight chip read "Moving to this device" and the `gone` surface became
		 * unreachable. The fixture ids below are deliberately unlike their names, so a
		 * regression that swaps them fails here rather than looking right.
		 */
		destination: { deviceId: BUILD, name: "build-box" },
		source: null,
	});
	assert.equal(offload.plan.to, BUILD);
	assert.equal(offload.plan.keep, false);
	assert.equal(offload.plan.verb, "Move to build-box");
	assert.equal(
		offload.plan.lost,
		"The copy on this device is deleted once build-box has it.",
	);
	assert.equal(offload.alternatives.length, 1);
	assert.equal(offload.alternatives[0].to, BUILD);
	assert.equal(offload.alternatives[0].keep, true);
	assert.equal(offload.alternatives[0].verb, "Copy to build-box");
	assert.equal(offload.alternatives[0].lost, null);

	const recall = movePair({
		sessionId: "s",
		recall: true,
		destination: { deviceId: "local", name: "this device" },
		source: "build-box",
	});
	assert.equal(recall.plan.to, "local");
	assert.equal(recall.plan.keep, false);
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
