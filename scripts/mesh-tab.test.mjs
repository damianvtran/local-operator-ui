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
 *     uses. They import nothing but each other, so there is no fixture dialect here;
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
			export * from "./src/renderer/src/features/mesh/mesh-positions";
			export * from "./src/renderer/src/features/mesh/mesh-sessions";
			export * from "./src/renderer/src/features/mesh/mesh-drop";
			export * from "./src/renderer/src/features/mesh/mesh-drag";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
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
	deviceStateWords,
	meshNodeCount,
	assignSlots,
	meshGeometry,
	fitTransform,
	keepNodeVisible,
	zoomAbout,
	NODE_WIDTH,
	NODE_HEIGHT,
	ROW_GAP,
	sessionRows,
	transferReceipt,
	meshRefusal,
	CHIP_LIMIT,
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
	 * another - so the stat line says the state and the reason lives where it fits.
	 */
	assert.equal(deviceStatLine(device, 1_700_000_100), "unreachable");
	assert.equal(deviceStateWords(device), "unreachable (no route to it)");
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
		"2 networks · 3 devices · 1 unreachable · this device is device …aaaaaa",
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
	assert.equal(meshSummary(bare), "1 network · 1 device");
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
		"2 conversations · seen just now",
		"the age comes from the stamp that IS there, and the unit is the feature's one noun",
	);
	assert.equal(
		deviceStatLine(unknown, 1_700_000_100),
		"this device",
		"and an absent stamp produces no time claim at all",
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

test("fit centres the world in the viewport and never leaves the scale range", () => {
	const bounds = { width: 464, height: 200 };
	const fitted = fitTransform(bounds, { width: 1000, height: 600 });
	assert.equal(fitted.tx, (1000 - bounds.width * fitted.k) / 2);
	assert.equal(fitted.ty, (600 - bounds.height * fitted.k) / 2);
	assert.ok(fitted.k >= 0.25 && fitted.k <= 3);
	const tiny = fitTransform(bounds, { width: 10, height: 10 });
	assert.equal(
		tiny.k,
		0.25,
		"a viewport smaller than the world clamps rather than vanishing",
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
	assert.match(
		palette,
		/meshMembership === "member" \? \[\.\.\.PAGES, MESH_PAGE\] : PAGES/,
		"gated by the SAME rule as the rail row, so the two lists cannot disagree",
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
	assert.match(
		hooks,
		/\| "session_transfer";/,
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

test("this device is a ring, and the stripe carries status (D6)", () => {
	const node = source("src/renderer/src/features/mesh/mesh-node.tsx");
	assert.match(
		node,
		/const STATE_RING: Record<DeviceState, string \| null> = \{\s*self: "ring-2 ring-accent",/,
		"identity is its own channel: a ring no status state can spend",
	);
	assert.match(
		node,
		/const STATE_STRIPE: Record<DeviceState, string> = \{\s*self: "border-l-hairline",/,
		"and the self stripe is the neutral one a resting node wears, so a green bar cannot read as healthy in a misconfigured graph",
	);
	assert.doesNotMatch(
		node,
		/self: "border-l-accent"/,
		"the accent stripe is gone, not merely joined by a ring",
	);
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
		/withDeadline\(\s*window\.api\.desktop\.request\(request\),\s*request,\s*\)/,
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
		/desktopRequestDeadlineDetail\(\s*request\.op,\s*deadlineMs,?\s*\)/,
		"the give-up takes the op's own code and sentence from the contract's one authority",
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
		/w-full max-w-32 truncate/,
		"and its button fills that share",
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
});
