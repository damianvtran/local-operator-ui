import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer"; export * from "./src/renderer/src/features/chat/canonical/journal-order"; export * from "./src/renderer/src/features/chat/canonical/load-older"; export * from "./src/renderer/src/features/chat/canonical/journal-order-repair"; export * from "./src/shared/desktop-contract"; export * from "./src/shared/journal-order-query"; export * from "./src/renderer/src/features/chat/canonical/stranded-hold-order-source";',
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

const supplement = (id, seq, anchor, version, state = "done") => ({
	id,
	type: "custom",
	ts: 300 - seq,
	journal_seq: seq,
	payload: {
		custom_type: "supplement_v1",
		details: {
			anchor,
			job: "synthetic-job",
			version,
			state,
			files: [],
			components: [],
			error: "",
			at: 200,
		},
	},
});

test("tool and supplement keep own coordinates while placed at the causal owner", () => {
	const owner = row("owner", 1, 100, {
		...msg("owner", "assistant"),
		tool_calls: [{ id: "call", function: { name: "bash", arguments: "{}" } }],
	});
	let state = start([
		row("later", 2, 1),
		row("result", 5, 0, {
			...msg("result", "tool"),
			tool_call_id: "call",
			name: "bash",
		}),
		supplement("supp-new", 6, "owner", 2),
	]);
	state = R.applyHistoryPage(state, page([owner]), { pagedBefore: "later" });
	assert.deepEqual(ids(state), [
		"owner",
		"tool:call",
		"supplement:owner",
		"later",
	]);
	const tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.sourceEntryId, "result");
	assert.equal(tool.journalSeq, 5);
	const block = state.records.find((r) => r.kind === "supplement");
	assert.equal(block.sourceEntryId, "supp-new");
	assert.equal(block.journalSeq, 6);
	state = R.applyHistoryPage(
		state,
		page([supplement("supp-old", 3, "owner", 1, "queued")]),
		{ pagedBefore: "owner" },
	);
	const after = state.records.find((r) => r.kind === "supplement");
	assert.equal(after.version, 2);
	assert.equal(after.sourceEntryId, "supp-new");
	assert.equal(after.journalSeq, 6);
});

test("legacy/building omission keeps authority and transitive mixed admission has no clock lane", () => {
	let state = start([row("first", 0, 200), row("last", 3, 1)]);
	state = R.applyEvent(
		state,
		{ type: "message_end", message: msg("unknown", "assistant") },
		-999,
	);
	state = R.applyHistoryPage(state, {
		entries: [row("first", undefined, 900)],
		has_more: true,
		cursor_missing: false,
	});
	state = R.applyHistoryPage(state, page([row("middle", 2, 100)]));
	assert.deepEqual(ids(state), ["first", "middle", "last", "unknown"]);
	assert.equal(state.journalGeneration, "scope-A");
	assert.equal(state.records[0].journalSeq, 0);
	assert.equal(state.records.at(-1).journalSeq, undefined);
});

const repairDeps = (getState, setState, read) => ({
	getTranscript: getState,
	isCurrent: () => true,
	read,
	page: (response) => response,
	lookupPath: "/v1/desktop/sessions/aaaaaaaaaaaa",
	commit: (response, revision, orderRead) => {
		if (R.currentOrderRevision(getState()) === revision)
			setState(R.applyJournalOrderMetadata(getState(), response, orderRead));
	},
});

test("more than 512 cached identities resolve in bounded same-domain batches; missing IDs do not spin", async () => {
	let state = R.applyHistoryPage(R.EMPTY_TRANSCRIPT, {
		entries: Array.from({ length: 1030 }, (_, i) =>
			row(`cache-${i}`, undefined),
		),
		has_more: false,
		cursor_missing: false,
	});
	state = R.applyHistoryPage(state, page([row("tail", 2000)]), {
		authoritative: true,
	});
	const calls = [];
	await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async (requested) => {
				calls.push(requested);
				return page([], "scope-A", {
					journal_ordinals: Object.fromEntries(
						requested
							.filter((id) => id !== "cache-17")
							.map((id) => [id, Number(id.slice(6))]),
					),
					journal_missing_ids: requested.includes("cache-17")
						? ["cache-17"]
						: [],
				});
			},
		),
	);
	assert.ok(calls.length > 2);
	for (const call of calls) {
		const endpoint = R.desktopEndpoint({
			op: "sessions.get",
			sessionId: "aaaaaaaaaaaa",
			journalOrder: true,
			orderIds: call,
		});
		assert.ok(Buffer.byteLength(endpoint.path) <= R.JOURNAL_ORDER_QUERY_BYTES);
		assert.ok(call.length <= 512);
	}
	assert.equal(new Set(calls.flat()).size, 1030);
	assert.equal(
		state.records.filter((r) => r.journalGeneration === "scope-A").length,
		1030,
	);
	assert.equal(
		state.records.find((r) => r.id === "cache-1029").journalSeq,
		1029,
	);
	assert.deepEqual(R.journalLookupIds(state), ["cache-17"]);
});

test("cold ready-domain race earns one authoritative quiet read, unsupported never spins", async () => {
	let state = R.applyHistoryPage(R.EMPTY_TRANSCRIPT, {
		entries: [row("send", undefined)],
		has_more: false,
		cursor_missing: false,
		journal_order_state: "building",
	});
	state = { ...state, orderNeedsReconcile: true };
	let calls = 0;
	await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async () => {
				calls++;
				if (calls === 1) {
					state = R.applyEvent(state, {
						type: "journal_order_ready",
						journal_generation: "cold-domain",
						rows: [{ id: "send", journal_seq: 0 }],
					});
					return {
						entries: [],
						has_more: false,
						cursor_missing: false,
						journal_order_state: "building",
					};
				}
				return page([], "cold-domain", { journal_ordinals: { send: 0 } });
			},
		),
	);
	assert.equal(calls, 2);
	assert.equal(state.records[0].journalSeq, 0);
	assert.equal(state.orderNeedsReconcile, false);
	calls = 0;
	await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async () => {
				calls++;
				return {
					entries: [],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "unsupported",
				};
			},
		),
	);
	assert.equal(calls, 1);
	assert.equal(state.journalGeneration, "cold-domain");
});

test("repair snapshot rejects same-session old source after await", async () => {
	let state = start([row("present", 0)]);
	let resolve;
	const delayed = new Promise((done) => {
		resolve = done;
	});
	const flight = R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			() => delayed,
		),
	);
	state = R.applyHistoryPage(state, page([row("new-domain", 0)], "scope-B"), {
		authoritative: true,
	});
	const cursor = state.oldestId;
	resolve(page([row("stale", 1)], "scope-A"));
	await flight;
	assert.equal(state.journalGeneration, "scope-B");
	assert.equal(state.oldestId, cursor);
	assert.ok(!ids(state).includes("stale"));
});

test("captured replay offsets include silent rows and overlap; not disjoint page enumeration", () => {
	assert.equal(R.capturedJournalOrdinals.size, 400);
	assert.deepEqual(
		[...R.capturedJournalOrdinals.values()].sort((a, b) => a - b),
		Array.from({ length: 400 }, (_, i) => i + 305),
	);
	assert.equal(
		R.CAPTURED_REPLAY_DOMAIN,
		"synthetic-replay-captured-journal-lines",
	);
});

test("strict IPC old/off/on query shapes and ID bounds", () => {
	for (const op of ["sessions.get", "sessions.history"]) {
		const base = { op, sessionId: "aaaaaaaaaaaa" };
		assert.ok(R.desktopRequestSchema.safeParse(base).success);
		const oldPath = R.desktopEndpoint(base).path;
		assert.ok(!oldPath.includes("journal_order"));
		assert.equal(
			R.desktopEndpoint({ ...base, journalOrder: false, orderIds: ["a"] }).path,
			oldPath,
		);
		const parsed = R.desktopRequestSchema.parse({
			...base,
			journalOrder: true,
			orderIds: ["a", "b"],
		});
		const query = new URL(R.desktopEndpoint(parsed).path, "http://fixture")
			.searchParams;
		assert.equal(query.get("journal_order"), "1");
		assert.deepEqual(query.getAll("order_ids"), ["a", "b"]);
		for (const orderIds of [
			[""],
			["x".repeat(129)],
			Array.from({ length: 513 }, () => "a"),
		])
			assert.equal(
				R.desktopRequestSchema.safeParse({
					...base,
					journalOrder: true,
					orderIds,
				}).success,
				false,
			);
	}
});

test("equal-ms reverse-page sidecar + overlap + unchanged full reread retains source slot", () => {
	const sidecar = {
		id: "sidecar",
		ts: 10.0001,
		type: "message",
		journal_seq: 2,
		payload: {
			kind: "custom",
			custom_type: "session_model_switch",
			details: { text: "sidecar" },
		},
	};
	const message = row("owner", 1, 10.0002);
	let state = start([sidecar]);
	state = R.applyHistoryPage(state, page([row("prior", 0, 50), message]), {
		pagedBefore: "sidecar",
	});
	assert.deepEqual(ids(state), ["prior", "owner", "sidecar"]);
	state = R.applyHistoryPage(state, page([message, sidecar]));
	state = R.applyHistoryPage(
		state,
		page([row("prior", 0, 50), message, sidecar]),
	);
	assert.deepEqual(ids(state), ["prior", "owner", "sidecar"]);
	assert.equal(state.oldestId, "prior");
});

test("ready domain racing an old ready snapshot stays owed and resolves through one new source read", async () => {
	let state = start([row("send", 0)]);
	let calls = 0;
	const outcome = await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async () => {
				calls++;
				if (calls === 1) {
					state = R.applyEvent(state, {
						type: "journal_order_ready",
						journal_generation: "scope-B",
						rows: [{ id: "send", journal_seq: 9 }],
					});
					return page([], "scope-A");
				}
				return page([], "scope-B", { journal_ordinals: { send: 9 } });
			},
		),
	);
	assert.equal(calls, 2);
	assert.equal(outcome.kind, "complete");
	assert.equal(state.records[0].journalGeneration, "scope-B");
	assert.equal(state.records[0].journalSeq, 9);
	assert.equal(state.orderNeedsReconcile, false);
});

test("repair attempts reset with the authoritative source domain, not a prior domain's missing set", async () => {
	let state = start([row("tail", 1000)]);
	state = R.applyHistoryPage(state, {
		entries: Array.from({ length: 600 }, (_, i) =>
			row(`cache-${i}`, undefined),
		),
		has_more: false,
		cursor_missing: false,
	});
	let calls = 0;
	const batches = [];
	await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async (requested) => {
				calls++;
				batches.push(requested);
				return page([], calls === 1 ? "scope-A" : "scope-B", {
					journal_ordinals: Object.fromEntries(
						requested.map((id) => [
							id,
							id === "tail" ? 1000 : Number(id.slice(6)),
						]),
					),
				});
			},
		),
	);
	assert.equal(state.journalGeneration, "scope-B");
	assert.equal(
		state.records.filter((r) => r.journalGeneration === "scope-B").length,
		601,
	);
	assert.ok(batches.every((ids) => ids.length <= 512));
	assert.ok(calls >= 4);
});

test("load older commit fence rejects a source reset after the awaited result was checked", async () => {
	let state = start([row("tail", 9)]);
	const loader = R.createOlderLoader();
	const result = await loader.load("same-session", {
		getTranscript: () => state,
		isCurrent: () => true,
		readPage: async () => page([row("older", 8)]),
		commit: (update) => {
			state = R.applyHistoryPage(state, page([row("new", 0)], "scope-B"), {
				authoritative: true,
			});
			state = update(state);
			return state;
		},
	});
	assert.equal(result.kind, "stale");
	assert.equal(state.journalGeneration, "scope-B");
	assert.ok(!ids(state).includes("older"));
});

test("building and unsupported first reads never fabricate a source domain or coordinate", () => {
	for (const journal_order_state of [
		"building",
		"unavailable",
		"unsupported",
		undefined,
	]) {
		const state = R.applyHistoryPage(R.EMPTY_TRANSCRIPT, {
			entries: [row("first", undefined)],
			has_more: false,
			cursor_missing: false,
			journal_order_state,
		});
		assert.equal(state.journalGeneration, undefined);
		assert.equal(state.records[0].journalSeq, undefined);
		assert.equal(state.records[0].journalGeneration, undefined);
	}
});

test("legal raw colon IDs heal off-tail metadata without borrowing payload, images or cursor", async () => {
	for (const rawId of [
		"synthetic:raw-send",
		"tool:raw-user",
		"supplement:raw-user",
	]) {
		let state = start([row("tail-before", 0)]);
		state = R.appendPendingUser(
			state,
			rawId,
			"own text",
			[{ data: "QQ==", mimeType: "image/png" }],
			1234,
		);
		state = R.applyHistoryPage(state, page([row("tail-after", 2)]));
		const image = state.records.find((r) => r.id === rawId).images;
		const cursor = state.oldestId;
		const requests = [];
		const outcome = await R.repairJournalOrder(
			repairDeps(
				() => state,
				(next) => {
					state = next;
				},
				async (requested) => {
					requests.push(requested);
					return page(
						[
							row(
								"unrequested-tail",
								100,
								999,
								msg("unrequested-tail", "assistant", "must not be adopted"),
							),
							row(
								rawId,
								1,
								888,
								msg(rawId, "user", "must not replace own text"),
							),
						],
						"scope-A",
						{ journal_ordinals: { [rawId]: 1 } },
					);
				},
			),
		);
		assert.equal(outcome.kind, "complete");
		assert.deepEqual(requests, [[rawId]]);
		const record = state.records.find((r) => r.id === rawId);
		assert.equal(record.journalSeq, 1);
		assert.equal(record.provisional, undefined);
		assert.equal(record.local, undefined);
		assert.equal(record.text, "own text");
		assert.equal(record.images, image);
		assert.equal(state.oldestId, cursor);
		assert.deepEqual(ids(state), ["tail-before", rawId, "tail-after"]);
	}
	// Kind/provenance, not a prefix, separates synthesized keys from legal IDs.
	const base = start([row("raw:cache", undefined)]);
	const virtual = {
		...base,
		records: [
			...base.records,
			{ kind: "tool", id: "tool:virtual" },
			{ kind: "supplement", id: "supplement:virtual" },
			{ kind: "tool", id: "tool:durable", sourceEntryId: "raw:tool" },
		],
	};
	assert.deepEqual(R.journalLookupIds(virtual), ["raw:cache", "raw:tool"]);
});

test("obsolete ready demand before dispatch converges to fresh current authority", async () => {
	let state = start([row("present", 0)]);
	state = R.applyHistoryPage(state, page([row("present", 0)], "scope-B"), {
		authoritative: true,
	});
	state = R.applyEvent(state, {
		type: "journal_order_ready",
		journal_generation: "scope-A",
		rows: [],
	});
	let calls = 0;
	const outcome = await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async () => {
				calls++;
				return page([], "scope-B");
			},
		),
	);
	assert.equal(calls, 1);
	assert.equal(outcome.kind, "complete");
	assert.equal(state.journalGeneration, "scope-B");
	assert.equal(state.orderWantedGeneration, undefined);
	assert.equal(state.orderNeedsReconcile, false);
});

test("same opaque demand returning during the read is a distinct wake, not predispatch debt", async () => {
	let state = start([row("present", 0)]);
	state = R.applyEvent(state, {
		type: "journal_order_ready",
		journal_generation: "obsolete",
		rows: [],
	});
	let calls = 0;
	const outcome = await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async () => {
				calls++;
				if (calls === 1) {
					state = R.applyEvent(state, {
						type: "journal_order_ready",
						journal_generation: "other",
						rows: [],
					});
					state = R.applyEvent(state, {
						type: "journal_order_ready",
						journal_generation: "obsolete",
						rows: [],
					});
				}
				return page([], "scope-A");
			},
		),
	);
	assert.equal(calls, 2);
	assert.equal(outcome.kind, "complete");
	assert.equal(state.orderNeedsReconcile, false);
});

test("UUID, max ASCII and encoded Unicode caches continue within bytes and count without losing identities", async () => {
	for (const makeId of [
		(i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
		(i) => "a".repeat(125) + String(i).padStart(3, "0"),
		(i) => "漢".repeat(125) + String(i).padStart(3, "0"),
	]) {
		const rawIds = Array.from({ length: 512 }, (_, i) => makeId(i));
		let state = R.applyHistoryPage(R.EMPTY_TRANSCRIPT, {
			entries: rawIds.map((id) => row(id, undefined)),
			has_more: false,
			cursor_missing: false,
		});
		const batches = [];
		const cursor = state.oldestId;
		const outcome = await R.repairJournalOrder(
			repairDeps(
				() => state,
				(next) => {
					state = next;
				},
				async (requested) => {
					batches.push(requested);
					const endpoint = R.desktopEndpoint({
						op: "sessions.get",
						sessionId: "aaaaaaaaaaaa",
						journalOrder: true,
						orderIds: requested,
					});
					assert.ok(
						Buffer.byteLength(endpoint.path) <= R.JOURNAL_ORDER_QUERY_BYTES,
					);
					assert.deepEqual(
						new URL(endpoint.path, "http://host").searchParams.getAll(
							"order_ids",
						),
						requested,
					);
					return page([], "scope-A", {
						journal_ordinals: Object.fromEntries(
							requested.map((id) => [id, rawIds.indexOf(id)]),
						),
					});
				},
			),
		);
		assert.equal(outcome.kind, "complete");
		assert.ok(batches.length > 1);
		assert.equal(batches.flat().length, 512);
		assert.equal(new Set(batches.flat()).size, 512);
		assert.deepEqual(R.journalLookupIds(state), []);
		assert.deepEqual(ids(state), rawIds);
		assert.equal(state.oldestId, cursor);
	}
});
