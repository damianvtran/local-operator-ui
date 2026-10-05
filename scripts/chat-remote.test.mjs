import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE REMOTE ROW'S OWN FACTS, EXECUTED.
 *
 * `chat-remote.ts` holds the sidebar's remote-row copy and its degradation
 * ladder - the device label, the network lookup, the ONE sentence both channels
 * read, and the list order - and this file hands them rows with no DOM, which is
 * the whole reason they live outside the nine-thousand-line component. The
 * sentence is what the operator asked to read on hover ("which remote device and
 * network that session is on"), so its degradation cases are the feature, not
 * edge cases: no network name, no device name, an unreachable owner with and
 * without the wire's own reason.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/chat/chat-remote";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	deviceNetworkNames,
	mergeRemoteRowsByActivity,
	remoteClause,
	remoteDeviceLabel,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const row = (over = {}) => ({
	session_id: "aaaaaaaaaaaa",
	title: "Chat",
	updated_at: 1,
	...over,
});

const remote = (over = {}) =>
	row({
		locality: "remote",
		owner_device: "d_2a1c9f0e77f1",
		owner_device_name: "cloud-node-1",
		reachable: true,
		unreachable_reason: "",
		...over,
	});

test("the device label is the wire's name, the id's tail, or the floor", () => {
	assert.equal(remoteDeviceLabel(remote()), "cloud-node-1");
	assert.equal(
		remoteDeviceLabel(remote({ owner_device_name: "" })),
		"9f0e77f1",
		"the id's tail is the fallback, the header chip's own rule",
	);
	assert.equal(
		remoteDeviceLabel(remote({ owner_device_name: "", owner_device: "" })),
		"another device",
		"a row with neither name nor id still reads as a device",
	);
});

test("the network lookup is first-wins and skips malformed entries", () => {
	const names = deviceNetworkNames({
		networks: [
			{
				name: "damian-mesh",
				members: [{ device_id: "d_node" }, { device_id: "d_self" }],
			},
			{ name: "second-mesh", members: [{ device_id: "d_node" }] },
			{ name: "", members: [{ device_id: "d_ignored" }] },
			{ name: "junk", members: "not-an-array" },
			null,
		],
	});
	assert.equal(names.get("d_node"), "damian-mesh", "first network wins");
	assert.equal(names.get("d_self"), "damian-mesh");
	assert.equal(names.get("d_ignored"), undefined);
	assert.equal(deviceNetworkNames(undefined).size, 0);
});

test("the clause reads the device and the network", () => {
	assert.equal(
		remoteClause(remote(), "damian-mesh"),
		"on cloud-node-1 (damian-mesh)",
	);
	assert.equal(
		remoteClause(remote(), null),
		"on cloud-node-1",
		"an unnamed network drops the clause rather than printing empty parens",
	);
});

test("the clause says when the owner did not answer, from the wire's own words", () => {
	assert.equal(
		remoteClause(
			remote({ reachable: false, unreachable_reason: "link down 4m ago" }),
			"damian-mesh",
		),
		"on cloud-node-1 (damian-mesh) - unreachable: link down 4m ago",
	);
	assert.equal(
		remoteClause(remote({ reachable: false }), null),
		"on cloud-node-1 - unreachable",
		"a row with no reason says so and invents nothing",
	);
	assert.equal(
		remoteClause(remote({ reachable: undefined }), null),
		"on cloud-node-1",
		"absence of reachability is no claim, not an unreachable claim",
	);
});

test("remote rows re-enter the list where their clock says", () => {
	const rows = [
		remote({ session_id: "r1", updated_at: 900 }),
		row({ session_id: "l1", updated_at: 1000 }),
		row({ session_id: "l2", updated_at: 800 }),
		row({ session_id: "l3", updated_at: 600 }),
		remote({ session_id: "r2", updated_at: 700 }),
		remote({ session_id: "r3", updated_at: 500 }),
	];
	const merged = mergeRemoteRowsByActivity(rows).map((r) => r.session_id);
	assert.deepEqual(
		merged,
		["l1", "r1", "l2", "r2", "l3", "r3"],
		"each remote row sits before the first row it outranks; the local order is untouched",
	);
});

test("a list with no remote rows is returned as it stood", () => {
	const rows = [row({ session_id: "l1" }), row({ session_id: "l2" })];
	assert.deepEqual(
		mergeRemoteRowsByActivity(rows).map((r) => r.session_id),
		["l1", "l2"],
	);
});

test("a row with no usable clock sorts last, not first", () => {
	const rows = [
		remote({ session_id: "r1", updated_at: undefined }),
		row({ session_id: "l1", updated_at: 1000 }),
	];
	assert.deepEqual(
		mergeRemoteRowsByActivity(rows).map((r) => r.session_id),
		["l1", "r1"],
	);
});
