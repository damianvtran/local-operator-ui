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
	zoomAbout,
	NODE_HEIGHT,
	ROW_GAP,
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
	assert.equal(
		deviceStatLine(device, 1_700_000_100),
		"unreachable (no route to it)",
	);
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
		"2 chats · seen just now",
		"the age comes from the stamp that IS there",
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

test("the Mesh rail row is gated on the same tri-state, and named the operator's word", () => {
	const nav = source(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(
		nav,
		/const meshState = desktopFeatureState\(capabilities\.data, "peers"\);/,
	);
	assert.match(
		nav,
		/\.\.\.\(meshState === "enabled"\s*\?\s*\[\s*\{\s*icon: Network,\s*label: "Mesh",\s*path: "\/mesh",/,
		"one gate read in two places, rather than a row that leads to a route that is not there",
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

test("this slice ships no mesh mutation, and the absence is deliberate", () => {
	const contract = source("src/shared/desktop-contract.ts");
	for (const op of [
		"sessions.transfer",
		"networks.invite",
		"networks.member.remove",
	]) {
		assert.doesNotMatch(
			contract,
			new RegExp(`z\\.literal\\("${op.replace(".", "\\.")}"\\)`),
			`${op} is a slice-4/5 surface: a request schema entry with no caller advertises a capability this app cannot exercise`,
		);
	}
	const hooks = source(
		"src/renderer/src/shared/api/local-operator/desktop-hooks.ts",
	);
	assert.match(hooks, /\| "peers";/, "the feature key exists");
	assert.doesNotMatch(
		hooks,
		/\| "session_transfer";/,
		"and `session_transfer` waits for the drag layer that gates on it",
	);
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
