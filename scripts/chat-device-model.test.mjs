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
		placementLabel({ kind: "gone", deviceId: BUILD, name: "build-box" }),
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
		"This conversation runs on this device. Click to move it to another device.",
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

	// A `keep` copy leaves this device's own conversation running: it stays local.
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
	assert.equal(answered.offerCheckAgain, false);
});

test("two arrival sentences, and the cold one's second line is mandatory", () => {
	const cold = arrivalCopy({ engaged: null, name: "build-box" });
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
		arrivalCopy({ engaged: false, name: "build-box" }).second,
		cold.second,
	);

	const live = arrivalCopy({ engaged: true, name: "build-box" });
	assert.equal(live.verb, "Moved to build-box");
	assert.equal(
		live.detail,
		"the conversation is running there now; the copy here is deleted",
	);
	assert.equal(live.second, null);
});
