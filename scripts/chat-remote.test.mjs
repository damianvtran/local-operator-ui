import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
	remoteUnreachableClause,
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
		"on cloud-node-1 · damian-mesh",
		"the cross-surface separator (design round 1, D1): the TUI's own ` · `",
	);
	assert.equal(
		remoteClause(remote(), null),
		"on cloud-node-1",
		"an unnamed network drops the clause rather than printing an empty half",
	);
});

test("the unreachable line is split, from the wire's own words, or the shared gloss", () => {
	/*
	 * Design review round 1, D2: the reason is its OWN line (`unreachable ·
	 * <reason>`), mirroring the TUI's split, never fused onto the device
	 * clause; a row with no reason says the same fallback the sibling's
	 * `peer_reason_words` ends at, and a reachable row says nothing at all.
	 */
	assert.equal(
		remoteUnreachableClause(
			remote({ reachable: false, unreachable_reason: "link down 4m ago" }),
		),
		"unreachable · link down 4m ago",
	);
	assert.equal(
		remoteUnreachableClause(remote({ reachable: false })),
		"unreachable · it did not answer",
		"no reason on the wire says the shared gloss, and invents no cause",
	);
	assert.equal(
		remoteUnreachableClause(remote()),
		"",
		"a reachable row has no unreachable line",
	);
	assert.equal(
		remoteUnreachableClause(remote({ reachable: undefined })),
		"",
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

/*
 * THE SURFACES THAT READ THOSE FACTS, CHECKED THE WAY THIS REPOSITORY CHECKED
 * THE ARCHIVE MARK BEFORE IT: the sidebar cannot be rendered in this suite (it
 * reads the router, the session store and the capability hooks), so the call
 * sites are read out of the shipped JSX - the pattern
 * `chat-sidebar-archive.test.mjs` established. Without this half the helpers can
 * be perfect while no row draws them.
 */
const SIDEBAR = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
);

test("the sidebar draws the reserved cell, the split lines, and no separate section", () => {
	/*
	 * THE RESERVED CELL (design review round 1, D5): the row draws a `size-3.5`
	 * locality cell on EVERY row - the mark fills it on remote rows only - so
	 * every status glyph and title starts on the same x, and a dropped link
	 * cannot reflow the row.
	 */
	assert.match(
		SIDEBAR,
		/size-3\.5 shrink-0 items-center justify-center/,
		"the cell is a fixed box the mark swaps within",
	);
	assert.match(
		SIDEBAR,
		/row\.locality === "remote" && \(\s*<ChatRemoteMark unreachable=\{row\.reachable === false\} \/>/,
	);
	const clause = SIDEBAR.slice(
		SIDEBAR.indexOf("const remoteHost = remote"),
		SIDEBAR.indexOf("const marks = subagentMarks(row)"),
	);
	assert.match(clause, /remoteClause\(/);
	assert.match(clause, /remoteUnreachableClause\(/);
	assert.match(
		SIDEBAR,
		/\{remote && <span className="block">\{remoteHost\}<\/span>\}/,
	);
	assert.match(
		SIDEBAR,
		/\{remoteUnreachable && \(\s*<span className="block">\{remoteUnreachable\}<\/span>\s*\)\}/,
		"the unreachable line is its own block line (design round 1, D2)",
	);
	assert.match(
		SIDEBAR,
		/\{remote && <span className="sr-only">, \{remoteHost\}<\/span>\}/,
	);
	assert.match(
		SIDEBAR,
		/\{remoteUnreachable && \(\s*<span className="sr-only">, \{remoteUnreachable\}<\/span>/,
		"the accessible name joins the same split fragment",
	);
});

test("an unreachable remote row draws the stroked mark, not a hover-only fact", () => {
	/*
	 * The design round's cross-surface decision (2026-10-05): unreachable is
	 * visible AT REST as ONE quiet stroke across the locality mark - the same
	 * arrow, same ink, same cell, no reflow - and the tooltip only expands it
	 * (the TUI sibling's D2 sentence, mirrored). The row passes the state, the
	 * mark draws it, and `data-remote-mark-stroke` is the address tests and
	 * the evidence rig use for that state.
	 */
	const mark = readFileSync(
		"src/renderer/src/features/chat/components/chat-remote-mark.tsx",
		"utf8",
	);
	assert.match(mark, /unreachable: boolean/);
	assert.match(mark, /\{unreachable && <path data-remote-mark-stroke/);
	assert.match(mark, /d="M9 9 15 15"/, "the stroke crosses the shaft");
	assert.match(
		mark,
		/d="M7 17 17 7"/,
		"and the arrow itself is the elsewhere/external family the TUI draws",
	);
	assert.match(
		mark,
		/text-ink-dim/,
		"same ink as every ambient fact in the row; no new colour role",
	);
});
