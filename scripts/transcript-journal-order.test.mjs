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
		orderRead: R.journalOrderRead(next),
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

test("generic and same-domain named wakes during ready reads retry IDs missing from the older response", async () => {
	for (const debt of ["none", "generic", "named"]) {
		for (const during of ["generic", "same-domain"]) {
			let state = start([row("before", 0)]);
			state = R.appendPendingUser(
				state,
				"quiet-send",
				"OWN",
				[{ data: "QQ==", mimeType: "image/png" }],
				1234,
			);
			if (debt !== "none")
				state = R.applyEvent(
					state,
					debt === "generic"
						? { type: "journal_order_ready", reconcile: true }
						: {
								type: "journal_order_ready",
								journal_generation: "obsolete",
								rows: [],
							},
				);
			const image = state.records.find((r) => r.id === "quiet-send").images;
			const cursor = state.oldestId;
			const calls = [];
			const outcome = await R.repairJournalOrder(
				repairDeps(
					() => state,
					(next) => {
						state = next;
					},
					async (requested) => {
						calls.push(requested);
						if (calls.length === 1) {
							const prior = state.orderDemand;
							state = R.applyEvent(
								state,
								during === "generic"
									? { type: "journal_order_ready", reconcile: true }
									: {
											type: "journal_order_ready",
											journal_generation: "scope-A",
											rows: [],
										},
							);
							assert.notEqual(state.orderDemand, prior);
							return page([], "scope-A", {
								journal_missing_ids: ["quiet-send"],
							});
						}
						return page([], "scope-A", {
							journal_ordinals: { "quiet-send": 1 },
						});
					},
				),
			);
			assert.deepEqual(
				calls,
				[["quiet-send"], ["quiet-send"]],
				`${debt}/${during}`,
			);
			assert.equal(outcome.kind, "complete");
			assert.equal(state.orderNeedsReconcile, false);
			assert.equal(state.orderDemand, undefined);
			const send = state.records.find((r) => r.id === "quiet-send");
			assert.equal(send.journalSeq, 1);
			assert.equal(send.provisional, undefined);
			assert.equal(send.text, "OWN");
			assert.equal(send.images, image);
			assert.equal(state.oldestId, cursor);
		}
	}
});

test("a continuously changing ready source is bounded per flight without sealing the later demand", async () => {
	let state = start([row("before", 0)]);
	state = R.appendPendingUser(state, "quiet-send", "OWN", [], 1234);
	let calls = 0;
	const outcome = await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async () => {
				calls++;
				state = R.applyEvent(state, {
					type: "journal_order_ready",
					reconcile: true,
				});
				return page([], "scope-A", { journal_missing_ids: ["quiet-send"] });
			},
		),
	);
	assert.equal(calls, 2);
	assert.equal(outcome.kind, "waiting");
	assert.equal(state.orderNeedsReconcile, true);
	assert.ok(state.orderDemand);
	assert.equal(
		state.records.find((r) => r.id === "quiet-send").provisional,
		true,
	);
	const later = await R.repairJournalOrder(
		repairDeps(
			() => state,
			(next) => {
				state = next;
			},
			async (requested) => {
				calls++;
				assert.deepEqual(requested, ["quiet-send"]);
				return page([], "scope-A", { journal_ordinals: { "quiet-send": 1 } });
			},
		),
	);
	assert.equal(calls, 3);
	assert.equal(later.kind, "complete");
	assert.equal(state.orderNeedsReconcile, false);
	assert.equal(state.records.find((r) => r.id === "quiet-send").journalSeq, 1);
});

test("a same-domain authority without a dispatch witness cannot erase newly owed debt", () => {
	let state = start([row("before", 0)]);
	state = R.applyEvent(state, { type: "journal_order_ready", reconcile: true });
	const demand = state.orderDemand;
	state = R.applyHistoryPage(state, page([], "scope-A"), {
		authoritative: true,
	});
	assert.equal(state.orderDemand, demand);
	assert.equal(state.orderNeedsReconcile, true);
});

test("metadata producer retains the established DEV deep-freeze guard and production no-op", async () => {
	for (const DEV of [true, false]) {
		const bundle = await build({
			stdin: {
				contents:
					'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer"; export * from "./src/renderer/src/features/chat/canonical/journal-order";',
				resolveDir: process.cwd(),
			},
			bundle: true,
			format: "esm",
			platform: "node",
			write: false,
			define: { "import.meta.env": JSON.stringify({ DEV }) },
		});
		const M = await import(
			`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
		);
		let state = M.applyHistoryPage(
			M.EMPTY_TRANSCRIPT,
			page([row("before", 0)]),
			{ authoritative: true },
		);
		state = M.appendPendingUser(
			state,
			"own-freeze-send",
			"OWN",
			[{ data: "QQ==", mimeType: "image/png" }],
			1234,
		);
		const prior = state.records.find((r) => r.id === "own-freeze-send");
		const unchanged = state.records.find((r) => r.id === "before");
		state = M.applyJournalOrderMetadata(
			state,
			page([], "scope-A", { journal_ordinals: { "own-freeze-send": 1 } }),
			M.journalOrderRead(state),
		);
		const next = state.records.find((r) => r.id === "own-freeze-send");
		assert.equal(next.images, prior.images);
		assert.equal(
			state.records.find((r) => r.id === "before"),
			unchanged,
		);
		assert.equal(Object.isFrozen(next), DEV);
		assert.equal(Object.isFrozen(next.images), DEV);
		if (DEV) {
			assert.throws(() => {
				next.text = "changed";
			}, TypeError);
			assert.throws(() => {
				next.images.push({ data: "changed", mimeType: "image/png" });
			}, TypeError);
		} else {
			assert.doesNotThrow(() => {
				next.text = "changed";
			});
			assert.doesNotThrow(() => {
				next.images.push({ data: "changed", mimeType: "image/png" });
			});
		}
	}
});

/* ---------------------------------------------------------------------------
 * The complete peer-source contract's consumer half (stage S1): the
 * facts-only lookup, its deliberate non-authority, and the ONE coalesced
 * authoritative read an owed reconcile settles through.
 * ------------------------------------------------------------------------ */

/** An owner metadata answer: the frozen four-key envelope plus source facts. */
const lookupPage = (generation, ordinals = {}, extra = {}) => ({
	entries: [],
	has_more: false,
	cursor_missing: false,
	journal_order_state: "ready",
	journal_generation: generation,
	...(Object.keys(ordinals).length ? { journal_ordinals: ordinals } : {}),
	...extra,
});
/** The loop response shape the peer repair contract declares: `{kind, page}`. */
const asResponse = (kind, pageShape) => ({ kind, page: pageShape });

test("peer declarations carry the exact wire shape; undeclared requests stay byte-identical", () => {
	const authority = R.desktopEndpoint({
		op: "sessions.get",
		sessionId: "aaaaaaaaaaaa",
		journalOrder: true,
		orderIds: ["send"],
		peerJournalSource: true,
	}).path;
	assert.equal(
		authority,
		"/v1/desktop/sessions/aaaaaaaaaaaa?journal_order=1&peer_journal_source=1&order_ids=send",
	);
	// Without the declaration: the request every local conversation has always
	// sent, one byte unchanged by the flag's existence.
	assert.equal(
		R.desktopEndpoint({
			op: "sessions.get",
			sessionId: "aaaaaaaaaaaa",
			journalOrder: true,
			orderIds: ["send"],
		}).path,
		"/v1/desktop/sessions/aaaaaaaaaaaa?journal_order=1&order_ids=send",
	);
	// The facts-only lookup: declaration, purpose and fence in the one order
	// the repair loop budgets against (`journal-order-repair`'s `sweep`).
	const lookup = R.desktopEndpoint({
		op: "sessions.history",
		sessionId: "aaaaaaaaaaaa",
		limit: 100,
		journalOrder: true,
		orderIds: ["send"],
		peerJournalSource: true,
		sourceRead: "metadata",
		expectedJournalGeneration: "scope-A",
	}).path;
	assert.equal(
		lookup,
		"/v1/desktop/sessions/aaaaaaaaaaaa/history?limit=100&journal_order=1&peer_journal_source=1&source_read=metadata&expected_journal_generation=scope-A&order_ids=send",
	);
	assert.ok(Buffer.byteLength(lookup) <= R.JOURNAL_ORDER_QUERY_BYTES);
});

test("a facts-only lookup admits same-domain coordinates without an install, a settle, or a body effect", () => {
	let state = start([row("before", 0, 0.1)]);
	state = R.appendPendingUser(
		state,
		"send",
		"own send",
		[{ data: "QQ==", mimeType: "image/png" }],
		1000,
	);
	state = R.appendPendingUser(state, "unattested", "held", [], 1001);
	const image = state.records.find((record) => record.id === "send").images;
	const held = state.records.find((record) => record.id === "unattested");
	const cursor = state.oldestId;
	const revision = state.orderRevision;
	const next = R.applyPeerSourceFacts(
		state,
		lookupPage("scope-A", { send: 1 }),
		{ authoritative: false },
	);
	const healed = next.records.find((record) => record.id === "send");
	/*
	 * THE FACTS ARE NOT A BODY (complete peer contract, finding 1): the plus one
	 * declared lookup gives the send its same-domain COORDINATE, and neither
	 * releases the hold nor reattests anything — `provisional`/`local` STAY (only
	 * a body-carrying commit, `applyPeerSourcePayload` or an accepted page, ends
	 * the hold and stamps the record). This is the behaviour the architect's RED
	 * reading flipped; the old expectation (hold released on coordinates alone)
	 * belonged to the facts-only S1 that this commit replaces.
	 */
	assert.equal(healed.provisional, true);
	assert.equal(healed.local, true);
	assert.equal(healed.images, image);
	assert.equal(healed.journalSeq, undefined);
	// Same-channel facts DID land: the lookup's coordinate is in the fact map,
	// so the sweep can rank the row without re-asking for its fact.
	assert.equal(next.journalPositions.get("send")?.seq, 1);
	// And the carried, unattested body is now owed for a payload read.
	assert.ok(R.journalBodyOwedIds(next).includes("send"));
	// The answer did not attest "unattested", so its held state is NOT
	// stripped: same record object, hold intact.
	assert.equal(
		next.records.find((record) => record.id === "unattested"),
		held,
	);
	assert.equal(next.oldestId, cursor);
	assert.equal(next.orderRevision, revision);
	assert.equal(next.orderNeedsReconcile, undefined);
});

test("a lookup under a rebuilt source records the debt and never installs; the authority read settles it", () => {
	let state = start([row("present", 0)]);
	state = R.appendPendingUser(state, "send", "own send", [], 1000);
	const records = state.records;
	state = R.applyPeerSourceFacts(
		state,
		{
			entries: [],
			has_more: false,
			cursor_missing: false,
			journal_order_state: "unavailable",
			journal_generation: "scope-B",
			reconcile: true,
		},
		{ authoritative: false },
	);
	// "the generation rides the answer so the client knows a re-read is owed,
	// not as an authority to install": nothing moved.
	assert.equal(state.journalGeneration, "scope-A");
	assert.equal(state.records, records);
	assert.equal(state.orderNeedsReconcile, true);
	assert.equal(state.orderWantedGeneration, "scope-B");
	// The one coalesced authoritative read answers in the wanted domain and
	// settles the demand through its dispatch witness.
	const read = R.journalOrderRead(state);
	state = R.applyHistoryPage(state, page([], "scope-B"), {
		authoritative: true,
		orderRead: read,
	});
	assert.equal(state.journalGeneration, "scope-B");
	assert.equal(state.orderNeedsReconcile, false);
	assert.equal(state.orderWantedGeneration, undefined);
});

test("a reconcile correction with no generation records the generic debt, and never an install", () => {
	let state = start([row("present", 0)]);
	const records = state.records;
	state = R.receiveJournalOrder(
		state,
		{ journal_order_state: "unavailable", reconcile: true },
		[],
		true,
	);
	assert.equal(state.journalMode, true);
	assert.equal(state.orderNeedsReconcile, true);
	assert.equal(state.orderWantedGeneration, undefined);
	assert.notEqual(state.orderDemand, undefined);
	assert.equal(state.journalGeneration, "scope-A");
	assert.equal(state.records, records);
	const demand = state.orderDemand;
	// A byte-identical repeat is not a new fact: same state, same demand
	// object, so the repair loop's stamp cannot mistake it for a wake.
	const repeat = R.receiveJournalOrder(
		state,
		{ journal_order_state: "unavailable", reconcile: true },
		[],
		true,
	);
	assert.equal(repeat, state);
	assert.equal(repeat.orderDemand, demand);
});

/** The loop deps a peer-scoped conversation supplies, mirroring the hook. */
const peerDeps = (getState, setState, read) => ({
	getTranscript: getState,
	isCurrent: () => true,
	read,
	page: (response) => response.page,
	lookupPath: "/v1/desktop/sessions/aaaaaaaaaaaa",
	sweep: (state) => {
		if (state.orderNeedsReconcile === true)
			return {
				kind: "authority",
				path: "/v1/desktop/sessions/aaaaaaaaaaaa",
				query: new URLSearchParams({
					journal_order: "1",
					peer_journal_source: "1",
				}),
			};
		const generation = state.journalGeneration;
		/*
		 * THE THREE-KIND SWEEP (the hook's own): facts first, bodies second, one
		 * kind per iteration. A kind that is fixed to "lookup" would never dispatch
		 * the payload subset - the read that actually admits the body the facts
		 * lookup owed - so the chain would settle coordinates and return, exactly
		 * the defect this cell pins when it goes missing.
		 */
		if (typeof generation !== "string" || generation.length === 0)
			return {
				kind: "none",
				path: "/v1/desktop/sessions/aaaaaaaaaaaa/history",
				query: new URLSearchParams(),
			};
		if (R.journalFactsNeeded(state).length > 0)
			return {
				kind: "lookup",
				path: "/v1/desktop/sessions/aaaaaaaaaaaa/history",
				query: new URLSearchParams({
					limit: "100",
					journal_order: "1",
					peer_journal_source: "1",
					source_read: "metadata",
					expected_journal_generation: generation,
				}),
			};
		if (R.journalBodyOwedIds(state).length > 0)
			return {
				kind: "payload",
				path: "/v1/desktop/sessions/aaaaaaaaaaaa/history",
				query: new URLSearchParams({
					limit: "100",
					journal_order: "1",
					peer_journal_source: "1",
					source_read: "payload",
					expected_journal_generation: generation,
				}),
			};
		return {
			kind: "none",
			path: "/v1/desktop/sessions/aaaaaaaaaaaa/history",
			query: new URLSearchParams(),
		};
	},
	commit: (response, revision, orderRead) => {
		if (R.currentOrderRevision(getState()) !== revision) return;
		/*
		 * THE HOOK'S OWN ROUTING: a peer conversation settles its owed reconcile
		 * through the PEER authoritative commit (`applyPeerSourceFacts` with
		 * `authoritative: true`), never the local metadata commit — the local one
		 * now writes the lane back to local, which would drop the peer debt the
		 * authority read just incurred and cut the chain short. Payload bodies
		 * admit through the subset commit; an ordinary lookup is facts-only.
		 */
		setState(
			response.kind === "authority"
				? R.applyPeerSourceFacts(getState(), response.page, {
						authoritative: true,
						orderRead,
					})
				: response.kind === "payload"
					? R.applyPeerSourcePayload(getState(), response.page, orderRead)
					: R.applyPeerSourceFacts(getState(), response.page, {
							authoritative: false,
						}),
		);
	},
});

test("peer sweeps take the facts-only lookup; an owed reconcile takes one authority read", async () => {
	let state = start([row("present", 0)]);
	state = R.appendPendingUser(state, "send", "own send", [], 1000);
	state = R.appendPendingUser(state, "other", "held", [], 1001);
	const calls = [];
	const outcome = await R.repairJournalOrder(
		peerDeps(
			() => state,
			(next) => {
				state = next;
			},
			async (orderIds, kind) => {
				calls.push({ ids: [...orderIds], kind });
				if (kind === "lookup") {
					// The first lookup meets a REBUILT source; the second (after
					// the authority read installed B) answers in B.
					if (state.journalGeneration !== "scope-B")
						return {
							kind,
							page: {
								entries: [],
								has_more: false,
								cursor_missing: false,
								journal_order_state: "unavailable",
								journal_generation: "scope-B",
								reconcile: true,
							},
						};
					return {
						kind,
						page: lookupPage("scope-B", { present: 0 }),
					};
				}
				if (kind === "payload")
					return {
						kind,
						page: page(
							orderIds.map((id, at) => row(id, at === 0 ? 0 : 1)),
							"scope-B",
							{ source_present_ids: [...orderIds] },
						),
					};
				return {
					kind,
					page: page([], "scope-B", {
						journal_ordinals: { send: 1, other: 2 },
					}),
				};
			},
		),
	);
	/*
	 * THE CHAIN (the unified commit), and its four exact reads: the facts lookup
	 * that meets the rebuilt source, the ONE coalesced authoritative read its owed
	 * reconcile earns (which installs scope-B and owes every loaded body), the
	 * re-lookup that places whatever B can attest, and the typed payload subset
	 * that admits the owed bodies under B and settles the debt. The old
	 * `['lookup','authority','lookup']` shape was the S1 sweep; the terminal
	 * payload read is what makes the complete contract's body recovery real.
	 */
	assert.equal(outcome.kind, "complete");
	assert.deepEqual(
		calls.map((call) => call.kind),
		["lookup", "authority", "lookup", "payload"],
	);
	// Every batch is bounded, and the lookup batch's own wire shape fits the
	// encoded budget the loop sized it against.
	assert.ok(calls.every((call) => call.ids.length <= R.JOURNAL_ORDER_ID_LIMIT));
	assert.ok(
		Buffer.byteLength(
			R.desktopEndpoint({
				op: "sessions.history",
				sessionId: "aaaaaaaaaaaa",
				limit: 100,
				journalOrder: true,
				orderIds: calls[0].ids,
				peerJournalSource: true,
				sourceRead: "metadata",
				expectedJournalGeneration: "scope-A",
			}).path,
		) <= R.JOURNAL_ORDER_QUERY_BYTES,
	);
	assert.equal(state.journalGeneration, "scope-B");
	assert.equal(state.orderNeedsReconcile, false);
	assert.deepEqual(R.journalLookupIds(state), []);
	assert.equal(
		state.records.find((record) => record.id === "present").journalSeq,
		0,
	);
	assert.equal(
		state.records.find((record) => record.id === "send").journalSeq,
		1,
	);
});

test("a continuation page with no coordinates ranks above the tail, in both lanes", () => {
	// A `before_id` page answered while the owner's index is still building:
	// right rows, no `journal_seq` (see `JournalPosition.sourcePrecedes`).
	const building = (entries) => ({
		entries: entries.map(({ journal_seq: _seq, ...entry }) => entry),
		has_more: true,
		cursor_missing: false,
		journal_order_state: "building",
	});
	for (const peerSource of [false, true]) {
		const lane = peerSource ? "peer" : "local";
		let state = R.applyHistoryPage(
			R.EMPTY_TRANSCRIPT,
			page([row("t4", 4), row("t5", 5), row("t6", 6)]),
			{ authoritative: true, peerSource },
		);
		state = R.applyHistoryPage(
			state,
			building([row("y0", 0), row("y1", 1), row("y2", 2)]),
			{ pagedBefore: "t4", peerSource },
		);
		assert.deepEqual(ids(state), ["y0", "y1", "y2", "t4", "t5", "t6"], lane);
		// A second building continuation goes above the first.
		state = R.applyHistoryPage(state, building([row("x0", 0)]), {
			pagedBefore: "y0",
			peerSource,
		});
		assert.deepEqual(
			ids(state),
			["x0", "y0", "y1", "y2", "t4", "t5", "t6"],
			lane,
		);
		// A live row still joins at the end, and keeps its place.
		state = R.applyEvent(
			state,
			{ type: "message_end", message: msg("live", "assistant") },
			900000,
		);
		assert.equal(ids(state).at(-1), "live", lane);
	}
});

test("a rotation after a building continuation heals once the new domain's coordinates land, in both lanes", () => {
	// The review round 1 shape (R1-M1 / QA Q2): a `before_id` page read while
	// the owner's index is building, then a domain rotation (`compact_file`
	// rewrites the journal, the index re-scans under a fresh generation) whose
	// tail page covers only the newest rows, then the new domain's coordinates
	// for every row. The old tail rows lose their placement at the rotation;
	// they must not be re-anchored into a loop with the continuation rows, or
	// the settled order is wrong for good (nothing asks again: every row then
	// carries a current coordinate, so the lookup set is empty).
	const building = (entries) => ({
		entries: entries.map(({ journal_seq: _seq, ...entry }) => entry),
		has_more: true,
		cursor_missing: false,
		journal_order_state: "building",
	});
	const settled = ["y0", "y1", "y2", "y3", "t4", "t5", "t6", "t7", "t8"];
	// Both lanes are read before any assertion, so a failure shows each lane.
	const actual = {};
	for (const peerSource of [false, true]) {
		const lane = peerSource ? "peer" : "local";
		const series = {};
		actual[lane] = series;
		let state = R.applyHistoryPage(
			R.EMPTY_TRANSCRIPT,
			page([row("t4", 4), row("t5", 5)]),
			{ authoritative: true, peerSource },
		);
		state = R.applyHistoryPage(
			state,
			building([row("y0", 0), row("y1", 1), row("y2", 2), row("y3", 3)]),
			{ pagedBefore: "t4", peerSource },
		);
		series.continuation = ids(state).join(" ");
		// The rotated domain's tail: only the newest rows.
		state = R.applyHistoryPage(
			state,
			page([row("t6", 6), row("t7", 7), row("t8", 8)], "scope-B"),
			{ authoritative: true, peerSource },
		);
		// Every row placed in the new domain (the owner's correction / repair).
		state = R.applyEvent(state, {
			type: "journal_order_ready",
			journal_generation: "scope-B",
			rows: settled.map((id, seq) => ({ id, journal_seq: seq })),
		});
		series.settled = ids(state).join(" ");
		// Live rows still join at the end and keep it.
		state = R.applyEvent(
			state,
			{ type: "message_end", message: msg("live", "assistant") },
			900000,
		);
		series.live = ids(state).join(" ");
	}
	const expected = {
		continuation: settled.slice(0, 6).join(" "),
		settled: settled.join(" "),
		live: [...settled, "live"].join(" "),
	};
	assert.deepEqual(actual, { local: expected, peer: expected });
});

test("a continuation onto an open page that was itself building still ranks above it, in both lanes", () => {
	// Review round 1 R1-m1 / QA Q3: the open's page answered `building` too, so
	// the row a continuation is loaded in front of has no coordinate either. The
	// older page must still paint above it, and a live row still joins below.
	const building = (entries) => ({
		entries: entries.map(({ journal_seq: _seq, ...entry }) => entry),
		has_more: true,
		cursor_missing: false,
		journal_order_state: "building",
	});
	const actual = {};
	for (const peerSource of [false, true]) {
		const lane = peerSource ? "peer" : "local";
		let state = R.applyHistoryPage(
			R.EMPTY_TRANSCRIPT,
			building([row("t4", 4), row("t5", 5), row("t6", 6)]),
			{ authoritative: true, peerSource },
		);
		state = R.applyHistoryPage(
			state,
			building([row("y0", 0), row("y1", 1), row("y2", 2)]),
			{ pagedBefore: "t4", peerSource },
		);
		const series = { continuation: ids(state).join(" ") };
		actual[lane] = series;
		state = R.applyEvent(
			state,
			{ type: "message_end", message: msg("live", "assistant") },
			900000,
		);
		series.live = ids(state).join(" ");
	}
	const expected = {
		continuation: "y0 y1 y2 t4 t5 t6",
		live: "y0 y1 y2 t4 t5 t6 live",
	};
	assert.deepEqual(actual, { local: expected, peer: expected });
});
