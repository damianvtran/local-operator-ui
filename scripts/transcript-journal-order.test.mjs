import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer"; export * from "./src/renderer/src/features/chat/canonical/journal-order"; export * from "./src/renderer/src/features/chat/canonical/load-older";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const R = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const msg = (id, role = "user", text = id) => ({
	id,
	role,
	content: [{ type: "text", text }],
	tool_calls: [],
});
const row = (id, seq, ts = 100 - seq, payload = msg(id)) => ({
	id,
	type: "message",
	ts,
	payload,
	journal_seq: seq,
});
const page = (entries, generation = "scope-A", extra = {}) => ({
	entries,
	has_more: true,
	cursor_missing: false,
	journal_generation: generation,
	journal_order_state: "ready",
	...extra,
});
const ids = (state) => state.records.map((record) => record.id);
const start = (entries) =>
	R.applyHistoryPage(R.EMPTY_TRANSCRIPT, page(entries), {
		authoritative: true,
	});

test("reverse pages use source positions with backwards/equal timestamps, not arrival", () => {
	let state = start([row("last", 3, 1)]);
	const custom = row("model", 1, 99, {
		kind: "custom",
		custom_type: "session_model_switch",
		details: { text: "model changed" },
	});
	state = R.applyHistoryPage(state, page([custom, row("middle", 2, 99)]), {
		pagedBefore: "last",
	});
	state = R.applyHistoryPage(state, page([row("first", 0, 100)]), {
		pagedBefore: "model",
	});
	assert.deepEqual(ids(state), ["first", "model", "middle", "last"]);
	assert.equal(state.oldestId, "first");
	state = R.applyHistoryPage(state, page([custom, row("middle", 2, 99)]));
	assert.deepEqual(ids(state), ["first", "model", "middle", "last"]);
});

test("quiet off-page echo heals from metadata only, survives seal/RPC failure, images stay on id", () => {
	let state = start([row("before", 0, 0.1)]);
	state = R.appendPendingUser(
		state,
		"send",
		"own send",
		[{ data: "QQ==", mimeType: "image/png" }],
		1000,
	);
	state = R.applyHistoryPage(state, page([row("newer", 3, 50)]));
	assert.equal(
		state.records.find((record) => record.id === "send").provisional,
		true,
	);
	const image = state.records.find((record) => record.id === "send").images;
	state = R.applyEvent(state, {
		type: "journal_order_ready",
		journal_generation: "scope-A",
		rows: [{ id: "send", journal_seq: 1, role: "user" }],
	});
	assert.deepEqual(ids(state), ["before", "send", "newer"]);
	const send = state.records.find((record) => record.id === "send");
	assert.equal(send.provisional, undefined);
	assert.equal(send.local, undefined);
	assert.equal(send.images, image);
	assert.equal(R.removeLocalRecord(state, "send"), state);
	assert.equal(R.sealDisjointBlock(state, { id: "newer", ts: 50000 }), state);
});

test("same-id live payload update cannot erase proven position or move sender/body to another row", () => {
	let state = start([
		row("a", 0, 3, msg("a", "assistant", "old")),
		row("b", 1, 2),
	]);
	state = R.applyEvent(
		state,
		{ type: "message_end", message: msg("a", "assistant", "richer") },
		900000,
	);
	assert.deepEqual(ids(state), ["a", "b"]);
	assert.equal(state.records[0].text, "richer");
	assert.equal(state.records[0].journalSeq, 0);
	assert.equal(state.records[0].journalGeneration, "scope-A");
});

test("wrong non-authoritative domain mutates no payload/cursor; authority remints revision", () => {
	let state = start([row("a", 0)]);
	const revision = state.orderRevision;
	const next = R.applyHistoryPage(state, page([row("intruder", 0)], "scope-B"));
	assert.equal(next.records, state.records);
	assert.equal(next.oldestId, state.oldestId);
	assert.equal(next.journalGeneration, "scope-A");
	assert.equal(next.orderNeedsReconcile, true);
	state = R.applyHistoryPage(next, page([row("b", 0)], "scope-B"), {
		authoritative: true,
	});
	assert.equal(state.journalGeneration, "scope-B");
	assert.ok(state.orderRevision > revision);
	assert.equal(state.orderNeedsReconcile, false);
	// Old-domain record coordinates are retained as historical facts, but cannot
	// rank in the current confirmed class without a new same-domain proof.
	assert.equal(
		state.records.find((record) => record.id === "a").journalGeneration,
		"scope-A",
	);
});

test("same-conversation old-revision load-older result is stale at await and commit", async () => {
	let state = start([row("tail", 5)]);
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const loader = R.createOlderLoader();
	const request = loader.load("same-session", {
		getTranscript: () => state,
		readPage: () => pending,
		isCurrent: () => true,
		commit: (update) => {
			state = update(state);
			return state;
		},
	});
	state = R.applyHistoryPage(state, page([row("replacement", 0)], "scope-B"), {
		authoritative: true,
	});
	release(page([row("late-old", 4)]));
	assert.equal((await request).kind, "stale");
	assert.ok(!ids(state).includes("late-old"));
});
