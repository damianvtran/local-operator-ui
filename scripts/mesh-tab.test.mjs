#!/usr/bin/env node
/**
 * The Mesh tab's pure half, and the wiring that decides whether it mounts at all.
 *
 * WHAT THIS FILE IS FOR. A mesh tab's interesting behaviour is not "does it draw a
 * box" - a frame shows that - it is the set of claims the tab makes about a mesh
 * the reader cannot see for themselves:
 *
 *   - a device in two networks is ONE node with TWO edges (the plan's § 1), because
 *     collapsing the other way draws the same laptop twice and hides the fact the
 *     view exists to show;
 *   - a poll that changes nothing does not move a node, because the slot assignment
 *     is retained rather than re-solved;
 *   - "unreachable" and "not answered" are DIFFERENT claims, so a missing session
 *     count is never rendered as a zero;
 *   - a sparse row from the backend cannot throw, because the normaliser is the
 *     boundary and one `TypeError` above it replaces the whole window with the
 *     error boundary (the defect PR #498's round-1 review reproduced);
 *   - zooming about the pointer keeps the world point under the pointer invariant,
 *     which is the whole content of "zoom about the cursor" and is invisible to a
 *     single still.
 *
 * HOW EACH PART IS DRIVEN:
 *
 *   - the pure modules are BUNDLED and CALLED (`esbuild` in memory, the shipped TS
 *     paths, no second build) - the same shape `scripts/analytics-rate-format.test.mjs`
 *     uses. They import nothing but each other, so there is no fixture dialect here —
 *     `mesh-approvals` joins them and reaches the renderer's `@shared` seam (the
 *     query client and the desktop API), so the one bundle carries the sibling
 *     harnesses' alias, esbuild being unable to read tsconfig paths;
 *   - the structural-sharing claim uses the REAL `replaceEqualDeep` that React Query
 *     itself applies to a refetch result, rather than a re-implementation of it, so
 *     the invariant is asserted against the mechanism that actually holds it;
 *   - the WIRING invariants are properties of the shipped source rather than of a
 *     function - the route's gate, the nav row's gate, the op classification - so
 *     they are pinned by reading the files and asserting the one expression that
 *     carries each decision. Each pin says what it pins and what would have to come
 *     here instead of quietly dropping it. (No jsdom in this tree, and this change
 *     is not the place to add one - the call `scripts/move-session.test.mjs`
 *     documents.)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/mesh/mesh-types";
			export * from "./src/renderer/src/features/mesh/mesh-graph";
			export * from "./src/renderer/src/features/mesh/mesh-reach";
			export * from "./src/renderer/src/features/mesh/mesh-scope";
			export * from "./src/renderer/src/features/mesh/mesh-positions";
			export * from "./src/renderer/src/features/mesh/mesh-sessions";
			export * from "./src/renderer/src/features/mesh/mesh-drop";
			export * from "./src/renderer/src/features/mesh/mesh-drag";
			export * from "./src/renderer/src/features/mesh/mesh-approvals";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	/*
	 * THE ONE ALIAS, and it exists because `mesh-approvals` joins this bundle: it (and
	 * the mesh store it reads its key from) import the desktop API and the query client
	 * through the renderer's `@shared` alias, and esbuild cannot read tsconfig paths —
	 * the same note `scripts/aida-rail-marks.test.mjs` carries. Scoped to `@shared` so
	 * every relative specifier in this bundle keeps resolving exactly as it did.
	 */
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});

const mesh = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * A SECOND BUNDLE, FOR THE CONTRACT ITSELF. The deadline arithmetic and the endpoint
 * mapping are decisions of the shared contract rather than of the feature, and they
 * are the ones a front end can get wrong invisibly: a transfer left on the 20 s
 * control budget gives up before the route answers, and a wrong path or body key is a
 * 422 that no frame would show.
 */
const contractBundle = await build({
	stdin: {
		contents: `export * from "./src/shared/desktop-contract";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});

const contractRuntime = await import(
	`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString("base64")}`
);

const {
	peerList,
	networkTopology,
	meshGraph,
	meshSummary,
	deviceStatLine,
	meshNodeCount,
	assignSlots,
	meshGeometry,
	fitTransform,
	keepNodeVisible,
	zoomAbout,
	NODE_WIDTH,
	NODE_HEIGHT,
	NODE_BODY_HEIGHT,
	NODE_CHIP_BAND,
	DEVICE_HEIGHT,
	MIN_FIT_SCALE,
	ROW_GAP,
	PAD,
	SCOPE_OPEN_GAP,
	SCOPE_LEVEL_STEP,
	SCOPE_LEVEL_INSET,
	scopeOpenGap,
	scopeTopClearance,
	scopeStacks,
	openingLevels,
	deviceReach,
	reachWords,
	reachSentence,
	deviceActivity,
	REACH_INK,
	NOT_ATTEMPTED_SENTENCES,
	parseEndpoint,
	subnet24,
	prefixGroups,
	prefixWords,
	declaredScope,
	sessionRows,
	transferReceipt,
	meshRefusal,
	CHIP_LIMIT,
	sessionStripeKey,
	sessionsByDevice,
	ownerOf,
	deviceSessionTotal,
	resolveDrop,
	planConfirm,
	hoverSentence,
	DRAG_THRESHOLD_PX,
	IDLE_DRAG,
	dragReducer,
	draggedSessionId,
} = mesh;

/* ------------------------------------------------------------------ fixtures */

const DEVICE_A = `d_${"a".repeat(32)}`;
const DEVICE_B = `d_${"b".repeat(32)}`;
const DEVICE_C = `d_${"c".repeat(32)}`;
const DEVICE_D = `d_${"d".repeat(32)}`;
const DEVICE_E = `d_${"e".repeat(32)}`;
const NET_ONE = `n_${"1".repeat(24)}`;
const NET_TWO = `n_${"2".repeat(24)}`;

const member = (device_id, overrides = {}) => ({
	device_id,
	name: "",
	role: "drive",
	capabilities: ["sessions"],
	active: true,
	suspect: false,
	endpoints: [],
	last_seen_at: null,
	reachable: true,
	reason: "",
	// The operator's DECLARED scope, which no backend sends yet: `""` is the shipped
	// state and the `declared` tier's only input (see `mesh-scope.ts`).
	scope: "",
	...overrides,
});

const network = (network_id, members, overrides = {}) => ({
	network_id,
	name: "",
	epoch: 1,
	trust: "active",
	members,
	...overrides,
});

const peer = (device_id, overrides = {}) => ({
	device_id,
	name: "",
	reachable: true,
	unreachable_reason: "",
	last_seen_at: null,
	session_count: 0,
	rtt_ms: null,
	...overrides,
});

/**
 * THE TOPOLOGY THE PLAN MEASURES: five devices across two networks with one device
 * in both, which is the case that separates "one node, two edges" from "two nodes".
 */
const overlapping = () => ({
	topology: networkTopology({
		self_device_id: DEVICE_A,
		networks: [
			network(NET_ONE, [
				member(DEVICE_A),
				member(DEVICE_B, { name: "devon-laptop" }),
				member(DEVICE_C, {
					name: "workshop-mini",
					// The wire's own agreement: a device that is not reachable is not reachable on
					// any membership either (the relay answers both reads from one peer table).
					// The MISMATCHED pair is pinned in its own test below, where the rule - a
					// membership or a peer row can only ever CONFIRM reachability - is the
					// subject rather than an accident of a fixture.
					reachable: false,
					reason: "no route to it",
					last_seen_at: 1_700_000_000,
				}),
			]),
			network(NET_TWO, [
				member(DEVICE_A),
				member(DEVICE_B, { name: "devon-laptop" }),
			]),
		],
	}),
	peers: peerList({
		self_device_id: DEVICE_A,
		peers: [
			peer(DEVICE_B, {
				name: "devon-laptop",
				session_count: 2,
				last_seen_at: 1_700_000_060,
			}),
			peer(DEVICE_C, {
				name: "workshop-mini",
				reachable: false,
				unreachable_reason: "no route to it",
				session_count: 7,
			}),
		],
	}),
});

/* --------------------------------------------------------------- normalisers */

test("a peer row that cannot be keyed or described is dropped, not drawn", () => {
	const list = peerList({
		self_device_id: DEVICE_A,
		degraded: ["peer_sessions_unavailable"],
		peers: [
			// No id: it could not be a section key or a React key.
			peer(""),
			// No reachability answer: every reader of this field makes a claim with
			// it, and neither value means "I do not know".
			{ ...peer(DEVICE_B), reachable: undefined },
			peer(DEVICE_C, { name: "workshop-mini" }),
		],
	});
	assert.deepEqual(
		list.peers.map((row) => row.device_id),
		[DEVICE_C],
		"only the row that answers both questions survives",
	);
	assert.equal(list.self_device_id, DEVICE_A);
	assert.deepEqual(list.degraded, ["peer_sessions_unavailable"]);
});

test("the peer catalogue is deduped by device id, first answer wins", () => {
	const list = peerList({
		peers: [
			peer(DEVICE_B, { name: "devon-laptop", session_count: 2 }),
			// The relay's peer table answers per MEMBERSHIP, so a device in two
			// networks arrives twice; the catalogue is a set of devices.
			peer(DEVICE_B, {
				name: "devon-laptop",
				session_count: 9,
				reachable: false,
			}),
		],
	});
	assert.equal(list.peers.length, 1);
	assert.equal(
		list.peers[0].session_count,
		2,
		"the first entry for a device wins",
	);
});

test("a sparse topology row leaves the normaliser intact rather than throwing", () => {
	const topology = networkTopology({
		networks: [
			// No id: it cannot be a node.
			{ name: "nameless", members: [] },
			network(NET_ONE, [
				// No id: it cannot be a node either.
				{ name: "ghost" },
				// Everything else absent: every field degrades to its empty answer.
				{ device_id: DEVICE_B },
			]),
		],
	});
	assert.equal(topology.networks.length, 1);
	assert.deepEqual(
		topology.networks[0].members.map((entry) => entry.device_id),
		[DEVICE_B],
	);
	const only = topology.networks[0].members[0];
	assert.equal(only.name, "", "a missing name degrades to the empty string");
	assert.equal(
		only.active,
		true,
		"a member that does not say it was revoked IS a member",
	);
	assert.equal(only.suspect, false);
	assert.deepEqual(only.capabilities, []);
	assert.equal(only.last_seen_at, null);
	assert.equal(
		only.reachable,
		true,
		"an unanswered reachability is not a refusal",
	);
});

/* ------------------------------------------------------------------- model */

test("a device in two networks is ONE node with TWO edges", () => {
	const { topology, peers } = overlapping();
	const graph = meshGraph({ topology, peers });
	const devon = graph.devices.filter((device) => device.id === DEVICE_B);
	assert.equal(
		devon.length,
		1,
		"the same laptop is one node, not one per network",
	);
	assert.equal(
		devon[0].memberships.length,
		2,
		"and both memberships stay as facts",
	);
	assert.deepEqual(
		graph.edges
			.filter((edge) => edge.deviceId === DEVICE_B)
			.map((edge) => edge.networkId)
			.sort(),
		[NET_ONE, NET_TWO].sort(),
		"one edge per membership, keyed by network and device",
	);
	assert.equal(
		graph.edges.length,
		5,
		"five memberships across the two networks, five edges",
	);
});

test("the node count is networks plus devices, whatever the session store holds", () => {
	const { topology, peers } = overlapping();
	const graph = meshGraph({ topology, peers });
	assert.equal(graph.networks.length, 2);
	assert.equal(
		graph.devices.length,
		3,
		"three distinct devices, six memberships",
	);
	assert.equal(
		meshNodeCount(graph),
		5,
		"the DOM is bounded by networks + devices - the invariant the canvas's cost rests on",
	);
	/*
	 * The claim that matters is that the bound does NOT move with the number of
	 * conversations: the counts are attributes of a device node, never nodes.
	 */
	const heavier = meshGraph({
		topology,
		peers: peerList({
			self_device_id: DEVICE_A,
			peers: [
				peer(DEVICE_B, { name: "devon-laptop", session_count: 40 }),
				peer(DEVICE_C, { name: "workshop-mini", session_count: 400 }),
			],
		}),
	});
	assert.equal(meshNodeCount(heavier), meshNodeCount(graph));
	assert.equal(
		graph.devices.find((device) => device.id === DEVICE_B).sessionCount,
		2,
		"the count is read from the peer catalogue",
	);
});

test("a device the peer catalogue did not name has an UNKNOWN count, not zero", () => {
	const { topology } = overlapping();
	const graph = meshGraph({ topology, peers: peerList({ peers: [] }) });
	const unnamed = graph.devices.find((device) => device.id === DEVICE_C);
	assert.equal(
		unnamed.sessionCount,
		null,
		"0 would claim a device this app cannot ask holds no conversations",
	);
	assert.equal(
		graph.unmatchedPeers.length,
		0,
		"and the absence of a peer row is not a peer row that failed to join",
	);
});

test("state precedence: self, then a suspected identity, then unreachable", () => {
	const base = {
		topology: networkTopology({ networks: [] }),
		peers: peerList({}),
	};
	const stateOf = (members, selfId, peerRow) => {
		const graph = meshGraph({
			topology: networkTopology({
				self_device_id: selfId,
				networks: [network(NET_ONE, members)],
			}),
			peers: peerList(peerRow ? { peers: [peerRow] } : {}),
		});
		return graph.devices[0]?.state;
	};
	assert.equal(
		stateOf([member(DEVICE_A, { suspect: true, reachable: false })], DEVICE_A),
		"self",
		"this device outranks everything: the question its colour answers is 'which one am I'",
	);
	assert.equal(
		stateOf([member(DEVICE_B, { suspect: true, reachable: true })], DEVICE_A),
		"suspect",
		"a duplicate key is a security fact that matters whether or not it answered",
	);
	assert.equal(
		stateOf([member(DEVICE_B, { reachable: false })], DEVICE_A),
		"unreachable",
	);
	assert.equal(stateOf([member(DEVICE_B)], DEVICE_A), "reachable");
	assert.ok(base, "fixture sanity");
});

test("the peer catalogue can only ever CONFIRM reachability, never withdraw it", () => {
	const members = [member(DEVICE_B)];
	const graph = meshGraph({
		topology: networkTopology({ networks: [network(NET_ONE, members)] }),
		peers: peerList({ peers: [peer(DEVICE_B, { reachable: false })] }),
	});
	assert.equal(
		graph.devices[0].reachable,
		true,
		"the relay dials a device: one membership answering is a fact about the device",
	);
	assert.equal(
		graph.devices[0].reason,
		"",
		"a reachable device carries no reason",
	);
});

test("an unreachable device carries the backend's own reason", () => {
	const graph = meshGraph({
		topology: networkTopology({
			networks: [
				network(NET_ONE, [member(DEVICE_B, { reachable: false, reason: "" })]),
			],
		}),
		peers: peerList({
			peers: [
				peer(DEVICE_B, {
					reachable: false,
					unreachable_reason: "no route to it",
				}),
			],
		}),
	});
	const device = graph.devices[0];
	assert.equal(device.state, "unreachable");
	assert.equal(device.reason, "no route to it");
	/*
	 * THE WORD AT NODE WIDTH, THE REASON ON THE SURFACES THAT HAVE ROOM (design review
	 * round 1, D6): the pinned 200 px node printed `unreachable (no route t…`, and the
	 * parenthetical is the only thing that distinguishes one unreachable device from
	 * another - so a short form says the state and the reason lives where it fits.
	 *
	 * THE SHORT FORM IS THE REACH WORD NOW, NOT `unreachable` (mesh redesign, D2/D3). A
	 * device asked and silent is `no answer`; a device nobody dialled is `not asked`; and
	 * the wire cannot tell the two apart without the sentences pinned below. This line is
	 * the one place the OLD word survives in the test, as the failure it used to be.
	 */
	assert.equal(deviceReach(device), "unanswered");
	assert.equal(deviceStatLine(device, 1_700_000_100), "no answer");
	assert.equal(reachWords(deviceReach(device)), "no answer");
	assert.equal(
		reachSentence(device),
		"no answer — no route to it",
		"and the reason is the backend's own sentence, verbatim, where there is room",
	);
});

test("a device nobody dialled is `not asked`, and never `unreachable` (D2)", () => {
	/*
	 * THE HONESTY FIX THIS SLICE EXISTS FOR. The relay reports three different `false`
	 * cases as one boolean plus a glossed sentence - nothing dialled, dialled and silent,
	 * refused before the far device was involved - so the app could not tell "the listing
	 * budget ran out before this member was probed" from "it did not answer", and the
	 * shipped node painted the first one the amber of the second.
	 *
	 * BOTH PRODUCERS ARE FIXTURED HERE, because they are the whole of the closed list:
	 * `relay.NOT_ATTEMPTED_REASON` through the member table, and
	 * `server/utils/desktop_mesh.py`'s relay-down branch. The sentences are spelled the way
	 * `resume.peer_reason_words` hands them over - a `stage: ` prefix loses the stage word
	 * and keeps the sentence - and pinned by name in `mesh-reach.ts`.
	 */
	for (const [name, reason] of [
		[
			"the member table's budget",
			"the listing budget ran out before this member was probed",
		],
		[
			"the relay-down branch",
			"the relay is not running, so no device was asked",
		],
	]) {
		const graph = meshGraph({
			topology: networkTopology({
				networks: [
					network(NET_ONE, [member(DEVICE_B, { reachable: false, reason })]),
				],
			}),
			peers: peerList({}),
		});
		const device = graph.devices[0];
		assert.equal(
			deviceReach(device),
			"not-attempted",
			`${name}: the app's own limit is not the device's failure`,
		);
		assert.equal(reachWords(deviceReach(device)), "not asked");
		assert.equal(
			deviceStatLine(device, 1_700_000_100),
			"not asked",
			"and no surface below it says `unreachable` any more",
		);
		assert.equal(
			meshSummary(graph),
			"1 network · 1 device · 1 not asked",
			"the sentence above the canvas counts it as its own thing (D3)",
		);
	}
	/*
	 * A SENTENCE NOBODY WROTE DOWN FALLS BACK TO `unanswered`, which is the reading that
	 * blames the device least: an unreadable reason is likelier a refusal nobody spelled
	 * than a new way of saying "we never asked". The list is closed on purpose - a
	 * substring scan would read a real refusal as "we never asked" and take the blame for
	 * a device that stayed silent.
	 */
	const other = meshGraph({
		topology: networkTopology({
			networks: [
				network(NET_ONE, [
					member(DEVICE_B, { reachable: false, reason: "the budget ran out" }),
				]),
			],
		}),
		peers: peerList({}),
	});
	assert.equal(deviceReach(other.devices[0]), "unanswered");
	/*
	 * AND THE LIST IS THE RELAY'S OWN SENTENCES, checked rather than trusted: these two
	 * strings are the producers' vocabulary, so a rename upstream reddens this line
	 * instead of quietly reclassifying every member of a budget-exhausted listing.
	 */
	assert.deepEqual([...NOT_ATTEMPTED_SENTENCES].sort(), [
		"the listing budget ran out before this member was probed",
		"the relay is not running, so no device was asked",
	]);
	assert.equal(
		[...Object.entries(REACH_INK)].filter(([, ink]) => ink === "text-warning")
			.length,
		1,
		"exactly one reach state spends the warning hue, and it is the one the relay answered",
	);
});

test("a peer the reads disagree about is surfaced rather than silently dropped", () => {
	const graph = meshGraph({
		topology: networkTopology({
			networks: [network(NET_ONE, [member(DEVICE_B)])],
		}),
		// A device the peer catalogue knows and no membership holds.
		peers: peerList({
			peers: [peer(DEVICE_B), peer(DEVICE_C, { session_count: 3 })],
		}),
	});
	assert.deepEqual(
		graph.unmatchedPeers.map((row) => row.device_id),
		[DEVICE_C],
		"the read that named it is not thrown away; the list states it",
	);
});

test("the summary line is a sentence about this mesh, and this device", () => {
	const { topology, peers } = overlapping();
	const graph = meshGraph({ topology, peers });
	assert.equal(
		meshSummary(graph),
		"2 networks · 3 devices · 1 reached · 1 no answer · this device is device …aaaaaa",
		"counted by REACH (mesh redesign, D3), so an unanswered device is not filed as a failure it never was",
	);
	/*
	 * A mesh with nothing to count and no self id: the summary claims only what the
	 * reads answered, rather than inventing a device or a zero.
	 */
	const bare = meshGraph({
		topology: networkTopology({
			networks: [network(NET_ONE, [member(DEVICE_B)])],
		}),
		peers: peerList({}),
	});
	assert.equal(
		meshSummary(bare),
		"1 network · 1 device · 1 reached",
		"every device is in exactly one class, so the counts add up to the count they follow",
	);
	/*
	 * A CENSUS, NOT A SELECTION (agent review round 1, U4). The sentence used to read
	 * `2 no answer · 1 not asked · 1 suspected` over six devices: the suspect device was
	 * counted TWICE and `unknown` was counted nowhere, so the counts read as a breakdown
	 * and did not add up. The suspect fact is the overlay it is now (`N of them
	 * suspected`), and every reach class is enumerated.
	 */
	const census = meshGraph({
		topology: networkTopology({
			self_device_id: DEVICE_A,
			networks: [
				network(NET_ONE, [
					member(DEVICE_A),
					member(DEVICE_B, {
						suspect: true,
						reachable: false,
						reason: "no route to it",
					}),
					member(DEVICE_C, { reachable: false, reason: "no route to it" }),
					member(DEVICE_D, { reachable: false }),
				]),
			],
		}),
		peers: peerList({}),
	});
	assert.equal(
		meshSummary(census),
		"1 network · 4 devices · 1 of them suspected · 2 no answer · 1 unknown · this device is device …aaaaaa",
		"the suspect fact is a qualifier on the census, and `unknown` is named so the six counts can be added up",
	);
});

test("a stat line never claims a heartbeat the wire did not send", () => {
	const graph = meshGraph({
		topology: networkTopology({
			self_device_id: DEVICE_A,
			networks: [network(NET_ONE, [member(DEVICE_A), member(DEVICE_B)])],
		}),
		peers: peerList({
			peers: [
				peer(DEVICE_B, { session_count: 2, last_seen_at: 1_700_000_060 }),
				// A device whose stamp is absent: `last_seen_at` is written by a
				// rotation frame, so a healthy mesh usually has none.
			],
		}),
	});
	const self = graph.devices.find((device) => device.id === DEVICE_A);
	const devon = graph.devices.find((device) => device.id === DEVICE_B);
	const unknown = graph.devices.find((device) => device.id === DEVICE_A);
	assert.equal(deviceStatLine(self, 1_700_000_100), "this device");
	assert.equal(
		deviceStatLine(devon, 1_700_000_100),
		"2 conversations · last status frame just now",
		"THE AGE KEEPS THE WIRE'S OWN NOUN (mesh redesign, D4): `last_seen_at` is a rotation stamp, and `seen … ago` was a heartbeat's name on it",
	);
	assert.equal(
		deviceStatLine(unknown, 1_700_000_100),
		"this device",
		"and an absent stamp produces no time claim at all",
	);
});

test("the node draws a rail and a state line, and the sentence moved to its name (D4/D6)", () => {
	/*
	 * THE NODE'S OWN CONTRACT, pinned as source rather than as a rendered sentence, because
	 * what changed is WHICH surface has a reader for the sentence rather than what the
	 * sentence says. `deviceStatLine` is still the one builder (`mesh-graph.ts`), and the
	 * canvas node no longer paints it: the node draws the metric rail - a monospace count at
	 * a fixed x, which is the glance affordance a sentence cannot be - and the state line
	 * under it, while the full sentence stays on the accessible name and the tooltip.
	 */
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	assert.match(
		node,
		/w-3 shrink-0 font-mono text-body-sm text-ink tabular-nums/,
		"the count is monospace in a fixed 12 px column, so comparing devices compares digits in the same place",
	);
	assert.match(
		node,
		/\{device\.sessionCount \?\? "–"\}/,
		"and `null` renders an en dash, never a zero: the node's own page has carried `null` is not `0` since the join was written",
	);
	assert.match(
		node,
		/data-mesh-reach=\{reach\}/,
		"the node states its reach where an evidence rig can read it, from the same value its stripe and its words use",
	);
	assert.match(
		node,
		/\{REACH_DOT\[reach\]\}/,
		"and the dot is a second channel beside the word, so colour is never the only one",
	);
	assert.doesNotMatch(
		node,
		/\{emptyChipWords\(/,
		"the empty chip band's sentence is gone (D6): it spent a whole text row of a 147 px box saying `nothing` beside a count that already said it, and the fact is in the rail above and in the node's accessible name",
	);
	assert.doesNotMatch(
		node,
		/deviceNodeStatLine/,
		"there is no second, node-width rendering of the sentence left to drift from the first",
	);
});

/* --------------------------------------------------------------- positions */

test("slots are assigned once and retained: a poll moves nothing", () => {
	const first = assignSlots(new Map(), [
		{ key: "b", label: "beta" },
		{ key: "a", label: "alpha" },
	]);
	assert.deepEqual(
		[...first.entries()],
		[
			["a", 0],
			["b", 1],
		],
		"a column STARTS in label order",
	);
	// A new device arrives, and a label that sorts first arrives with it: the
	// existing nodes must not move.
	const second = assignSlots(first, [
		{ key: "b", label: "beta" },
		{ key: "a", label: "alpha" },
		{ key: "c", label: "aardvark" },
	]);
	assert.equal(second.get("a"), 0);
	assert.equal(second.get("b"), 1);
	assert.equal(
		second.get("c"),
		2,
		"a new node takes the next free slot rather than sorting under the pointer",
	);
	// One leaves: its slot is freed, and nothing else moves.
	const third = assignSlots(second, [{ key: "b", label: "beta" }]);
	assert.deepEqual([...third.entries()], [["b", 1]]);
	// And the freed slot is the one the next arrival takes.
	const fourth = assignSlots(third, [
		{ key: "b", label: "beta" },
		{ key: "z", label: "zed" },
	]);
	assert.equal(
		fourth.get("z"),
		0,
		"the gap is reused rather than growing the world",
	);
	assert.equal(fourth.get("b"), 1);
});

test("the layout is two centred columns, and the edges know where they end", () => {
	const geometry = meshGeometry({
		networks: new Map([["n1", 0]]),
		devices: new Map([
			["d1", 0],
			["d2", 1],
			["d3", 2],
		]),
	});
	const network = geometry.networks.get("n1");
	const top = geometry.devices.get("d1");
	const bottom = geometry.devices.get("d3");
	assert.ok(network && top && bottom);
	assert.ok(
		network.y > top.y && network.y < bottom.y,
		"one network beside three devices sits in the middle of its fan, not at the top",
	);
	assert.equal(
		bottom.y - top.y,
		2 * (NODE_HEIGHT + ROW_GAP),
		"row spacing is the ramp's, not a number invented per render",
	);
	assert.ok(
		network.x < top.x,
		"networks are the left column and devices the right one",
	);
});

test("zoom keeps the world point under the pointer invariant", () => {
	const start = { k: 1, tx: 12, ty: -30 };
	const pointer = { x: 300, y: 200 };
	const worldBefore = {
		x: (pointer.x - start.tx) / start.k,
		y: (pointer.y - start.ty) / start.k,
	};
	const zoomed = zoomAbout(start, pointer, 2.5);
	const worldAfter = {
		x: (pointer.x - zoomed.tx) / zoomed.k,
		y: (pointer.y - zoomed.ty) / zoomed.k,
	};
	assert.ok(Math.abs(worldBefore.x - worldAfter.x) < 1e-9);
	assert.ok(Math.abs(worldBefore.y - worldAfter.y) < 1e-9);
	assert.equal(zoomed.k, 2.5);
	assert.equal(
		zoomAbout(start, pointer, 99).k,
		3,
		"and the scale is clamped at the top of the range",
	);
	assert.equal(zoomAbout(start, pointer, 0.001).k, 0.25, "and at the bottom");
});

test("the taller node costs one device of `k = 1`, and the fit stops at legibility", () => {
	/*
	 * THE COST OF THE REDESIGN, MEASURED RATHER THAN DISCOVERED (design § 4). `NODE_WIDTH`
	 * is untouched, so `COLUMN_GAP`, `PAD`, `keepNodeVisible`, the edge anchors and the slot
	 * map are all unchanged; what moves is the node's height, and the only thing a height
	 * changes is how many devices fit at full size.
	 *
	 * The viewport is the SHIPPED one rather than a round number: at 1380x900 the canvas well
	 * measures 1284 x 691.3, and `fitTransform` spends 8 % of the smaller ratio as margin
	 * (`* 0.92`), which is where the budget comes from.
	 */
	const viewport = { width: 1284, height: 691.3 };
	const fitFor = (count) =>
		fitTransform(
			meshGeometry({
				networks: new Map([["n1", 0]]),
				devices: new Map(
					Array.from({ length: count }, (_, index) => [`d${index}`, index]),
				),
			}).bounds,
			viewport,
		).k;
	assert.equal(
		DEVICE_HEIGHT,
		NODE_BODY_HEIGHT + NODE_CHIP_BAND,
		"the node's height is still the reservation, and the band is still inside it",
	);
	assert.equal(
		DEVICE_HEIGHT,
		96,
		"200 x 96: width untouched, one body and one band",
	);
	for (const count of [1, 2, 4, 5])
		assert.equal(
			fitFor(count),
			1,
			`${count} devices still render at full size at the shipped window`,
		);
	const six = fitFor(6);
	assert.ok(
		six > 0.9 && six < 0.905,
		`six devices measure ${six.toFixed(5)}, and the 12 px meta renders at ${(six * 12).toFixed(2)} px`,
	);
	/*
	 * THE COST, stated where a future reader will find it: the `k = 1` guarantee moves from
	 * <= 6 devices (72 px node) to <= 5 (96 px node). Six was already a shrink at 0.90344,
	 * and SEVEN is where the floor first binds - seven's own raw fit is 0.77941, which the
	 * round-1 review re-derived after this comment and the PR's cost table both said nine
	 * (agent review round 1, m2: the jump from six to nine hid the rows between). Nine's
	 * raw fit would have been 0.61156, where the 12 px meta renders at 7.34 px - below the
	 * 10 px floor `design-qa`'s `tiny-text` check fails on.
	 */
	for (const count of [7, 8])
		assert.equal(
			fitFor(count),
			MIN_FIT_SCALE,
			`${count} devices are already at the floor (seven's raw fit is 0.77941), not past it`,
		);
	assert.equal(
		fitFor(9),
		MIN_FIT_SCALE,
		"nine devices stop at the legibility floor instead of shrinking to 0.61156, and the graph is panned to be read",
	);
	assert.equal(
		MIN_FIT_SCALE,
		0.8,
		"where the meta is 9.6 px and the label 10.4 px",
	);
});

test("fit centres the world in the viewport and never leaves the scale range", () => {
	const bounds = { width: 464, height: 200 };
	const fitted = fitTransform(bounds, { width: 1000, height: 600 });
	assert.equal(fitted.tx, (1000 - bounds.width * fitted.k) / 2);
	assert.equal(fitted.ty, (600 - bounds.height * fitted.k) / 2);
	assert.ok(fitted.k >= 0.25 && fitted.k <= 3);
	const tiny = fitTransform(bounds, { width: 10, height: 10 });
	assert.equal(
		tiny.k,
		MIN_FIT_SCALE,
		"a viewport smaller than the world stops at the LEGIBILITY floor rather than vanishing: a 7 px meta line is not readable, and the graph it cannot fit is pannable",
	);
	assert.ok(
		tiny.k > 0.25,
		"which is a different floor from the user's own zoom: a reader may still zoom out to 0.25 by hand",
	);
});

test("a row that opens a scope stack reserves the whole stack's band (D2/U3, round 2)", () => {
	/*
	 * THE LABEL'S ROOM IS RESERVED BY THE LAYOUT (design review round 1, D2; UX U3),
	 * because the scope layer cannot draw over the node above it (DOM order: scope ->
	 * edges -> nodes). What was measured without it: `ROW_GAP - SCOPE_ENCLOSURE_PAD`
	 * = 6 px of clear space for a 19.4 px band, so 13.4 px of the label rendered
	 * behind the node above on both palettes; and at 1024x768 the topmost label ran
	 * 4.4 px of a 13.9 px box behind the CANVAS'S own top edge, which no row gap can
	 * fix - hence the top clearance below.
	 *
	 * ROUND 2 PRICED THE STACK (agent review M4): one row can open SEVERAL nested
	 * levels, and the band is per level - `SCOPE_OPEN_GAP` at one, `SCOPE_LEVEL_STEP`
	 * more for each level above it - so two enclosures sharing an opener no longer
	 * overprint their labels on one anchor.
	 */
	const slots = {
		networks: new Map([["n1", 0]]),
		devices: new Map([
			["d0", 0],
			["d1", 1],
			["d2", 2],
		]),
	};
	const plain = meshGeometry(slots);
	const gap = (geometry, upper, lower) =>
		geometry.devices.get(lower).y -
		(geometry.devices.get(upper).y + DEVICE_HEIGHT);
	assert.equal(
		gap(plain, "d0", "d1"),
		ROW_GAP,
		"without a group the pitch is the plain grid, which is what the fit table rebuilds",
	);
	const scoped = meshGeometry(slots, new Map([["d1", 1]]));
	assert.equal(
		gap(scoped, "d0", "d1"),
		SCOPE_OPEN_GAP,
		"a row that opens an enclosure clears the pad, the band and its clearance",
	);
	assert.equal(
		gap(scoped, "d1", "d2"),
		ROW_GAP,
		"and its neighbour keeps the ordinary gap",
	);
	assert.equal(
		scoped.bounds.height - plain.bounds.height,
		SCOPE_OPEN_GAP - ROW_GAP,
		"the world grows by exactly the reservation, so the fit still contains what the label needs",
	);
	const stacked = meshGeometry(slots, new Map([["d1", 2]]));
	assert.equal(
		gap(stacked, "d0", "d1"),
		scopeOpenGap(2),
		"two levels clear one label's band per level (58 = 32 + 26)",
	);
	assert.equal(
		scopeOpenGap(2) - scopeOpenGap(1),
		SCOPE_LEVEL_STEP,
		"and the pitch the frames' staircase draws on is the same number the layout reserves",
	);
	assert.equal(
		stacked.bounds.height - plain.bounds.height,
		scopeOpenGap(2) - ROW_GAP,
		"the world grows by the stack's own reservation, not one label's",
	);
	const top = meshGeometry(slots, new Map([["d0", 1]]));
	assert.equal(
		top.devices.get("d0").y,
		PAD + scopeTopClearance(1),
		"a column whose FIRST row opens one reserves the strip at the world's top edge, where the narrow frame measured the label cut by the canvas itself",
	);
	assert.equal(
		scopeTopClearance(1),
		16,
		"16 world px - the old 8 plus the fit floor's 8, which is 6.4 screen px at k = 0.8 (round-2 M3)",
	);
	assert.equal(
		scopeTopClearance(2),
		42,
		"and a two-level stack's is 42 (58 - 24 + 8)",
	);
	const topStacked = meshGeometry(slots, new Map([["d0", 2]]));
	assert.equal(
		topStacked.devices.get("d0").y,
		PAD + scopeTopClearance(2),
		"the top clearance scales with the stack too, so every level's label stays inside the world",
	);
	const stacks = scopeStacks(
		[
			{
				prefix: "10.88.0",
				tier: "probable",
				words: "same prefix",
				deviceIds: ["d2", "d1"],
			},
		],
		slots.devices,
	);
	assert.deepEqual(
		stacks.map((stack) => stack.deviceId),
		["d1"],
		"and the opener is the group's topmost member, read off the same slot order the canvas draws",
	);
	assert.equal(openingLevels(stacks).get("d1"), 1, "one group, one level");
});

test("two enclosures that share their opener draw as one ordered stack (M4)", () => {
	/*
	 * THE COLLISION THE ROUND-2 REVIEW REPRODUCED: a peer publishing a LAN address and a
	 * tunnel address sits in two groups, and when it is topmost in both their frames' tops
	 * coincided - both labels anchored at (428, 140) in the reviewer's repro. The design
	 * ruling's answer is NEST + STAGGER, and the ORDER is its first half: a group reaching
	 * further down the column wraps the shorter one (larger bottom first), the tier's
	 * gravity breaks a tie, and the prefix breaks that. `scopeStacks` is the one grouping
	 * the layout and the layer both read, so this pins the order the frames draw in.
	 */
	const slots = {
		networks: new Map([["n1", 0]]),
		devices: new Map([
			["d1", 0],
			["d2", 1],
			["d3", 2],
			["d4", 3],
		]),
	};
	const repro = [
		{
			prefix: "10.88.0",
			tier: "probable",
			words: "same prefix",
			deviceIds: ["d1", "d2"],
		},
		{
			prefix: "192.168.1",
			tier: "shared",
			words: "shared with this device",
			deviceIds: ["d1", "d3"],
		},
	];
	const stacks = scopeStacks(repro, slots.devices);
	assert.equal(
		stacks.length,
		1,
		"both groups open at d1: ONE stack, not two frames on one anchor",
	);
	assert.equal(stacks[0].deviceId, "d1");
	assert.deepEqual(
		stacks[0].groups.map((group) => group.prefix),
		["192.168.1", "10.88.0"],
		"outermost first: the group reaching d3 wraps the one reaching d2",
	);
	assert.equal(
		openingLevels(stacks).get("d1"),
		2,
		"and the row it hangs off opens two levels, which the layout prices as 58 px",
	);
	/*
	 * EQUAL BOTTOMS FALL TO THE TIER'S GRAVITY: with every group reaching the same
	 * member, the ruling's order is `declared`, `shared`, `probable` - the authored
	 * claim wraps the computed ones - and the prefix breaks a same-tier tie.
	 */
	const tied = scopeStacks(
		[
			{
				prefix: "10.88.0",
				tier: "probable",
				words: "same prefix",
				deviceIds: ["d1", "d3"],
			},
			{
				prefix: "sim-lab",
				tier: "declared",
				words: "declared",
				deviceIds: ["d1", "d3"],
			},
			{
				prefix: "10.44.0",
				tier: "shared",
				words: "shared with this device",
				deviceIds: ["d1", "d3"],
			},
		],
		slots.devices,
	);
	assert.deepEqual(
		tied[0].groups.map((group) => group.tier),
		["declared", "shared", "probable"],
		"equal bottoms fall to `declared`, `shared`, `probable`",
	);
	const two = scopeStacks(
		[
			...repro,
			{
				prefix: "10.0.0",
				tier: "probable",
				words: "same prefix",
				deviceIds: ["d3", "d4"],
			},
		],
		slots.devices,
	);
	assert.deepEqual(
		two.map((stack) => stack.deviceId),
		["d1", "d3"],
		"and stacks sit in row order, so the layer draws them top to bottom",
	);
});

test("the layer draws the stack as nested rings, and the label anchor is unchanged (M4)", () => {
	const layer = source("src/renderer/src/features/mesh/mesh-scope-layer.tsx");
	assert.match(
		layer,
		/SCOPE_LEVEL_STEP \* outward/,
		"each outer level sits a step higher - the staircase the ruling draws",
	);
	assert.match(
		layer,
		/SCOPE_LEVEL_INSET \* outward/,
		"and stands inset wider the same way, so a parent frame is a ring rather than a repeat",
	);
	assert.match(
		layer,
		/inner \+ SCOPE_LEVEL_INSET/,
		"the bottom edge rings outward by the same inset unless its own members reach further",
	);
	assert.match(
		layer,
		/height: bottoms\[level\] - top,/,
		"and the height is measured between the two solved edges",
	);
	assert.match(
		layer,
		/bottom-full left-1 mb-0\.5/,
		"the label anchor is UNCHANGED: the frames' offsets do the staggering, not a second placement rule",
	);
	assert.match(
		layer,
		/data-mesh-scope-level=\{level\}/,
		"each level is addressable, so a rig can measure the staircase rather than count ink rows",
	);
	const canvas = source("src/renderer/src/features/mesh/mesh-canvas.tsx");
	assert.match(
		canvas,
		/<MeshScopeLayer stacks=\{stacks\} geometry=\{geometry\} \/>/,
		"the canvas hands the layer the same stacks the layout priced - one grouping, two readers",
	);
	assert.match(
		canvas,
		/meshGeometry\(slots, openingLevels\(stacks\)\)/,
		"and the levels the layout reserves come off those stacks",
	);
});

test("the floor-bound fit is TOP-ALIGNED, so the label band stays on screen (M3)", () => {
	/*
	 * THE SECOND CAUSE OF THE CLIPPED LABEL, in the transform rather than the layout: at
	 * the floor the world is taller than the viewport, and CENTRING it cuts it at both
	 * edges - the reviewed `scopes-narrow` frame measured the topmost label's glyph rows
	 * sliced flat at the canvas's own top edge while the overflow it paid for fell on the
	 * blank bottom margin. The fix aligns the overflow to the BOTTOM, where the pan and
	 * the blank pad already reach it.
	 */
	const viewport = { width: 1284, height: 691.3 };
	const boundsFor = (count) =>
		meshGeometry({
			networks: new Map([["n1", 0]]),
			devices: new Map(
				Array.from({ length: count }, (_, index) => [`d${index}`, index]),
			),
		}).bounds;
	const nine = boundsFor(9);
	const fit = fitTransform(nine, viewport);
	assert.equal(fit.k, MIN_FIT_SCALE, "nine devices sit at the floor");
	assert.ok(
		nine.height * fit.k > viewport.height,
		"and at the floor the world is taller than the viewport",
	);
	assert.equal(
		fit.ty,
		0,
		"so the world's top edge - where the reserved label band sits - stays on screen",
	);
	assert.equal(
		fit.tx,
		(viewport.width - nine.width * fit.k) / 2,
		"the horizontal centring is unchanged: a wide world still pans to its overflow",
	);
	const six = boundsFor(6);
	const roomy = fitTransform(six, viewport);
	assert.ok(
		six.height * roomy.k <= viewport.height,
		"a world the fit CAN contain",
	);
	assert.equal(
		roomy.ty,
		(viewport.height - six.height * roomy.k) / 2,
		"still centres vertically",
	);
});

/* ------------------------------------------------- the poll's own invariant */

test("a deep-equal poll hands back the same payload, so a poll re-solves nothing", async () => {
	/*
	 * React Query's `structuralSharing` (on by default) runs the refetch result
	 * through `replaceEqualDeep` and substitutes the PREVIOUS object when the two are
	 * deeply equal. That substitution is what makes the canvas's `useMemo` (keyed on
	 * the payload) skip a re-derivation - so it is asserted against the REAL function
	 * the library applies, not against a copy of its rule.
	 */
	const { replaceEqualDeep } = await import("@tanstack/react-query");
	const payload = () =>
		peerList({
			peers: [peer(DEVICE_B, { name: "devon-laptop", session_count: 2 })],
		});
	const first = payload();
	const second = payload();
	assert.deepEqual(
		first,
		second,
		"two reads of the same mesh answer the same value",
	);
	assert.equal(
		replaceEqualDeep(first, second),
		first,
		"and React Query keeps the FIRST object, which is the reference the memo compares",
	);
	// The negative control: a changed answer must NOT be folded into the old one.
	const changed = peerList({
		peers: [peer(DEVICE_B, { name: "devon-laptop", session_count: 3 })],
	});
	assert.notEqual(replaceEqualDeep(first, changed), first);
});

/* -------------------------------------------------------------- approvals */

/** One wire-shaped approval record, in the frozen §3.5 read shape (`badge_row`). */
const approvalCapture = (fields = {}) => ({
	approval_id: "ap_2v9k4m0q7r1s",
	state: "requested",
	what: {
		connect: true,
		install: true,
		anchor: { key_id: "op_3f8a" },
		unattended: true,
		grant: ["approve"],
		network_id: "n_1",
		role: "drive",
	},
	requested_by: {
		surface: "cli",
		session_id: "0123456789ef",
		device_id: "d_b",
	},
	expires_at: 1_800_000_000,
	device: {
		device_id: "d_b",
		name: "devon-laptop",
		host: "devon-laptop.local",
		user: "damian",
		transport: "ssh",
		host_key_fp: "SHA256:abc",
	},
	...fields,
});

test("an approval read is normalised, never cast: unusable rows drop, every field degrades", () => {
	const { approvalRows } = mesh;
	const rows = approvalRows({
		approvals: [
			approvalCapture(),
			approvalCapture({ approval_id: "" }),
			approvalCapture({ approval_id: "ap_drop", state: "" }),
			"not a record",
		],
	});
	assert.equal(
		rows.length,
		1,
		"a row that cannot be keyed or described is dropped, never drawn as a placeholder",
	);
	const [row] = rows;
	assert.equal(row.approvalId, "ap_2v9k4m0q7r1s");
	assert.equal(
		row.kind,
		"device",
		"the `device` block is what makes a device_onboard row",
	);
	assert.equal(row.where.host, "devon-laptop.local");
	assert.equal(row.what.connect, true);
	assert.deepEqual(row.what.grants, ["approve"]);
	assert.equal(row.requestedBy.surface, "cli");
	assert.equal(row.expiresAt, 1_800_000_000);

	const [machine] = approvalRows({
		approvals: [
			{
				approval_id: "ap_machine1",
				state: "requested",
				machine: { name: "this Mac" },
			},
		],
	});
	assert.equal(
		machine.kind,
		"machine",
		"the `machine` block is what makes a local_authority row",
	);
	assert.equal(machine.where.name, "this Mac");
	assert.equal(
		machine.what.connect,
		false,
		"a missing scope degrades to false, never undefined",
	);
	assert.deepEqual(machine.what.grants, []);
	assert.equal(machine.expiresAt, null);
	assert.equal(machine.requestedBy.sessionId, "");

	assert.equal(
		approvalRows([approvalCapture()]).length,
		1,
		"a bare array is accepted too (a stored or stubbed answer)",
	);
	assert.deepEqual(approvalRows(null), []);
});

test("the badge counts the flight and stops at the store's terminals; unknown states render verbatim", () => {
	const {
		approvalRows,
		isOpenApproval,
		pendingApprovalCount,
		approvalStateLabel,
	} = mesh;
	const rows = approvalRows({
		approvals: [
			approvalCapture(),
			approvalCapture({ approval_id: "ap_1", state: "approved" }),
			approvalCapture({ approval_id: "ap_2", state: "connecting" }),
			approvalCapture({ approval_id: "ap_3", state: "failed" }),
			approvalCapture({ approval_id: "ap_4", state: "connected" }),
			approvalCapture({ approval_id: "ap_5", state: "denied" }),
			approvalCapture({ approval_id: "ap_6", state: "expired" }),
		],
	});
	assert.equal(
		pendingApprovalCount(rows),
		4,
		"requested + approved + connecting + failed; the terminals stop the badge",
	);
	assert.equal(
		isOpenApproval("migrating"),
		false,
		"a state this build has not heard of counts as nothing",
	);
	assert.equal(
		approvalStateLabel("migrating"),
		"migrating",
		"and renders verbatim rather than blank",
	);
	assert.equal(approvalStateLabel("requested"), "Waiting for you");
});

test("the decision buttons follow the store's own transition matrix", () => {
	const { canApproveApproval, canDenyApproval } = mesh;
	assert.equal(
		canApproveApproval("requested"),
		true,
		"approve is the answer to `requested` alone",
	);
	for (const state of [
		"approved",
		"connecting",
		"failed",
		"connected",
		"denied",
		"expired",
	]) {
		assert.equal(canApproveApproval(state), false, state);
	}
	for (const state of ["requested", "approved", "connecting", "failed"]) {
		assert.equal(canDenyApproval(state), true, state);
	}
	for (const state of ["connected", "denied", "expired"]) {
		assert.equal(canDenyApproval(state), false, state);
	}
});

test("the card reads what/where/who in the CLI's order, and its window rounds up", () => {
	const {
		approvalRows,
		approvalWhereLabel,
		approvalRequesterLabel,
		approvalScopeLabels,
		approvalScopeGlosses,
		approvalScopeTone,
		approvalRemainingLabel,
		approvalTitle,
		approvalSubject,
	} = mesh;
	const [row] = approvalRows({ approvals: [approvalCapture()] });
	assert.equal(
		approvalWhereLabel(row),
		"damian@devon-laptop.local via ssh (devon-laptop)",
	);
	assert.equal(approvalRequesterLabel(row), "asked by cli · session 6789ef");
	assert.deepEqual(approvalScopeLabels(row), [
		"connect",
		"install",
		"install operator anchor",
		"join n_1 as drive",
		"trust unattended sessions",
		"grant approve",
	]);
	/*
	 * The two scopes that hand over TRUST wear their own register, and the plain
	 * ones do not (design round 1, D1: all six chips measured identically, so
	 * `install operator anchor` was indistinguishable from `connect` on the card
	 * whose purpose is consent to a key-signing gesture). Pinned as a pair so a
	 * future scope cannot quietly inherit `attention` - or lose it.
	 */
	assert.deepEqual(
		[
			"connect",
			"install",
			"install operator anchor",
			"join n_1 as drive",
			"trust unattended sessions",
			"grant approve",
		].map(approvalScopeTone),
		["neutral", "neutral", "attention", "neutral", "attention", "neutral"],
	);
	/*
	 * The join chip names the network the page already shows, and falls back to
	 * the id only when the mesh read has not landed (UX round 1, U1: the canvas
	 * said `damian-mesh` while the consent chip said `net_1`, two names for one
	 * object on one screen).
	 */
	assert.deepEqual(
		approvalScopeLabels(row, new Map([["n_1", "damian-mesh"]])),
		[
			"connect",
			"install",
			"install operator anchor",
			"join damian-mesh as drive",
			"trust unattended sessions",
			"grant approve",
		],
	);
	/*
	 * Only the scopes a reader cannot be expected to know are glossed (UX round
	 * 1, U2): `connect`/`install`/`join` are ordinary words, and glossing them
	 * would bury the two that are not.
	 */
	assert.deepEqual(approvalScopeGlosses(row), [
		{
			term: "install operator anchor",
			gloss:
				"that device can check approvals signed on your machines; nothing there can sign",
		},
		{
			term: "trust unattended sessions",
			gloss:
				"sessions you start on that device run without an approval prompt there",
		},
		{ term: "grant approve", gloss: "you may approve on that device" },
	]);
	/*
	 * A REPEATED OR REDUNDANT GRANT NEVER DOUBLES A CHIP OR WRITES AN
	 * UNGRAMMATICAL GLOSS (agent review round 5, R5-1). `--grant` is repeatable
	 * and unfiltered, and `step_grants` folds `unattended` in from the flag as
	 * well - so this input is reachable from the CLI, and both lists are keyed by
	 * the label they render.
	 */
	const redundant = {
		what: {
			connect: true,
			unattended: true,
			grants: ["approve", "approve", "unattended", ""],
		},
	};
	assert.deepEqual(approvalScopeLabels(redundant), [
		"connect",
		"trust unattended sessions",
		"grant approve",
	]);
	assert.deepEqual(approvalScopeGlosses(redundant), [
		{
			term: "trust unattended sessions",
			gloss:
				"sessions you start on that device run without an approval prompt there",
		},
		{ term: "grant approve", gloss: "you may approve on that device" },
	]);
	/*
	 * AND THE OTHER REACHABLE SHAPE: `--grant unattended` with the flag FALSE.
	 * The flag's own chip is not drawn then, so the grant is the only place the
	 * capability is stated - and it must not read `you may unattended`.
	 */
	const grantOnly = { what: { grants: ["unattended"] } };
	assert.deepEqual(approvalScopeLabels(grantOnly), [
		"trust unattended sessions",
	]);
	assert.deepEqual(approvalScopeGlosses(grantOnly), [
		{
			term: "trust unattended sessions",
			gloss:
				"sessions you start on that device run without an approval prompt there",
		},
	]);
	/*
	 * THE OTHER NON-VERB IN THE CORE'S GRANTABLE SET (agent review round 6, R6-1):
	 * `CAPABILITY_WORDS["broker_credential"]` is "borrow this device's logins", so
	 * the generic template would have written "you may broker_credential on that
	 * device" - a raw token inside a sentence, on the card that authorises it.
	 */
	const broker = { what: { grants: ["broker_credential"] } };
	assert.deepEqual(approvalScopeLabels(broker), ["borrow logins there"]);
	assert.deepEqual(approvalScopeGlosses(broker), [
		{
			term: "borrow logins there",
			gloss: "your sessions may use the logins stored on that device",
		},
	]);
	/* A VERB token keeps the template, because it is grammatical for a verb. */
	const verb = { what: { grants: ["steer"] } };
	assert.deepEqual(approvalScopeLabels(verb), ["grant steer"]);
	assert.deepEqual(approvalScopeGlosses(verb), [
		{ term: "grant steer", gloss: "you may steer on that device" },
	]);
	assert.equal(approvalTitle(row), "Onboard devon-laptop");
	assert.equal(approvalSubject(row), "devon-laptop");
	// A machine row is about the reader's own machine, by the kind's own definition.
	const [machine] = approvalRows({
		approvals: [{ approval_id: "ap_m", state: "requested", machine: {} }],
	});
	assert.equal(
		approvalTitle(machine),
		"Set up operator authority on this machine",
	);
	assert.equal(
		approvalWhereLabel(machine),
		null,
		"a block that names nothing renders no line",
	);
	// The window rounds UP to the next minute and unit, so the copy never claims less
	// time than is left (the browser consent card's own rule, for the same reason).
	assert.equal(
		approvalRemainingLabel(1_000 + 42 * 60, 1_000),
		"expires in 42 minutes",
	);
	assert.equal(
		approvalRemainingLabel(1_000 + 30, 1_000),
		"expires in under a minute",
	);
	assert.equal(
		approvalRemainingLabel(1_000 + 60, 1_000),
		"expires in 1 minute",
	);
	assert.equal(
		approvalRemainingLabel(1_000 + 3 * 3_600, 1_000),
		"expires in 3 hours",
	);
	assert.equal(
		approvalRemainingLabel(999, 1_000),
		null,
		"a passed window says nothing",
	);
	assert.equal(
		approvalRemainingLabel(null, 1_000),
		null,
		"no window says nothing",
	);
});

test("a refused decision carries the authored sentence and its machine code, or says so plainly", () => {
	const { approvalRefusal } = mesh;
	// The desktop plane's refusal (`{code, message}`): both facts travel, the
	// sentence trimmed, so the card can render exactly what the store said.
	assert.deepEqual(
		approvalRefusal({
			code: "approval_signing_unavailable",
			message: " no operator key here ",
		}),
		{
			code: "approval_signing_unavailable",
			sentence: "no operator key here",
		},
	);
	// The transport's own synthesised deadline sentence is a message without a code.
	assert.deepEqual(approvalRefusal({ message: "may or may not have landed" }), {
		code: "approval_refused",
		sentence: "may or may not have landed",
	});
	// A failure that carried neither states what the surface knows rather than
	// inventing a cause (the `approvalErrorMessage` fallback's own rule).
	assert.deepEqual(approvalRefusal(null), {
		code: "approval_refused",
		sentence: "The decision could not be answered.",
	});
});

/* ------------------------------------------------------------------ wiring */

const source = (path) => readFileSync(path, "utf8");

test("the /mesh route is mounted only when the tri-state says enabled", () => {
	const app = source("src/renderer/src/app.tsx");
	assert.match(
		app,
		/const meshState = desktopFeatureState\(capabilities\.data, "peers"\);/,
		"the tri-state is read at the site that decides, so unpaired / below-version / unknown are not collapsed into one reason",
	);
	assert.match(
		app,
		/\{meshState === "enabled" && \(\s*<Route path="\/mesh" element=\{<MeshPage \/>\} \/>\s*\)\}/,
		"without `features.peers` /mesh falls through to the catch-all like any unknown path - there is no reserved destination",
	);
	assert.match(
		app,
		/const MeshPage = lazy\(\(\) =>\s*import\("@features\/mesh\/mesh-page"\)/,
		"lazy like every other page, so a machine in no mesh never loads the chunk",
	);
});

test("the Mesh rail row is gated on MEMBERSHIP, and the route on the capability", () => {
	/*
	 * The split is deliberate and review round 1 (R1-1) is why it exists: `features.peers`
	 * is advertised by lop on EVERY install, so a key-only row is a rail item on the one
	 * piece of chrome that is always on screen, for a device that is in no mesh. The row
	 * therefore reads the catalogue's emptiness; the route stays on the capability so that
	 * leaving your last network while on the page cannot eject you from the tab (see the
	 * note at the route in `app.tsx`).
	 */
	const nav = source(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(
		nav,
		/const meshPaired =\s*desktopFeatureState\(capabilities\.data, "peers"\) === "enabled";/,
		"the capability is still read as the tri-state, at the site that decides",
	);
	assert.match(
		nav,
		/const meshMembership = useMeshMembership\(meshPaired\);/,
		"and MEMBERSHIP is the second fact, from the hook that owns the rule",
	);
	assert.match(
		nav,
		/\.\.\.\(meshMembership === "member"\s*\?\s*\[\s*\{\s*icon: Network,\s*label: "Mesh",\s*path: "\/mesh",/,
		"a row appears only for a device KNOWN to be in a mesh - not for an unknown or empty answer",
	);
	assert.doesNotMatch(
		nav,
		/meshState === "enabled"/,
		"the key-only gate is gone, not merely supplemented",
	);
	assert.match(
		nav,
		/currentView === "mesh"/,
		"and the row's active state follows the route",
	);
	assert.match(
		source("src/renderer/src/shared/hooks/use-route-params.ts"),
		/"mesh"/,
		"`useCurrentView` knows the view, or the row can never light up",
	);
});

test("the palette's destinations are the rail's destinations (R1-3)", () => {
	const palette = source(
		"src/renderer/src/features/command-palette/use-palette-sources.ts",
	);
	assert.match(
		palette,
		/id: "mesh",\s*\n\s*name: "Mesh",\s*\n\s*path: "\/mesh",/,
		"typing `mesh` finds the destination the rail draws",
	);
	/*
	 * ONE memo, and main's Projects gate lives INSIDE it (the fold onto `a9f4b1d7f4`): main
	 * filtered `PAGES` inline at the call site while this branch computed the mesh row in a
	 * memo of its own, and two filters is how the palette, the rail and the route drift
	 * apart. The pin asserts the shape that makes that impossible rather than the shape of
	 * either side's edit - the destination set is computed once and handed on.
	 */
	assert.match(
		palette,
		/\.\.\.\(meshMembership === "member" \? \[MESH_PAGE\] : \[\]\),/,
		"one memo carries both gates: this branch's mesh row",
	);
	assert.match(
		palette,
		/\.\.\.PAGES\.filter\(\(page\) => page\.id !== "projects" \|\| projectsEnabled\),/,
		"and main's Projects gate, inside the same list rather than beside it",
	);
	assert.match(
		palette,
		/\[meshMembership, projectsEnabled\],/,
		"with both gates in the memo's own dependency list",
	);
	assert.match(
		palette,
		/\.\.\.buildNavigationItems\(pages\),/,
		"and the navigation rows are built from that one set",
	);
});

test("the membership rule itself, executed rather than read", async () => {
	/*
	 * The rule is bundled and RUN, because the pins above can only say that some gate is
	 * written - and the defect this round fixed was a gate that was written and MEANT the
	 * wrong thing. `mesh-membership.ts` is pure (no React, no query client, no router), so
	 * this is the cheap half of the evidence and the half a future edit cannot fake.
	 */
	const built = await build({
		stdin: {
			contents:
				'export * from "./src/renderer/src/features/mesh/mesh-membership";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
	);
	/*
	 * Case (a) of the review's own list: a daemon too old to carry the key. Nothing may
	 * mount, and nothing is asked.
	 */
	assert.equal(
		mod.meshMembership({ enabled: false, networks: undefined }),
		"unknown",
	);
	/* And a stale answer cannot resurrect it either. */
	assert.equal(
		mod.meshMembership({
			enabled: false,
			networks: { networks: [{ id: "n" }] },
		}),
		"unknown",
	);
	/* No answer yet: unknown, which mounts nothing - no flash of a row that may vanish. */
	assert.equal(
		mod.meshMembership({ enabled: true, networks: undefined }),
		"unknown",
	);
	/* A first read that FAILED is also unknown, and mounts nothing. */
	assert.equal(
		mod.meshMembership({ enabled: true, networks: undefined, error: true }),
		"unknown",
	);
	/* Case (b): the capability is on and the catalogue ANSWERED EMPTY - no row. */
	assert.equal(
		mod.meshMembership({ enabled: true, networks: { networks: [] } }),
		"none",
	);
	/* Case (c): a device in a network. */
	assert.equal(
		mod.meshMembership({
			enabled: true,
			networks: { networks: [{ id: "n" }] },
		}),
		"member",
	);
	/*
	 * A device already known to be in a mesh keeps `member` across a failed REFETCH,
	 * because React Query hands the last good `data` back - so a relay hiccup cannot make
	 * the row disappear under the user. The shape below is that state.
	 */
	assert.equal(
		mod.meshMembership({
			enabled: true,
			networks: { networks: [{ id: "n" }] },
			error: true,
		}),
		"member",
	);
});

test("the two mesh reads are reads: GET, long-budget, and classified as read-only", () => {
	const contract = source("src/shared/desktop-contract.ts");
	/*
	 * The pins match the SEMANTIC bits and let the formatter own the whitespace: an
	 * assertion about indentation is an assertion that breaks when the formatter
	 * reflows, which is exactly what happened to the first draft of this file.
	 */
	assert.match(contract, /z\.literal\("peers\.list"\)/);
	assert.match(contract, /z\.literal\("networks\.list"\)/);
	assert.match(
		contract,
		/case "peers\.list":\s*return \{ path: "\/v1\/desktop\/peers", method: "GET" \};/,
	);
	assert.match(
		contract,
		/case "networks\.list":\s*return \{ path: "\/v1\/desktop\/networks", method: "GET" \};/,
	);
	/*
	 * THE LONG BUDGET IS THE POINT, not a filing choice: the backend's own client
	 * timeout for a listing that dials every peer is 20 s (`LISTING_CLIENT_TIMEOUT_S`),
	 * so an app that gave up on the 20 s control budget would report a failure about a
	 * read that was still working - and the give-up sentence cannot name the cause.
	 */
	assert.match(
		contract,
		/const MESH_READ_OPS: ReadonlySet<string> = new Set\(\[[\s\S]*?"networks\.list",[\s\S]*?"peers\.list",[\s\S]*?\]\);/,
	);
	assert.match(contract, /\.\.\.MESH_READ_OPS,/);
	const readOnly = contract.slice(contract.indexOf("const READ_ONLY_OPS"));
	assert.match(
		readOnly.slice(0, readOnly.indexOf("])")),
		/"networks\.list",[\s\S]*?"peers\.list",/,
		"both are in READ_ONLY_OPS, so a timeout says nothing was read rather than 'it may have reached the server'",
	);
});

test("the three mesh writes exist, and each is gated on the key that owns it", () => {
	const contract = source("src/shared/desktop-contract.ts");
	for (const op of [
		"sessions.transfer",
		"networks.invite",
		"networks.member.remove",
	]) {
		assert.match(
			contract,
			new RegExp(`z\\.literal\\("${op.replace(".", "\\.")}"\\)`),
			`${op} has a caller in this slice and a schema that refuses a misspelt key`,
		);
	}
	const hooks = source(
		"src/renderer/src/shared/api/local-operator/desktop-hooks.ts",
	);
	assert.match(hooks, /\| "peers"/, "the mesh read's key");
	/*
	 * No trailing semicolon is asserted: this key WAS the union's last member until the fold onto
	 * a main that adds `| "aida"` after it, so the pin now matches the member itself. The claim it
	 * carries is unchanged - the transfer is a key of its own, not a version of `peers` - and a
	 * deletion of the member still reddens this line.
	 */
	assert.match(
		hooks,
		/\| "session_transfer"/,
		"the transfer is its OWN key, so a backend that can list peers and cannot move one does not offer a control that 404s",
	);
	/*
	 * The two keys are asked SEPARATELY, and the page is where that shows: gating the
	 * move on `peers` would draw drop targets against a route that refuses.
	 */
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(
		page,
		/desktopFeatureState\(capabilities\.data, "session_transfer"\) === "enabled"/,
	);
	assert.match(
		page,
		/desktopFeatureState\(capabilities\.data, "peers"\) === "enabled"/,
	);
});

test("a move's deadline is derived from the route's own bound, not from the control budget", () => {
	const contract = source("src/shared/desktop-contract.ts");
	/*
	 * The published numbers, asserted as numbers: an offload is bounded at 145 s and a
	 * `keep` copy or a recall at 415 s at `wait_s=0` (`move_client_bound_s`). A client
	 * whose own deadline is shorter gives up first and reports its own timeout for a
	 * move the backend was about to answer - the defect this derivation exists for.
	 */
	const terms = contract.slice(contract.indexOf("const MOVE_OP_DEADLINE_S"));
	const offload = /MOVE_OP_DEADLINE_S = (\d+);/.exec(terms);
	const copy = /MOVE_COPY_WAIT_S = (\d+);/.exec(terms);
	const confirm = /MOVE_OFFLOAD_CONFIRM_S = (\d+);/.exec(terms);
	const slack = /MOVE_CONTROL_SLACK_S = (\d+);/.exec(terms);
	const margin = /MOVE_CLIENT_MARGIN_S = (\d+);/.exec(terms);
	for (const [name, hit] of [
		["MOVE_OP_DEADLINE_S", offload],
		["MOVE_COPY_WAIT_S", copy],
		["MOVE_OFFLOAD_CONFIRM_S", confirm],
		["MOVE_CONTROL_SLACK_S", slack],
		["MOVE_CLIENT_MARGIN_S", margin],
	]) {
		assert.ok(hit, `${name} is mirrored from the backend, by name`);
	}
	const base = Number(offload[1]) + Number(slack[1]) + Number(margin[1]);
	assert.equal(base + Number(confirm[1]), 145, "an offload's published bound");
	assert.equal(
		base + Number(copy[1]),
		415,
		"a copy's or a recall's published bound",
	);
	assert.match(
		contract,
		/to === "local"|recall = shape\.to === "local"/,
		"a recall takes the copy's term, not the offload's settle window",
	);
	const transfer = contractRuntime.moveClientBoundMs({
		to: "d_peer",
		keep: false,
		waitS: 0,
	});
	assert.equal(transfer, 145_000);
	assert.equal(
		contractRuntime.moveClientBoundMs({ to: "local", keep: false, waitS: 0 }),
		415_000,
	);
	assert.equal(
		contractRuntime.moveClientBoundMs({ to: "d_peer", keep: true, waitS: 0 }),
		415_000,
	);
	assert.ok(
		contractRuntime.desktopRequestTimeoutMs({
			op: "sessions.transfer",
			sessionId: "a".repeat(12),
			to: "d_peer",
		}) > 145_000,
		"the renderer's own bound is above the transport's, which is above the route's",
	);
	const detail = contractRuntime.desktopRequestDeadlineDetail(
		"sessions.transfer",
		415_000,
	);
	assert.match(detail.message, /unknown/);
	assert.doesNotMatch(detail.message, /Nothing was read/);
	assert.equal(detail.code, "deadline_exceeded");
});

test("the reads poll at the catalogue's cadence and stop when the tab is not mounted", () => {
	const store = source("src/renderer/src/features/mesh/mesh-store.ts");
	assert.match(store, /export const MESH_POLL_MS = 30_000;/);
	assert.match(
		store,
		/refetchInterval: enabled \? MESH_POLL_MS : false,/,
		"a machine in no mesh issues no call at all, and an unmounted tab polls nothing",
	);
	assert.match(store, /retry: false,/);
	assert.match(
		store,
		/queryKey: meshKeys\.peers,/,
		"the catalogue read is its own query key, deliberately not folded into the session store",
	);
	/*
	 * The assign-once rule, pinned where it is decided: the memo is keyed on the
	 * columns' identity rather than on the graph, because a new graph reference - which
	 * a deep-equal poll would still produce if the payload were rebuilt - would be a
	 * re-solved layout and a node that moved under the pointer.
	 */
	assert.match(
		store,
		/\}, \[key\]\);/,
		"the slot memo is keyed on the identity, not the graph",
	);
	assert.match(store, /pinned\.current = next;/);
});

test("the approvals surface: its own key, one badge read, two no-body decisions, one long budget", () => {
	const contract = source("src/shared/desktop-contract.ts");
	assert.match(contract, /z\.literal\("approvals\.list"\)/);
	assert.match(contract, /z\.literal\("approvals\.approve"\)/);
	assert.match(contract, /z\.literal\("approvals\.deny"\)/);
	assert.match(
		contract,
		/case "approvals\.list":\s*return \{ path: "\/v1\/desktop\/approvals", method: "GET" \};/,
	);
	assert.equal(
		contractRuntime.desktopEndpoint({
			op: "approvals.approve",
			approvalId: "ap_2v9k4m0q7r1s",
		}).path,
		"/v1/desktop/approvals/ap_2v9k4m0q7r1s/approve",
	);
	assert.equal(
		contractRuntime.desktopEndpoint({
			op: "approvals.deny",
			approvalId: "ap_2v9k4m0q7r1s",
		}).path,
		"/v1/desktop/approvals/ap_2v9k4m0q7r1s/deny",
	);
	/*
	 * THE ID IS CHECKED HERE, by name: it reaches a route path, so a path fragment or
	 * an empty string must be refused by the schema rather than by the daemon's
	 * generic 422 — and the decision routes take NO body (approving is the gesture).
	 */
	assert.equal(
		contractRuntime.desktopRequestSchema.safeParse({
			op: "approvals.approve",
			approvalId: "../config",
		}).success,
		false,
	);
	assert.equal(
		contractRuntime.desktopRequestSchema.safeParse({ op: "approvals.deny" })
			.success,
		false,
	);
	assert.equal(
		contractRuntime.desktopRequestSchema.safeParse({
			op: "approvals.list",
			approvalId: "ap_x",
		}).success,
		false,
		"the list is a bare read; a field it cannot mean is refused here",
	);
	assert.equal(
		contractRuntime.desktopRequestSchema.safeParse({
			op: "approvals.approve",
			approvalId: "ap_2v9k4m0q7r1s",
		}).success,
		true,
	);
	/*
	 * THE GESTURE'S BUDGET IS THE POINT: approve runs the presence-gated signing
	 * call, whose own bound is 180 s (`keyagent.SIGN_TIMEOUT_SECONDS`, mirrored in
	 * the contract), so the control budget would abandon a prompt the operator was
	 * still reading two minutes before the backend itself stops waiting.
	 */
	assert.equal(
		contractRuntime.desktopRequestDeadlineMs("approvals.approve"),
		195_000,
	);
	assert.equal(
		contractRuntime.desktopRequestDeadlineMs("approvals.deny"),
		20_000,
		"a deny never signs — it keeps the control budget",
	);
	assert.equal(
		contractRuntime.desktopRequestDeadlineMs("approvals.list"),
		20_000,
		"the badge read is a cold local scan",
	);
	const detail = contractRuntime.desktopRequestDeadlineDetail(
		"approvals.approve",
		195_000,
	);
	assert.match(
		detail.message,
		/may or may not have landed/,
		"the outcome is unknown, never 'nothing happened'",
	);
	assert.match(detail.message, /refuses a second/);
	assert.doesNotMatch(detail.message, /Nothing was read/);
	assert.match(
		contractRuntime.desktopRequestDeadlineDetail("approvals.list", 20_000)
			.message,
		/Nothing was read/,
		"a read that timed out promises what a read can: nothing was read",
	);
});

test("the Mesh rail badge rides an approvals read that dials nothing, and only where the row can show it", () => {
	const nav = source(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(
		nav,
		/const meshApprovalsEnabled =\s*desktopFeatureState\(capabilities\.data, "approvals"\) === "enabled";/,
		"the tri-state gate, at the site that decides",
	);
	assert.match(
		nav,
		/useMeshApprovals\(\s*meshMembership === "member" && meshApprovalsEnabled,\s*\{ poll: true \},?\s*\)/,
		"the rail POLLS this one read (it dials no peer) and only when a Mesh row exists to carry the badge",
	);
	assert.match(nav, /attention: meshWaiting,/);
	assert.match(nav, /attentionTag: "nav-mesh-badge",/);
	assert.match(
		nav,
		/attentionName: \(count: number\) => `Mesh, \$\{count\} waiting`,/,
	);
});

test("the Mesh page renders the tray above every state block, off its own read", () => {
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(
		page,
		/desktopFeatureState\(capabilities\.data, "approvals"\) === "enabled"/,
	);
	assert.match(
		page,
		/useMeshApprovals\(enabled && approvalsEnabled, \{\s*poll: false,?\s*\}\)/,
		"the page rides the rail's poller through the shared cache entry",
	);
	assert.match(page, /<MeshApprovalsTray/);
	const trayAt = page.indexOf("<MeshApprovalsTray");
	assert.ok(trayAt > 0);
	for (const arm of [
		'{state.kind === "loading" && (',
		'{state.kind === "error" && (',
		'{state.kind === "empty" && (',
		'{state.kind === "ready" && graph && (',
	]) {
		const at = page.indexOf(arm);
		assert.ok(
			at > trayAt,
			`the tray renders above ${arm} - an approval stays visible in every state`,
		);
	}
});

test("a refused decision renders its sentence, and the busy gate is the surface's", () => {
	/*
	 * Agent review round 1, findings 1 and 3. The page must read the mutation's
	 * own error (a refusal rendered nowhere is a dead click), and the tray must
	 * gate every card while one decision is in flight, as the browser tray it
	 * models does - a per-row gate lets a second decision race the cue.
	 */
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(
		page,
		/const decisionRefusal = decideApproval\.isError/,
		"the decision's own error is read - the refusal must have a render path",
	);
	assert.match(page, /approvalRefusal\(decideApproval\.error\)/);
	assert.match(
		page,
		/refusal=\{approvals\.decisionRefusal\}/,
		"and the tray receives it through the approvals bundle",
	);
	const tray = source("src/renderer/src/features/mesh/mesh-approvals-tray.tsx");
	assert.match(
		tray,
		/const busy = pending !== null;/,
		"the gate is computed once, for the whole tray",
	);
	assert.match(
		tray,
		/disabled=\{busy\}/,
		"every decision control rides the surface-wide gate",
	);
	assert.match(
		tray,
		/*
		 * The pattern stops at the element, not at a parenthesised group: the
		 * formatter (biome) rewrites `cond && (\n <X />\n)` to `cond && <X />`,
		 * so pinning the parens asserted a shape the codebase never ships and
		 * left Desktop Tests red on the head the round-1 fix produced. The
		 * INTENT is unchanged - the refusal renders while unattached.
		 */
		/refusal && !refusalAttached && <MeshDecisionRefusal/,
		"a refusal whose record left the live set still renders under the list",
	);
	assert.match(
		tray,
		/<Badge variant=\{approvalScopeTone\(scope\)\}>/,
		"the consequence-bearing scopes wear their own register (design round 1, D1)",
	);
	assert.match(
		tray,
		/data-tour-tag="mesh-approval-consequence"/,
		"the consequence is its own labelled gloss, not a clause of the provenance line (design round 1, D2)",
	);
	assert.doesNotMatch(
		tray,
		/\{requester && hint && <span> · <\/span>\}/,
		"provenance and consequence no longer share one line and one register",
	);
	assert.match(
		tray,
		/data-tour-tag="mesh-approval-scope-glosses"/,
		"the trust-bearing scopes are glossed on the card (UX round 1, U2)",
	);
	assert.match(
		tray,
		/approvalScopeLabels\(row, networkNames\)/,
		"the join chip names the network the page already shows (UX round 1, U1)",
	);
	/*
	 * AND THE PAGE ACTUALLY PASSES IT (agent review round 4, R4-4): the tray pin
	 * above proves the chip CAN name the network, while dropping the prop at the
	 * call site silently reverted it to the id with every test still green.
	 */
	assert.match(
		page,
		/networkNames=\{/,
		"the page hands the tray the names it already holds, or the chip silently falls back to the id",
	);
});

test("the page keeps the last good read painted and never zeroes a fact", () => {
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(
		page,
		/const staleError =\s*state\.kind === "ready"/,
		"a failed poll over drawn data is a sentence, not a wipe",
	);
	assert.match(
		page,
		/meshReadState\(reads\)/,
		"the four states are decided by the pure machine the unit tests cover",
	);
	const store = source("src/renderer/src/features/mesh/mesh-store.ts");
	assert.match(
		store,
		/return topology\.networks\.length === 0 \? \{ kind: "empty" \} : \{ kind: "ready" \};/,
	);
});

/* --------------------------------------------- the facts the frames taught */

test("one quantity, one number: a network's members and the device nodes agree", () => {
	/*
	 * Caught by LOOKING at the first capture of this set, which is why it is a test
	 * now: the network node read "3 devices" beside a summary line reading "4 devices"
	 * on one screen, because the node counted ACTIVE memberships and the summary counts
	 * device nodes. Both now count members, and the revoked ones are named as such.
	 */
	const graph = meshGraph({
		topology: networkTopology({
			self_device_id: DEVICE_A,
			networks: [
				network(NET_ONE, [
					member(DEVICE_A),
					member(DEVICE_B),
					member(DEVICE_C, { active: false }),
				]),
			],
		}),
		peers: peerList({ self_device_id: DEVICE_A, peers: [] }),
	});
	assert.equal(graph.networks[0].memberCount, 3, "members, revoked included");
	assert.equal(graph.networks[0].revokedCount, 1);
	assert.equal(
		graph.devices.length,
		graph.networks[0].memberCount,
		"the node count and the member count are the same quantity said twice",
	);
});

test("a device whose every membership is revoked says so, not 'no sessions'", () => {
	const graph = meshGraph({
		topology: networkTopology({
			self_device_id: DEVICE_A,
			networks: [
				network(NET_ONE, [
					member(DEVICE_A),
					member(DEVICE_C, { active: false }),
				]),
			],
		}),
		peers: peerList({ self_device_id: DEVICE_A, peers: [] }),
	});
	const revoked = graph.devices.find((device) => device.id === DEVICE_C);
	assert.ok(revoked);
	assert.equal(
		deviceStatLine(revoked, 1_700_000_000),
		"revoked membership",
		"a burned device id is never admitted again, so this is the state the node must name",
	);
	/*
	 * And the same device with one live membership elsewhere is NOT revoked: the
	 * membership is per network, so the node may only claim what every membership says.
	 */
	const mixed = meshGraph({
		topology: networkTopology({
			self_device_id: DEVICE_A,
			networks: [
				network(NET_ONE, [
					member(DEVICE_A),
					member(DEVICE_C, { active: false }),
				]),
				network(NET_TWO, [member(DEVICE_A), member(DEVICE_C)]),
			],
		}),
		peers: peerList({ self_device_id: DEVICE_A, peers: [] }),
	});
	const alive = mixed.devices.find((device) => device.id === DEVICE_C);
	assert.ok(alive);
	assert.notEqual(deviceStatLine(alive, 1_700_000_000), "revoked membership");
	assert.equal(alive.memberships.length, 2);
});

/* ---------------------------------------------------- the review-round fixes */

test("the fit never enlarges the world past its designed size (D2)", async () => {
	const built = await build({
		stdin: {
			contents:
				'export * from "./src/renderer/src/features/mesh/mesh-positions";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
	);
	const bounds = { x: 0, y: 0, width: 400, height: 200 };
	/* A viewport with room to spare: the fit centres and does NOT scale up. */
	const roomy = mod.fitTransform(bounds, { width: 2000, height: 1200 });
	assert.equal(
		roomy.k,
		1,
		"1.79x is what put a 13px label at 23px in the frames",
	);
	assert.ok(
		roomy.tx > 0 && roomy.ty > 0,
		"and the graph is centred in the room it does not use",
	);
	/* A viewport that is too small still shrinks to fit - unchanged. */
	const tight = mod.fitTransform(bounds, { width: 320, height: 160 });
	assert.ok(tight.k < 1, "the shrink side of the fit is untouched");
	/* And the user's own zoom is not capped by the fit's ceiling. */
	assert.ok(
		mod.MAX_SCALE > mod.MAX_FIT_SCALE,
		"zooming in is still a gesture the reader can make",
	);
});

test("this device is a ring, and the stripe carries REACH (D6, mesh redesign D2)", () => {
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	assert.match(
		node,
		/const STATE_RING: Record<DeviceState, string \| null> = \{\s*self: "ring-2 ring-accent",/,
		"identity is its own channel: a ring no status state can spend",
	);
	assert.match(
		node,
		/const REACH_STRIPE: Record<DeviceReach, string> = \{\s*self: "border-l-hairline",/,
		"and the self stripe is the neutral one a resting node wears, so a green bar cannot read as healthy in a misconfigured graph",
	);
	assert.match(
		node,
		/function nodeStripe\(device: MeshDevice\): string \{\s*return device\.suspect \? "border-l-danger" : REACH_STRIPE\[deviceReach\(device\)\];/,
		"the stripe is keyed on REACH with the suspect overlay on top: a device nobody dialled wears the neutral stripe its words describe, not the amber of a device that stayed silent",
	);
	assert.doesNotMatch(
		node,
		/self: "border-l-accent"/,
		"the accent stripe is gone, not merely joined by a ring",
	);
});

test("the stripe and the refusal read the SAME reachability, from the same copy (U9)", () => {
	/*
	 * TWO PREDICATES, ONE FACT (UX review round 2, U9): `sessionStripeKey` asked the session
	 * ROW's `reachable` - the catalogue's copy - while `resolveDrop` refuses on the OWNER
	 * DEVICE's `reachable`, the graph's copy. Where a row says `reachable: true` for a device
	 * that stopped answering, the chip wore the resting hairline and then refused the drop the
	 * reader had already committed to, which is the one thing a prospective channel must not do.
	 * The predicate now takes the device's own fact, and this executes it - including the row
	 * whose stale copy disagrees, which is the case that was wrong.
	 */
	const staleRow = session({ reachable: false, live_state: "idle" });
	assert.equal(
		sessionStripeKey(staleRow, true),
		"resting",
		"the row's own copy does not drive the stripe; the device's answer does",
	);
	assert.equal(
		sessionStripeKey(session({ live_state: "idle" }), false),
		"attention",
		"an owner that is not answering gets the stripe the drag will act on",
	);
	assert.equal(
		sessionStripeKey(session({ live_state: "busy" }), true),
		"attention",
		"and a turn in flight keeps its own state",
	);
	assert.equal(
		sessionStripeKey(session({ live_state: "idle" }), true),
		"resting",
	);
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	assert.match(
		node,
		/CHIP_STRIPE\[sessionStripeKey\(session, ownerReachable\)\]/,
		"the chip hands it the device's own fact rather than the row's",
	);
	assert.match(node, /ownerReachable=\{device\.reachable\}/);
});
/* --------------------------------------------------------------- slice 2: drops */

/**
 * The fixtures the drop matrix runs on, built through the REAL graph constructor.
 *
 * Hand-built device objects would test `resolveDrop` against a shape only this file
 * believes in; `meshGraph` is what the canvas hands it, so the two cannot drift.
 */
function dropFixture() {
	const topology = networkTopology({
		self_device_id: SELF,
		networks: [
			{
				network_id: NET_HOME,
				name: "damian-mesh",
				epoch: 4,
				trust: "active",
				members: [
					{
						device_id: SELF,
						name: "damians-MacBook-Pro",
						role: "admin",
						capabilities: ["sessions", "transfer"],
						active: true,
						suspect: false,
						endpoints: [],
						last_seen_at: null,
						reachable: true,
						reason: "",
					},
					{
						device_id: PEER,
						name: "devon-laptop",
						role: "drive",
						capabilities: ["sessions", "transfer"],
						active: true,
						suspect: false,
						endpoints: [],
						last_seen_at: null,
						reachable: true,
						reason: "",
					},
					{
						device_id: BURNED,
						name: "old-thinkpad",
						role: "drive",
						capabilities: ["sessions"],
						active: false,
						suspect: false,
						endpoints: [],
						last_seen_at: null,
						reachable: true,
						reason: "",
					},
					{
						device_id: SUSPECT,
						name: "duplicate-key",
						role: "drive",
						capabilities: ["sessions"],
						active: true,
						suspect: true,
						endpoints: [],
						last_seen_at: null,
						reachable: true,
						reason: "",
					},
					{
						device_id: THIRD,
						name: "studio-imac",
						role: "drive",
						capabilities: ["sessions", "transfer"],
						active: true,
						suspect: false,
						endpoints: [],
						last_seen_at: null,
						reachable: true,
						reason: "",
					},
				],
			},
		],
	});
	const peers = peerList({
		self_device_id: SELF,
		peers: [
			{
				device_id: PEER,
				name: "devon-laptop",
				reachable: true,
				unreachable_reason: "",
				last_seen_at: null,
				session_count: 2,
				rtt_ms: null,
			},
		],
	});
	const graph = meshGraph({ topology, peers });
	return {
		graph,
		context: {
			selfDeviceId: graph.selfDeviceId,
			devices: new Map(graph.devices.map((device) => [device.id, device])),
			networks: new Map(graph.networks.map((network) => [network.id, network])),
		},
	};
}

const SELF = `d_${"a".repeat(32)}`;
const PEER = `d_${"b".repeat(32)}`;
const BURNED = `d_${"c".repeat(32)}`;
const SUSPECT = `d_${"d".repeat(32)}`;
const THIRD = `d_${"e".repeat(32)}`;
const NET_HOME = `n_${"1".repeat(24)}`;

const session = (fields = {}) => ({
	id: "0123456789ab",
	name: "Sweep 001",
	mtime: 1,
	locality: "local",
	owner_device: "",
	owner_device_name: "",
	reachable: true,
	unreachable_reason: "",
	live_state: "idle",
	archived: false,
	...fields,
});

const SELF_LABEL = "damians-MacBook-Pro";

const drag = (row, ownerDeviceId, ownerLabel) => ({
	session: row,
	ownerDeviceId,
	ownerLabel,
});

test("the drop matrix: only a valid target accepts, and the verb names the operation", () => {
	const { context } = dropFixture();
	const local = session();
	const remote = session({
		id: "0123456789cd",
		locality: "remote",
		owner_device: PEER,
		owner_device_name: "devon-laptop",
	});
	// The PAYLOAD is what `resolveDrop` takes, not the bare row: a drag knows which
	// device holds the session and what that device is called, and the verdict's
	// sentences are written from those facts.
	const offloadDrag = drag(local, SELF, SELF_LABEL);
	const recallDrag = drag(remote, PEER, "devon-laptop");

	// An offload: this device asks the peer to pull.
	const offload = resolveDrop(
		offloadDrag,
		{ kind: "device", deviceId: PEER },
		context,
	);
	assert.equal(offload.kind, "plan");
	assert.equal(offload.plan.to, PEER);
	assert.equal(offload.plan.keep, false);
	assert.match(offload.plan.verb, /^Move to devon-laptop$/);
	assert.equal(offload.alternatives.length, 1);
	assert.equal(
		offload.alternatives[0].keep,
		true,
		"the reversible half is offered",
	);
	assert.equal(offload.alternatives[0].lost, null, "a copy loses nothing");
	assert.match(offload.plan.lost, /deleted once devon-laptop has it/);

	// A recall: the opposite protocol, through the same route.
	const recall = resolveDrop(
		recallDrag,
		{ kind: "device", deviceId: SELF },
		context,
	);
	assert.equal(recall.kind, "plan");
	assert.equal(recall.plan.to, "local");
	assert.match(recall.plan.verb, /Recall to this device/);
	assert.match(recall.plan.lost, /deleted once this device has it/);

	// A drop where the session already is: nothing happened, and nothing is said.
	assert.equal(
		resolveDrop(offloadDrag, { kind: "device", deviceId: SELF }, context).kind,
		"none",
	);

	// A third device: this desktop is neither end, and the route would refuse it.
	const third = resolveDrop(
		recallDrag,
		{ kind: "device", deviceId: THIRD },
		context,
	);
	assert.equal(third.kind, "refused");
	assert.equal(third.code, "third_device");

	// A lane holds devices, not conversations.
	const lane = resolveDrop(
		offloadDrag,
		{ kind: "network", networkId: NET_HOME },
		context,
	);
	assert.equal(lane.kind, "refused");
	assert.equal(lane.code, "not_a_device");
	assert.match(lane.sentence, /lives on a device/);

	// Ground is not a target either.
	assert.equal(
		resolveDrop(offloadDrag, { kind: "ground" }, context).kind,
		"none",
		"a drop on empty ground is a change of mind, not an error to report",
	);
});

test("the two facts that outrank reachability refuse the drop before the route is asked", () => {
	const { context } = dropFixture();
	const payload = drag(session(), SELF, SELF_LABEL);
	const local = session();
	const suspect = resolveDrop(
		payload,
		{ kind: "device", deviceId: SUSPECT },
		context,
	);
	assert.equal(
		suspect.code,
		"suspect_device",
		"a duplicated key is a security fact",
	);
	const burned = resolveDrop(
		payload,
		{ kind: "device", deviceId: BURNED },
		context,
	);
	assert.equal(burned.code, "revoked_membership");
	/*
	 * The client's two are NOT spelled as move codes: `MOVE_REFUSAL_CODES` has no
	 * `suspect_device` and no `revoked_membership`, so a reader can tell which side
	 * decided - the route saying no, or this app refusing to ask.
	 */
	/*
	 * The two client-local codes are the APP's, and the file says so where it names
	 * them: the alternative - a mirrored copy of the backend's `MOVE_REFUSAL_CODES` -
	 * is a list that drifts silently, and the route is the only thing that owns it.
	 */
	const drop = source("src/renderer/src/features/mesh/mesh-drop.ts");
	assert.match(drop, /client-side two are named/);
	assert.match(drop, /not_a_device/);
});

test("a busy session refuses rather than being interrupted, and offers the wait", () => {
	const { context } = dropFixture();
	const busy = session({ live_state: "busy" });
	const verdict = resolveDrop(
		drag(busy, SELF, SELF_LABEL),
		{ kind: "device", deviceId: PEER },
		context,
	);
	assert.equal(verdict.kind, "refused");
	assert.equal(verdict.code, "busy");
	assert.equal(verdict.remedy.kind, "wait");
	assert.equal(
		verdict.remedy.waitS,
		300,
		"the route's own ceiling on waiting inside the request",
	);
	/*
	 * AND THE REFUSAL CARRIES THE MOVE IT REFUSED (agent review round 1, F2). Without it
	 * the notice's "Wait for the turn to finish" had nothing to re-issue: the page read the
	 * plan off a `pendingMove` that this path never set, so the button was drawn and inert
	 * on every path that can produce a `busy` refusal.
	 */
	assert.ok(verdict.plan, "the refusal names the move the remedy re-issues");
	assert.equal(verdict.plan.to, PEER);
	assert.equal(verdict.plan.keep, false);
	assert.match(verdict.plan.verb, /^Move to /);
	assert.match(hoverSentence(verdict), /^Drop will be refused: /);
});

test("the busy remedy is EXECUTED, not merely drawn (agent review round 2, F2)", () => {
	/*
	 * ROUND 1 FIXED THE INERT BUTTON AND ROUND 2 MEASURED THAT NOTHING PRESSED IT. The read
	 * path that makes it work - `moveReport.plan` reaching `run(plan, WAIT_FOR_IDLE_S)` - had
	 * no pin of any kind, and `MoveRefusedBusy`'s own play stops at `findByText` because
	 * pressing the button replaces the notice that row's claim is about. Three things hold it
	 * now: the guard, the notice's own decision to draw the button, and a story whose play
	 * clicks it and asserts the request that went out.
	 */
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(
		page,
		/if \(moveReport\?\.kind !== "refused" \|\| !moveReport\.plan\) return;/,
		"the handler refuses to re-issue a move it does not have",
	);
	assert.match(page, /run\(moveReport\.plan, WAIT_FOR_IDLE_S\)/);
	assert.match(
		page,
		/canWait=\{\s*moveReport\.kind === "refused" &&\s*moveReport\.plan !== null\s*\}/,
		"and the same fact is handed to the notice, so the button is drawn only when pressing it acts",
	);
	const actions = source("src/renderer/src/features/mesh/mesh-actions.tsx");
	assert.match(
		actions,
		/refusal\?\.code === "busy" && canWait &&/,
		"the notice owns the decision rather than the code being enough on its own",
	);
	/*
	 * AND THE CLICK IS DRIVEN SOMEWHERE THAT RUNS. The story's play wraps the same bridge the
	 * page uses, presses the button and throws unless exactly one transfer went out carrying
	 * `waitS: 300` - the route's own ceiling. `expectSentence` on the capture row ties the
	 * frame to that outcome, so a regression fails the capture rather than a still.
	 */
	const stories = source(
		"src/renderer/src/features/mesh/mesh-page.stories.tsx",
	);
	assert.match(stories, /export const MoveBusyWaited: Story = \{/);
	assert.match(
		stories,
		/if \(transfers\[0\]\.waitS !== 300\)/,
		"the re-issue must carry the wait ceiling, not the gesture's default",
	);
	assert.match(
		stories,
		/the busy refusal sends nothing, and the remedy sends ONE move/,
	);
	const rig = source("scripts/capture-evidence.mjs");
	assert.match(
		rig,
		/"mesh-tab--move-busy-waited",/,
		"the executed remedy has its own row",
	);
	assert.match(
		rig,
		/\{ expectSentence: "holds it now" \}/,
		"and that row carries a claim, so it cannot silently photograph the refusal again",
	);
});

test("the asking story photographs the asking state", () => {
	/*
	 * THE SPLIT IS THE FIX, SO THE SPLIT IS PINNED (agent review round 4, R4-3). A
	 * story whose `play` runs on every view is a story whose still is not the state
	 * it is named for - the design round found `approvals-waiting` photographing the
	 * POST-decision registers for exactly that reason. Nothing pinned the split, so
	 * a later edit could move the `play` back and no test would say a word.
	 */
	const stories = source(
		"src/renderer/src/features/mesh/mesh-page.stories.tsx",
	);
	const story = (name) => {
		const at = stories.indexOf(`export const ${name}: Story = {`);
		assert.notEqual(at, -1, `${name} must exist`);
		const next = stories.indexOf("export const ", at + 10);
		return next === -1 ? stories.slice(at) : stories.slice(at, next);
	};
	assert.doesNotMatch(
		story("ApprovalsWaiting"),
		/play: async/,
		"the asking story must render the ask, not press the button on the way to photographing it",
	);
	assert.match(
		story("ApprovalsDecisionWrites"),
		/play: async/,
		"and the write path keeps its own story, where the play is what it is named for",
	);
});

test("the wait ceiling is carried from the click to the wire, and the pin fails where it matters (round 3)", () => {
	/*
	 * THE ROUND-3 MAJOR, AND IT WAS ABOUT THE GUARD RATHER THAN THE CODE. The story presses the
	 * button, but its assertions sat INSIDE a retrying `waitFor`, and the capture rig reads the
	 * console for play failures before such a rejection lands - so with the wait dropped anywhere on
	 * the way, the rig reported success and wrote the frame anyway. Reverting either of the two lines
	 * below left this suite green, which is what made that possible.
	 *
	 * Each pin names `waitS` in its message, so the run that goes red says which value stopped
	 * travelling.
	 */
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(
		page,
		/waitS: waitS \?\? plan\.waitS,/,
		"`waitS` must reach the ask from the click that asked for it, falling back to the plan's own ceiling",
	);
	const store = source("src/renderer/src/features/mesh/mesh-store.ts");
	assert.match(
		store,
		/waitS: ask\.waitS \?\? 0,/,
		"and the request must send that `waitS` rather than a constant",
	);
	/*
	 * AND THE ASSERTION MUST NOT BE INSIDE A RETRY. The story waits for the OUTCOME and then checks
	 * once, synchronously, so a wrong `waitS` throws on the spot instead of after a `waitFor`
	 * budget the rig has already stopped watching.
	 */
	const stories = source(
		"src/renderer/src/features/mesh/mesh-page.stories.tsx",
	);
	assert.match(
		stories,
		/findByText\("Moved"\)[\s\S]{0,1200}const transfers = sent\.filter/,
		"the outcome is awaited first and the `waitS` check runs after it",
	);
	assert.doesNotMatch(
		stories,
		/waitFor\(\(\) => \{[\s\S]{0,80}const transfers = sent\.filter/,
		"and the check is NOT wrapped in a retrying `waitFor`, which is the shape that could not fail",
	);
});

test("the chip's spoken fact reads the reach model, and its stripe the same reachability (U13/Q1)", () => {
	/*
	 * U9 ONE LAYER UP (agent review round 3, U13). The stripe and `resolveDrop` were reconciled onto
	 * the owner DEVICE's reachability, while the chip's `title` and `aria-label` still asked the
	 * session ROW's copy - so in the mismatch a screen reader announced "on this device" beside a
	 * stripe saying the drop will be refused. The name is the version that is read aloud, so it
	 * cannot be the stale one.
	 *
	 * AND THE SENTENCE TAKES THE REACH MODEL'S WORD (agent review round 1, Q1). It still said
	 * `unreachable` for a not-attempted device - the word every drawn surface had just stopped
	 * saying, on the one surface that is READ ALOUD - so the fact now takes `reachWords(ownerReach)`
	 * and the second vocabulary for one state is gone from this file.
	 */
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	assert.match(
		node,
		/export function chipFact\(\s*session: MeshSessionRow,\s*ownerLabel: string,\s*ownerReach: DeviceReach,\s*\)/,
		"`chipFact` takes the device's own reach",
	);
	assert.match(
		node,
		/if \(ownerReach !== "reached" && ownerReach !== "self"\) \{/,
		"and decides on it rather than on `session.reachable`",
	);
	assert.doesNotMatch(
		node,
		/if \(!session\.reachable\) \{/,
		"the row's copy is gone from the sentence",
	);
	assert.match(
		node,
		/const words = reachWords\(ownerReach\)/,
		"the word is the reach model's, not `unreachable`",
	);
	assert.doesNotMatch(
		node,
		/`unreachable\$\{/,
		"and the chip stops saying a word no drawn surface says",
	);
	assert.match(node, /chipFact\(session, ownerLabel, ownerReach\)/);
	const card = source("src/renderer/src/features/mesh/mesh-card.tsx");
	assert.match(
		card,
		/chipFact\(session, device\.label, deviceReach\(device\)\)/,
	);
});

test("the renderer sizes its deadline from the REQUEST, and its give-up carries the move's code (F1)", () => {
	const api = source(
		"src/renderer/src/shared/api/local-operator/desktop-api.ts",
	);
	/*
	 * THE CALL SITE, NOT ONLY THE ARITHMETIC. The suite pinned the object form of
	 * `desktopRequestTimeoutMs` while the one shipped caller passed `request.op`, so the
	 * whole-request branch the contract documents was dead code exactly where it mattered:
	 * a transfer got the 20 s control budget against a route that publishes 145-415 s, and
	 * the give-up rejected with no code, so the surface reported a sent move as a refusal
	 * that changed nothing. Both halves are pinned here.
	 */
	assert.match(
		api,
		/withDeadline\(\s*window\.api\.desktop\.request\(request\),\s*request,?\s*\)/,
		"the request is passed, not its op: the transfer's bound is sized from the request",
	);
	assert.doesNotMatch(
		api,
		/withDeadline\([^)]*request\.op/,
		"the op string is the shape that gave a move the 20 s control budget",
	);
	assert.match(
		api,
		/function withDeadline\(\s*pending: Promise<DesktopResponse>,\s*request: DesktopRequest,\s*\)/,
		"the parameter is the request, which is what the deadline is derived from",
	);
	assert.match(api, /desktopRequestTimeoutMs\(request\)/);
	assert.match(
		api,
		/const timeoutMs = desktopRequestTimeoutMs\(request\);/,
		"the value the give-up names is the TIMEOUT the timer runs on (agent review round 2, NIT): named `deadlineMs` it read as the smaller deadline while holding the larger timeout",
	);
	assert.match(
		api,
		/desktopRequestDeadlineDetail\(\s*request\.op,\s*timeoutMs,?\s*\)/,
		"the give-up takes the op's own code and sentence from the contract's one authority",
	);
	assert.match(
		api,
		/\}, timeoutMs\);/,
		"ONE VALUE FOR BOTH: the timer that fires and the seconds the sentence quotes are the same variable, so the copy cannot drift from the wait by the deadline's margin",
	);
	assert.match(api, /detail\.code/);
});

test("a move that outran the app's own deadline is unconfirmed, never 'nothing changed' (F1)", () => {
	const refused = meshRefusal({
		code: "deadline_exceeded",
		status: null,
		message: "the app stopped waiting",
	});
	assert.equal(
		refused.unconfirmed,
		true,
		"the request was sent and the outcome is unknown, which is the other instruction entirely",
	);
	assert.equal(refused.code, "deadline_exceeded");
	// The control: a refusal that DID observe the backend stays actionable.
	assert.equal(
		meshRefusal({ code: "not_a_device", status: null, message: "no" })
			.unconfirmed,
		false,
	);
});

test("a keep receipt that omits the new id is refused rather than renamed (F6)", () => {
	const receipt = {
		session_id: "a".repeat(12),
		mode: "keep",
		locality: "remote",
		owner_device: `d_${"b".repeat(32)}`,
		source_retired: false,
		phases: [],
	};
	assert.equal(
		transferReceipt(receipt),
		null,
		"a keep receipt without the minted id cannot say which chip moved or what the undo acts on",
	);
	const moved = transferReceipt({ ...receipt, mode: "move" });
	assert.ok(
		moved,
		"a move's receipt documents new_session_id as equal to the source",
	);
	assert.equal(moved.new_session_id, receipt.session_id);
});

test("confirm by risk: every destructive move confirms, and a live runtime is named", () => {
	const { context } = dropFixture();
	const quiet = resolveDrop(
		drag(session(), SELF, SELF_LABEL),
		{ kind: "device", deviceId: PEER },
		context,
	);
	assert.equal(quiet.risky, false);
	const quietConfirm = planConfirm(quiet.plan, quiet.risky);
	assert.ok(quietConfirm, "a move deletes the source's copy, so it confirms");
	assert.doesNotMatch(quietConfirm.body, /running/);

	const live = resolveDrop(
		drag(session({ live_state: "attached" }), SELF, SELF_LABEL),
		{ kind: "device", deviceId: PEER },
		context,
	);
	assert.equal(live.risky, true);
	const liveConfirm = planConfirm(live.plan, live.risky);
	assert.match(liveConfirm.body, /running on this device right now/);
	assert.equal(liveConfirm.risky, true);
	assert.equal(
		planConfirm(live.alternatives[0], live.risky),
		null,
		"the copy never confirms: its undo is the erasure of what it made",
	);
});

test("the drag reducer: a press is not a drag until it travels, and nothing outlives its pointer", () => {
	const payload = drag(session(), SELF, "damians-MacBook-Pro");
	let state = dragReducer(IDLE_DRAG, {
		kind: "press",
		payload,
		x: 100,
		y: 100,
		pointerId: 1,
	});
	assert.equal(state.kind, "pressing");
	assert.equal(
		draggedSessionId(state),
		null,
		"a chip is not marked as lifted while it may still be a click",
	);
	state = dragReducer(state, {
		kind: "move",
		x: 102,
		y: 101,
		target: { kind: "device", deviceId: PEER },
	});
	assert.equal(
		state.kind,
		"pressing",
		"under the threshold it is still a click",
	);
	state = dragReducer(state, {
		kind: "move",
		x: 100 + DRAG_THRESHOLD_PX + 1,
		y: 100,
		target: { kind: "device", deviceId: PEER },
	});
	assert.equal(state.kind, "dragging");
	assert.equal(draggedSessionId(state), payload.session.id);
	// A second pointer cannot lift a second chip.
	assert.equal(
		dragReducer(state, {
			kind: "press",
			payload: drag(session({ id: "ffffffffffff" }), SELF, "here"),
			x: 500,
			y: 500,
			pointerId: 2,
		}).payload.session.id,
		payload.session.id,
	);
	// The release settles over the target the pointer was ACTUALLY over.
	const settled = dragReducer(state, { kind: "release" });
	assert.equal(settled.kind, "settling");
	assert.deepEqual(settled.target, { kind: "device", deviceId: PEER });
	assert.equal(dragReducer(settled, { kind: "settled" }).kind, "idle");
	// A press that never travelled is a click, and a cancel never leaves a ghost.
	const pressed = dragReducer(IDLE_DRAG, {
		kind: "press",
		payload,
		x: 1,
		y: 1,
		pointerId: 3,
	});
	assert.equal(dragReducer(pressed, { kind: "release" }).kind, "idle");
	assert.equal(
		dragReducer(
			{
				kind: "dragging",
				payload,
				x: 1,
				y: 1,
				target: { kind: "ground" },
				pointerId: 4,
			},
			{ kind: "cancel" },
		).kind,
		"idle",
	);
});

test("sessions file under the device that holds them, capped, with orphans counted", () => {
	const rows = sessionRows({
		sessions: [
			session({ id: "000000000001", name: "mine" }),
			session({
				id: "000000000002",
				name: "theirs",
				locality: "remote",
				owner_device: PEER,
				owner_device_name: "devon-laptop",
			}),
			session({
				id: "000000000003",
				name: "nobody",
				locality: "remote",
				owner_device: `d_${"f".repeat(32)}`,
				owner_device_name: "vanished",
			}),
		],
	});
	assert.equal(rows.length, 3);
	assert.equal(
		ownerOf(rows[0], SELF),
		SELF,
		"a local row's owner is this device",
	);
	assert.equal(ownerOf(rows[1], SELF), PEER);
	const join = sessionsByDevice(rows, SELF, [SELF, PEER, BURNED]);
	assert.equal(join.byDevice.get(SELF).rows.length, 1);
	assert.equal(join.byDevice.get(PEER).rows.length, 1);
	assert.equal(
		join.byDevice.get(BURNED).rows.length,
		0,
		"every drawn device has an entry, empty or not",
	);
	assert.equal(
		join.orphans,
		1,
		"a row nobody drew is counted, never silently dropped",
	);

	// The cap: a node shows a bounded handful and says how many it is not showing.
	const many = Array.from({ length: CHIP_LIMIT + 5 }, (_, index) =>
		session({ id: String(index).padStart(12, "0"), name: `chat ${index}` }),
	);
	const capped = sessionsByDevice(many, SELF, [SELF]).byDevice.get(SELF);
	assert.equal(capped.shown.length, CHIP_LIMIT);
	assert.equal(capped.hidden, 5);
	assert.equal(capped.rows.length, many.length);
	// And the total prefers the catalogue's count when it is larger than the page.
	assert.equal(deviceSessionTotal(capped, 42), 42);
	assert.equal(deviceSessionTotal(capped, null), many.length);
});

test("the transfer receipt is read as a value, and an unreadable one is not a success", () => {
	const receipt = transferReceipt({
		locality: "remote",
		owner_device: PEER,
		source_retired: true,
		session_id: "0123456789ab",
		new_session_id: "0123456789ab",
		mode: "move",
		phases: [{ phase: "prepared", peer: PEER, progress: 0.25 }],
	});
	assert.equal(receipt.mode, "move");
	assert.equal(receipt.source_retired, true);
	assert.equal(receipt.phases.length, 1);
	assert.equal(
		transferReceipt({ locality: "local" }),
		null,
		"no session id, no claim",
	);
	const refusal = meshRefusal({
		code: "busy",
		message: "a turn is in flight",
		status: 409,
	});
	assert.equal(refusal.unconfirmed, false);
	assert.equal(
		refusal.sentence,
		"a turn is in flight",
		"the route's words, verbatim",
	);
	const unconfirmed = meshRefusal({
		code: "deadline_exceeded",
		message: "the app stopped waiting",
		status: 503,
	});
	assert.equal(unconfirmed.unconfirmed, true);
});

test("the one gesture the protocol refuses is not a drag, and every drag has a menu", () => {
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	// A DEVICE is not draggable: the node's button opens the panel and starts nothing.
	const buttonStart = node.indexOf("data-mesh-device-open=");
	assert.ok(buttonStart > 0, "the node's own button is addressable");
	const deviceButton = node.slice(buttonStart, node.indexOf(">", buttonStart));
	assert.doesNotMatch(
		deviceButton,
		/onPointerDown|onPointerDownCapture|draggable/,
		"a device dragged into a network would promise an add the protocol declines; the invite is an ACTION, and the node's own button starts no drag",
	);
	// The affordance that DOES admit a device, where a reader meets it.
	const card = source("src/renderer/src/features/mesh/mesh-card.tsx");
	assert.match(card, /Invite to a network/);
	// And every drag outcome is reachable from a menu (the plan's accessibility rule).
	assert.match(card, /export const SessionMoveMenu/);
	assert.match(
		card,
		/data-mesh-session-menu=/,
		"the menu's trigger is addressable",
	);
	const list = source("src/renderer/src/features/mesh/mesh-list.tsx");
	assert.match(
		list,
		/<SessionMoveMenu/,
		"the list carries the same menu per row",
	);
	assert.match(
		list,
		/destinationsWithVerdicts\(/,
		"from the same destination arithmetic, and the same verdict the drag would give it",
	);
});

test("a refusal is rendered from the receipt rather than paraphrased", () => {
	const actions = source("src/renderer/src/features/mesh/mesh-actions.tsx");
	assert.match(
		actions,
		/\{receipt \? receipt\.verb : refusal\?\.sentence\}/,
		"the route's sentence reaches the screen unchanged",
	);
	assert.match(
		actions,
		/\{refusal\?\.code\}/,
		"with its code beside it, so a support conversation and a log agree",
	);
	assert.match(actions, /Wait for the turn to finish/);
	/*
	 * THE UNDO'S LABEL IS THE PLAN'S OWN VERB (agent review round 1, F3 / UX U4): the button
	 * said "Erase the copy" while the request it sent was a recall that leaves this device
	 * holding a second copy of the conversation. Pinned as the expression, so a literal
	 * cannot come back beside it.
	 */
	assert.match(actions, /\{receipt\.undo\.verb\}/);
	assert.doesNotMatch(
		actions,
		/>\s*Erase the copy\s*</,
		"the button's label is the plan's verb, and no literal sits beside it",
	);
});

/* ------------------------------------------- the remediation round's invariants */

test("a shrunken viewport brings the selected node back rather than fitting again (D1)", () => {
	/*
	 * THE FIX IS A CLAMP, NOT A RE-FIT: scale is the reader's, and a panel toggle may not
	 * throw away their pan and zoom. Pure, so the property is checkable without pixels - the
	 * measured defect was 26 px of a 200 px node left on screen at 1024x768 with the panel
	 * open, against the same two nodes whole with it closed.
	 */
	const wide = { width: 1072, height: 700 };
	const narrow = { width: 736, height: 700 };
	const box = { x: 600, y: 100, height: 72 };
	const fitted = fitTransform({ width: 1000, height: 600 }, wide);
	const kept = keepNodeVisible(fitted, box, narrow);
	assert.equal(kept.k, fitted.k, "the reader's scale is not touched");
	assert.notEqual(
		kept.tx,
		fitted.tx,
		"the world moves by what the clamp needs",
	);
	const right = kept.tx + (box.x + NODE_WIDTH) * kept.k;
	assert.ok(
		right <= narrow.width - 16 + 0.001,
		`the node's right edge is inside the box (${right.toFixed(1)} <= ${narrow.width - 16})`,
	);
	/*
	 * ALREADY INSIDE IS A NO-OP, and the margin is part of "inside": a node sitting 10 px
	 * from the edge is nudged to the margin, which is the clamp doing its job rather than a
	 * bug to assert around.
	 */
	const inside = { k: 1, tx: 0, ty: 0 };
	assert.deepEqual(
		keepNodeVisible(inside, { x: 100, y: 100, height: 72 }, wide),
		inside,
	);
	assert.equal(
		keepNodeVisible(inside, { x: 4, y: 4, height: 72 }, wide).tx,
		12,
		"a node whose left edge is under the margin is translated BY the difference, so the edge lands on it",
	);
});

test("the chip row fits by construction, so both chips and the control are hittable (Q-1/U2)", () => {
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	/*
	 * THE TWO HALVES OF ONE DEFECT, and both are structural rather than numeric: the chips
	 * SHARE the row (`min-w-0 flex-1`, so no chip can sit outside the box that clips it) and
	 * the `+N more` control is a `shrink-0` CHILD of that same row, so the affordance that
	 * reaches the rest cannot be the thing the row clips. Measured before the fix: chip 0
	 * inside, chip 1 half-clipped, chips 2-3 outside, and the control 315 px past the row's
	 * right edge with `hittable: false`.
	 */
	assert.match(
		node,
		/className="min-w-0 flex-1"/,
		"a chip shares the row rather than overflowing it",
	);
	assert.match(
		node,
		/min-h-6 w-full max-w-32 items-center/,
		"and its button fills that share at the band's own 24 px target height (U7)",
	);
	assert.match(
		node,
		/min-w-0 flex-1 truncate/,
		"with the truncation on the one span that can still ellipsise, because the button had to become a flex row to reach 24 px (U7)",
	);
	assert.match(
		node,
		/<li className="shrink-0">/,
		"the control keeps its own width",
	);
	assert.match(
		node,
		/data-mesh-more=\{device\.id\}/,
		"the +N more control is inside the row that clips",
	);
	assert.equal(
		CHIP_LIMIT,
		2,
		"two chips and the control are what a 195 px row holds; four measured 611 px of content",
	);
});

test("the cap's two chips stay legible, and the title's head survives the truncation (D8/U10; operator report 2026-10-04)", () => {
	/*
	 * THE CONTROL PAYS FOR THE CHIPS (design review round 2, D8). At the cap the row holds two
	 * chips and the overflow control; the control's full `+4 more` label measured 59.4 px of the
	 * row's 171 px content box, which left each chip a **51.8 px box** - of which **37.8 px is
	 * text** (the chip's 12 px of padding and its borders take the rest, and round 3's D15 is
	 * right that the earlier sentence here called that 49 px). Seven characters of a
	 * twenty-one character title, two truncations that read `Swe…` and `Res…`. `+4` costs 27.3 px,
	 * so each chip gets a 67.9 px box and **53 px of text**.
	 */
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	assert.match(
		node,
		/\+\{sessions\.hidden\}/,
		"the control's visible label is the compact one",
	);
	assert.doesNotMatch(
		node,
		/\+\{sessions\.hidden\} more/,
		"and the word that cost the chips 32 px is gone from the row",
	);
	assert.match(
		node,
		/aria-label=\{`Show all \$\{sessionTotal\} conversations`\}/,
		"the affordance moves to the accessible name, which costs no width",
	);
	/*
	 * AND THE CHIPS KEEP THE HEAD (operator report, 2026-10-04 - superseding the
	 * left-truncation round 2 chose for series names, D8/U10). The report's chips read
	 * `…BE-OK` and `…2E pull`, the tails of its own titles, and the finding is that they
	 * "identify nothing": a conversation's name is a human title whose identity is
	 * front-loaded, and every other surface that truncates one in this app shows the head.
	 * What that trades away is stated at the span: a series differing only past the visible
	 * head (`Sweep 011` / `Sweep 012` at the cap) shares a prefix on the chip, and the
	 * full name stays one hover (title) and one press (the panel) away.
	 */
	assert.doesNotMatch(
		node,
		/\[direction:rtl\]/,
		"the chip truncates at the END, where the title's identity is not - the left-truncation spelling is gone",
	);
	assert.match(
		node,
		/min-w-0 flex-1 truncate/,
		"and the one span that can still ellipsise carries the head",
	);
	assert.doesNotMatch(
		node,
		/chipDisplayLabel/,
		"and no character count is guessing at what fits",
	);
	assert.match(
		node,
		/title=\{`\$\{chipLabel\(session\)\} · \$\{fact\}`\}/,
		"the full title is still the tooltip, and the accessible name below it",
	);
});

test("the menu refuses a destination the drag would, before the choice (U3)", () => {
	const card = source("src/renderer/src/features/mesh/mesh-card.tsx");
	// The annotation is the same resolver the drop uses, so menu and drag cannot disagree.
	assert.match(
		card,
		/export function destinationsWithVerdicts/,
		"one resolver for both surfaces",
	);
	assert.match(
		card,
		/refused:\s*verdict\.kind === "refused" && verdict\.code !== "busy"/,
		"a busy destination stays offered, because the wait remedy is only reachable by asking",
	);
	assert.match(card, /disabled=\{Boolean\(destination\.refused\)\}/);
	assert.match(card, /title=\{destination\.refused \?\? undefined\}/);
	// The page and the list both go through it, so neither surface keeps its own copy.
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(page, /destinationsWithVerdicts\(graph, session, selfLabel\)/);
	const list = source("src/renderer/src/features/mesh/mesh-list.tsx");
	assert.match(
		list,
		/destinationsWithVerdicts\(\s*graph,\s*session,\s*selfLabel,?\s*\)/,
	);
});

test("a drag's release does not open the panel, and Escape cancels a drag (U1/U5)", () => {
	const canvas = source("src/renderer/src/features/mesh/mesh-canvas.tsx");
	// The flag is set on the ONE transition that makes the gesture a drag, cleared on the
	// next press, and consumed by the chip's click.
	assert.match(canvas, /dragEndedAsDrag\.current = true;/);
	assert.match(canvas, /dragEndedAsDrag\.current = false;/);
	assert.match(canvas, /if \(dragEndedAsDrag\.current\) \{/);
	assert.match(canvas, /case "Escape":/);
	assert.match(
		canvas,
		/dragReducer\(current, \{ kind: "cancel" \}\)/,
		"Escape uses the reducer's own cancel rather than a second way to end a gesture",
	);
	/*
	 * AND THE CANCEL TAKES THE TRAILING CLICK WITH IT (UX review round 2, U8). Round 1's fix
	 * suppressed the click a RELEASE leaves, keyed to the `dragging -> release` transition - and
	 * the cancel path never set it, so a reader who pressed Escape and then let go got the panel
	 * they had cancelled (measured: the panel opened and the canvas fell 1072 -> 736 px, while
	 * the same gesture without the Escape keystroke opened nothing). Both cancel paths now set
	 * the same flag, and the flag stays false for a press that never travelled - which is still
	 * a click and still opens the panel.
	 */
	assert.equal(
		(
			canvas.match(
				/if \(drag\.kind === "dragging"\) dragEndedAsDrag\.current = true;/g,
			) ?? []
		).length,
		2,
		"both cancels - the Escape key and the browser's own pointercancel - suppress the echo",
	);
});

test("Escape closes the panel, and hands focus back to the node that opened it (U5)", () => {
	const card = source("src/renderer/src/features/mesh/mesh-card.tsx");
	/*
	 * The panel had no keyboard exit: measured, `Escape` with focus on its own `Close`
	 * left it open, while the canvas beside it already owns `Escape` for a drag-cancel -
	 * so a keyboard reader had to Tab back out. The listener is on the window (the panel
	 * spans its own controls and the canvas), and the two guards are what keep the key
	 * from being stolen from a surface that already means it.
	 */
	assert.match(card, /if \(event\.key !== "Escape"\) return;/);
	assert.match(
		card,
		/if \(event\.defaultPrevented\) return;/,
		"a drag-cancelled Escape (the canvas preventDefaults it) is not also a panel close",
	);
	assert.match(
		card,
		/\[role="menu"\],\[role="dialog"\]/,
		"and an Escape inside a menu or dialog belongs to that overlay",
	);
	assert.match(
		card,
		/querySelector<HTMLElement>\(`\[data-mesh-device-open="\$\{device\.id\}"\]`\)/,
		"focus goes back to the opener BEFORE the close, while it is still mounted",
	);
	assert.match(card, /window\.addEventListener\("keydown", onKeyDown\)/);
});

/* ------------------------------------------------------- review round 2 (R2-1) */

test("the rail's membership read does not poll: the always-mounted component fans out to nobody", () => {
	/*
	 * R2-1's defect: `useMeshMembership` called `useMeshNetworks(enabled)` with no
	 * options, so the RAIL - mounted on every route by `app.tsx` - inherited this file's
	 * 30 s interval. One poll is `net_peer_ls`, which dials every peer, plus a `net_show`
	 * per network, so a member device fanned out to every peer every 30 seconds for the
	 * life of the window, on any screen. The fix is the `poll: false` observer, and these
	 * four assertions are the pin that keeps it.
	 */
	const store = source("src/renderer/src/features/mesh/mesh-store.ts");
	assert.match(
		store,
		/export function useMeshNetworks\(\s*enabled: boolean,\s*\{ poll = true \}: \{ poll\?: boolean \} = \{\},\s*\)/,
		"the hook takes the cadence as an option rather than hard-coding it",
	);
	assert.match(
		store,
		/useMeshNetworks\(enabled, \{ poll: false \}\)/,
		"and the membership hook - the rail's only reader - asks for the non-polling one",
	);
	assert.match(
		store,
		/refetchInterval: enabled && poll \? MESH_POLL_MS : false/,
		"the 30 s cadence is reachable only through the polling observer",
	);
	assert.match(
		store,
		/staleTime: poll \? 10_000 : Number\.POSITIVE_INFINITY/,
		"the non-polling observer cannot be woken by a mount or a focus either",
	);
	/*
	 * THE FOCUS LEG, which this pin's first version left to a reader's inference (review round 3,
	 * R3-3). `refetchOnWindowFocus` is the branch's THIRD wake-up path: a window that loses and
	 * regains visibility is an ordinary event on a desktop app, and this app's own
	 * `defaultQueryOptions` sets it `true` (`shared/api/query-client.ts`), so a rail that did not
	 * switch it off would be woken by every alt-tab - the same fan-out the interval was.
	 *
	 * THE BEHAVIOUR BEHIND IT, measured rather than asserted here: the reviewer's own probe drove
	 * a `visibilitychange` transition and counted refetches - rail observer 0, page observer 1
	 * (the control), and the rail under a `--defect` regression 1, so the zero is a reading and
	 * not a vacuous pass. This pin holds the wiring that probe validated; the harness in this
	 * session's scratchpad is where the count itself is reproduced.
	 */
	assert.match(
		store,
		/refetchOnWindowFocus: poll,/,
		"the focus leg follows the same observer split as the interval, so the rail cannot be woken by an alt-tab",
	);
	assert.match(
		source("src/renderer/src/shared/api/query-client.ts"),
		/refetchOnWindowFocus: true,/,
		"and the app's own default is the opposite, which is why the rail has to say so itself",
	);
	assert.match(
		source(
			"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
		),
		/const meshMembership = useMeshMembership\(meshPaired\);/,
		"the rail reads membership through that hook, so the pin above is about the rail",
	);
});

test("the keep-in-view margin is SLACK, so an overflowing world loses only what it must (D10)", () => {
	/*
	 * The clamp is right and the margin was spending a neighbour's pixels (design review round 2,
	 * D10). At 1024x768 with the panel open the world is 602 px against a 591 px canvas, so
	 * something must be outside - and the flat 16 px margin spent 16 of those pixels on a device
	 * the reader had not asked about (measured: the network node lost ~23 px, icon included).
	 * Executed here with both margins, so the arithmetic is a reading rather than a comment.
	 */
	const viewport = { width: 1024, height: 768 };
	// A box that overflows the right edge at k=1, which is the state the panel opening creates.
	const box = { x: 900, y: 100, height: 72 };
	const flush = keepNodeVisible({ k: 1, tx: 0, ty: 0 }, box, viewport, 0);
	assert.equal(
		flush.tx + box.x + NODE_WIDTH * flush.k,
		viewport.width,
		"a zero margin lands the clicked node's right edge exactly on the canvas edge",
	);
	const breathing = keepNodeVisible({ k: 1, tx: 0, ty: 0 }, box, viewport, 16);
	assert.equal(
		breathing.tx + box.x + NODE_WIDTH * breathing.k,
		viewport.width - 16,
		"and the margin is what buys the gap, which is only affordable when there is slack",
	);
	const canvas = source("src/renderer/src/features/mesh/mesh-canvas.tsx");
	assert.match(
		canvas,
		/clipWidth: element\.clientWidth,/,
		"the viewport record keeps the clip box as well as the border box (QA round 3, Q-1)",
	);
	assert.match(
		canvas,
		/const clip = \{ width: viewport\.clipWidth, height: viewport\.clipHeight \};/,
		"and the clamp is solved against it: `overflow: hidden` clips at the padding edge, so a node clamped to the border box loses its last pixel",
	);
	assert.match(
		canvas,
		/keepNodeVisible\(\s*current,\s*box,\s*clip,\s*Math\.min\(KEEP_MARGIN_PX, slack\),\s*\)/,
		"both the clamp and its slack read the same box, or the margin is a pixel too generous",
	);
});

test("a token path breaks between its segments, not inside a filename (D11)", () => {
	/*
	 * Both palettes photographed `.../invites/devon-la` / `ptop.token` (design review round 2,
	 * D11): a path split mid-word in the one line this dialog asks a reader to copy, which reads
	 * as two different paths. The break opportunities now sit after the separators, and the
	 * element keeps `break-words` as the fallback for a segment longer than the line.
	 */
	const actions = source("src/renderer/src/features/mesh/mesh-actions.tsx");
	assert.match(actions, /\.split\("\/"\)\s*\.flatMap/);
	assert.match(actions, /<wbr key=\{`path-break-\$\{start\}`\} \/>/);
	/*
	 * AND EACH SEGMENT IS UNBREAKABLE, which the `<wbr>`s alone were not enough for: shot on this
	 * branch's own re-capture, the wrap still fell inside the name (`.../invites/devon-` /
	 * `laptop.token`) because a hyphen is its own break opportunity. The span is what keeps a
	 * file name whole; the `<wbr>` after each slash is what keeps the wrap at a separator.
	 */
	assert.match(actions, /className="whitespace-nowrap"/);
	assert.match(actions, /break-words font-mono text-meta text-ink/);
	assert.doesNotMatch(
		actions,
		/break-all font-mono text-meta text-ink/,
		"`break-all` is what split the filename; it is gone rather than joined by `<wbr>`",
	);
});

/* ----------------------------------------- the canvas's second layer */

/**
 * THE SCOPE LAYER'S THREE TIERS, and the refusal that is easiest to get wrong.
 *
 * A device's published addresses are the only input, and they are weak evidence: two
 * machines on two unrelated WireGuard tunnels share `10.88.0.0/24` while sharing no path
 * at all. So the layer draws a SOLID boundary only where one side of the comparison is an
 * interface this process runs on, a DASHED one where two peers merely agree, and NOTHING
 * otherwise - and an address two devices claim contributes to no group, because that is a
 * data anomaly (a copied config, a stale record) rather than a shared path.
 */
test("the scope layer draws three tiers, and refuses a duplicate address", () => {
	const addresses = {
		self: ["192.168.1.10:4097"],
		wireguard: ["10.88.0.7:4097"],
		wireguardPeer: ["10.88.0.4:4097"],
		lanPeer: ["192.168.1.40:4097"],
		colo: ["203.0.113.9:4097"],
	};
	const build = (overrides = {}) =>
		meshGraph({
			topology: networkTopology({
				self_device_id: DEVICE_A,
				networks: [
					network(NET_ONE, [
						member(DEVICE_A, {
							endpoints: addresses.self,
							...(overrides.self ?? {}),
						}),
						member(DEVICE_B, {
							endpoints: addresses.wireguard,
							...(overrides.b ?? {}),
						}),
						member(DEVICE_C, {
							endpoints: addresses.wireguardPeer,
							...(overrides.c ?? {}),
						}),
						member(DEVICE_D, {
							endpoints: addresses.lanPeer,
							...(overrides.d ?? {}),
						}),
						member(DEVICE_E, {
							endpoints: addresses.colo,
							...(overrides.e ?? {}),
						}),
					]),
				],
			}),
			peers: peerList({ peers: [] }),
		});
	const graph = build();
	const groups = prefixGroups(graph.devices, graph.selfDeviceId);
	const byPrefix = new Map(groups.map((group) => [group.prefix, group]));
	assert.deepEqual(
		[...byPrefix.keys()].sort(),
		["10.88.0", "192.168.1"],
		"two prefixes, and the colo address groups with nothing",
	);
	assert.equal(
		byPrefix.get("10.88.0").tier,
		"probable",
		"two peers agreeing is arithmetic on two published values, not a path",
	);
	assert.equal(byPrefix.get("192.168.1").tier, "shared");
	assert.equal(
		prefixWords(byPrefix.get("10.88.0")),
		"10.88.0.x · same prefix",
		"the label names the TEST, because `10.88.0.x` alone reads as a range the app looked up",
	);
	assert.equal(
		prefixWords(byPrefix.get("192.168.1")),
		"192.168.1.x · shared with this device",
		"and the verified tier's claim is about the machine the reader is sitting at",
	);
	assert.ok(
		groups.every((group) => !group.deviceIds.includes(DEVICE_A)),
		"the self device is the reference rather than a member: it carries the ring, and boxing the reference point draws a boundary around the comparison",
	);
	/*
	 * THE DUPLICATE-ADDRESS REFUSAL, ONE TIER AT A TIME. Two devices publishing one
	 * address cannot both hold it, so the address is dropped and the tier's ONLY evidence
	 * disappears with it.
	 *
	 * THE PROBABLE PAIR IS THE CASE THE OLD FIXTURE DID NOT RUN (agent review round 1,
	 * m3): its override moved C OFF the WireGuard prefix, so `10.88.0.4` was claimed by
	 * nobody and the tier was absent merely because B was left alone - the claim "an
	 * address carried by two devices contributes to no group" was asserted, not exercised.
	 * B and C now both publish the peer's WireGuard address.
	 */
	const doubledProbable = prefixGroups(
		build({
			b: { endpoints: addresses.wireguardPeer },
			c: { endpoints: addresses.wireguardPeer },
		}).devices,
		DEVICE_A,
	);
	assert.equal(
		doubledProbable.filter((group) => group.tier === "probable").length,
		0,
		"an address carried by two devices contributes to no group",
	);
	assert.equal(
		doubledProbable.filter((group) => group.tier === "shared").length,
		1,
		"and the refusal is per-ADDRESS: the LAN group beside the duplicate is untouched",
	);
	/* The shared tier's own evidence: this device and C both publish the LAN peer's address. */
	const doubledShared = prefixGroups(
		build({
			self: { endpoints: addresses.lanPeer },
			c: { endpoints: addresses.lanPeer },
		}).devices,
		DEVICE_A,
	);
	assert.equal(
		doubledShared.filter((group) => group.tier === "shared").length,
		0,
		"the address this device and C both claim supports no boundary",
	);
	/*
	 * THE DECLARED TIER, built now and rendered never: the backend has no scope field, so
	 * this is the client half only - and it takes the operator's own word rather than
	 * guessing a boundary out of arithmetic.
	 */
	const declaredGraph = build({ c: { scope: "aws-vpn" } });
	const declared = prefixGroups(declaredGraph.devices, DEVICE_A);
	const tiers = declared.filter((group) => group.tier === "declared");
	assert.equal(tiers.length, 1);
	assert.equal(prefixWords(tiers[0]), "aws-vpn · declared");
	assert.deepEqual(tiers[0].deviceIds, [DEVICE_C]);
	assert.equal(
		declaredScope(
			declaredGraph.devices.find((device) => device.id === DEVICE_C),
		),
		"aws-vpn",
		"a declared membership is read off the member record and off nothing else",
	);
	assert.equal(
		declaredScope(
			declaredGraph.devices.find((device) => device.id === DEVICE_B),
		),
		"",
		"and a membership nobody declared contributes no declared boundary",
	);
});

test("an endpoint parses only when it is an address this test can be applied to", () => {
	assert.deepEqual(parseEndpoint("10.0.0.4:4097"), {
		host: "10.0.0.4",
		port: 4097,
	});
	assert.deepEqual(parseEndpoint(" 10.0.0.4 "), {
		host: "10.0.0.4",
		port: null,
	});
	/* A bracketed literal parses so its host is readable, and then groups with nothing. */
	assert.deepEqual(parseEndpoint("[::1]:4097"), { host: "::1", port: 4097 });
	assert.equal(subnet24("10.0.0.4"), "10.0.0");
	assert.equal(subnet24("10.88.0.7"), "10.88.0");
	assert.equal(
		subnet24("10.0.0.4:4097"),
		null,
		"a port left attached would group addresses that share nothing: `4:4097` is not an octet",
	);
	assert.equal(subnet24("10.0.0.4.5"), null);
	assert.equal(subnet24("10.0.0.999"), null);
});

test("activity is derived, and says nothing where no read named the device", () => {
	const row = (live_state) => ({
		id: `s_${live_state}`,
		name: "",
		mtime: 0,
		locality: "remote",
		owner_device: DEVICE_B,
		owner_device_name: "cloud-node-1",
		reachable: true,
		unreachable_reason: "",
		live_state,
		archived: false,
	});
	const busy = deviceActivity({ sessionCount: 3 }, [row("idle"), row("busy")]);
	assert.deepEqual(
		busy,
		{ activity: "working", source: "derived" },
		"`busy` in the backend's own vocabulary is the one word that means work is in flight",
	);
	assert.deepEqual(deviceActivity({ sessionCount: 3 }, [row("attached")]), {
		activity: "idle",
		source: "derived",
	});
	assert.deepEqual(
		deviceActivity({ sessionCount: null }, [row("busy")]),
		{ activity: null, source: "none" },
		"a device no read named gets NO state: `idle` there would be the same defect as `0 conversations`",
	);
});

test("the ground is a sibling of the world, and its pitch is not a function of the zoom", () => {
	const canvas = source("src/renderer/src/features/mesh/mesh-canvas.tsx");
	const ground = canvas.indexOf('data-mesh-ground=""');
	const world = canvas.indexOf('data-mesh-world=""');
	assert.ok(
		ground > -1 && world > -1 && ground < world,
		"the ground precedes the world layer",
	);
	assert.match(
		canvas,
		/data-mesh-ground=""[\s\S]*?\/>\n\t*<div\n\t*data-mesh-world=""/,
		"and it SELF-CLOSES, so it cannot be a parent of the world: a texture inside the transformed layer is scaled with the content",
	);
	assert.match(
		canvas,
		/backgroundPosition: `\$\{transform\.tx\}px \$\{transform\.ty\}px`/,
		"it pans with the world, because a field that stayed put would read as content sliding under a sticker",
	);
	assert.ok(
		canvas.indexOf("<MeshScopeLayer") < canvas.indexOf("<MeshEdgeLayer"),
		"and the boundaries are mounted UNDER the edges, so a membership line crosses a frame rather than being clipped by it",
	);
	const css = source("src/renderer/src/styles/index.css");
	assert.match(
		css,
		/\.mesh-ground \{[\s\S]*?background-size: 24px 24px;/,
		"24 px is a viewport length, which is what keeps the pitch identical at every zoom",
	);
	assert.match(
		css,
		/\.mesh-ground \{[\s\S]*?var\(--lo-hairline-strong\)/,
		"and the ink is the strong decorative role: on `hairline` the field measured 1.15-1.23:1 on three of the twelve themes",
	);
});

test("the panel lists the addresses and labels the rotation stamp (D5, D4)", () => {
	const panel = source("src/renderer/src/features/mesh/mesh-card.tsx");
	/*
	 * THE ADDRESSES WERE BEHIND A HOVER (design round's D5): `1 address` plus a tooltip is
	 * reachable by pointer alone, so a keyboard or touch reader never saw one of the wire's
	 * own strings - and the addresses are the only input to the canvas's boundaries, which
	 * makes them the thing a reader needs to CHECK the drawing.
	 */
	assert.match(
		panel,
		/Network addresses[\s\S]*?font-mono text-body-sm text-ink[\s\S]*?advertised/,
		"each published address is its own row, in the machine's own voice, and the side that published it is named",
	);
	assert.doesNotMatch(
		panel,
		/addresses"\}\s*<\/span>\s*<\/Tooltip>|content=\{device\.endpoints\.join/,
		"and the count-plus-tooltip rendering is GONE rather than joined by the list",
	);
	/*
	 * THE AGE APPEARS EXACTLY ONCE, UNDER THE NAME THE WIRE'S WRITER GIVES IT. The shipped
	 * header read `3 conversations · seen 9m ago` - a rotation stamp under a heartbeat's
	 * name, printed twice (the design's own frame caught the second copy) - so the header
	 * speaks the reach model and the Status section carries the stamp under its own label.
	 * `never` rather than a date computed from zero is what the `null` case says.
	 */
	assert.match(
		panel,
		/Last status frame[\s\S]*?device\.lastSeenAt === null[\s\S]*?"never"[\s\S]*?agoSentence\(/,
		"the section names the stamp and prints `never` for a null rather than 1970",
	);
	assert.doesNotMatch(
		panel,
		/seen \$\{|\bseen just now\b/,
		"and no surface says `seen …` any more: one stamp, one noun",
	);
});
