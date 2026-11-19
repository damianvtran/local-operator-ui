/**
 * Nested write/edit diff bindings (`tool_call_diff_binding_v1`): the strict
 * decoder, the two admission doors, the reducer's one-record-per-call rule and
 * the request flag that asks the core for the projected rows.
 *
 * WHY ONE BUNDLE. Admission is a WeakSet over payload OBJECTS inside
 * `diff-history-model.ts`; the reducer and the admission helpers must come from
 * the SAME module instance or a test would admit into one set and read another.
 * Contract: local-operator `docs/DESKTOP_API.md` ("Nested write/edit diff
 * bindings") and `open_frame.py::_diff_binding_payload`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
			'export { DIFF_BINDING_CUSTOM_TYPE, parseDiffBinding, admitProjectedDiffBindings, rawDiffBindingCandidates, admitVerifiedDiffBinding, isAdmittedDiffBinding } from "./src/renderer/src/features/chat/components/trace/diff-history-model";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@shared/i18n": "./src/i18n",
	},
	write: false,
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
	parseDiffBinding,
	admitProjectedDiffBindings,
	rawDiffBindingCandidates,
	admitVerifiedDiffBinding,
	isAdmittedDiffBinding,
	desktopEndpoint,
	desktopRequestSchema,
} = m;

// Synthetic ids that satisfy the contract's `sessionIdPattern` (12 lowercase
// hex), so the request-schema node is judged on `callId`, not rejected on
// `sessionId` first.
const PARENT = "fc00000000a1";
const CHILD = "fc00000000c2";
const OUTER = "toolu_eval1";
const CALL = `${OUTER}:0123456789abcdef0123456789abcdef`;

function bindingPayload(overrides, detailOverrides, descriptor) {
	return {
		custom_type: "tool_call_diff_binding_v1",
		details: {
			v: 1,
			session_id: PARENT,
			outer_call_id: OUTER,
			call_id: CALL,
			tool: "edit",
			diff_full: descriptor ?? { v: 1, state: "archived", rows: 450 },
			...(detailOverrides ?? {}),
		},
		...(overrides ?? {}),
	};
}
const page = (entries) => ({ entries, has_more: false, cursor_missing: false });
const entry = (payload, id = "binding-1") => ({
	id,
	ts: 5,
	type: "custom",
	payload,
});
const tools = (state) => state.records.filter((r) => r.kind === "tool");

test("decode: a valid binding for the viewed session parses; digest is dropped", () => {
	const b = parseDiffBinding(
		bindingPayload(
			{},
			{},
			{ v: 1, state: "archived", rows: 450, digest: "abc" },
		),
		PARENT,
	);
	assert.deepEqual(b, {
		callId: CALL,
		outerCallId: OUTER,
		tool: "edit",
		descriptor: { state: "archived", rows: 450 },
	});
});

test("decode: every forgery shape fails closed", () => {
	const bad = [
		[bindingPayload(), CHILD], // claims the parent, viewed as the child
		[bindingPayload(), null],
		[bindingPayload({ extra: 1 }), PARENT],
		[bindingPayload({}, { path: "/etc/passwd" }), PARENT],
		[bindingPayload({}, { output: "wrote" }), PARENT],
		[bindingPayload({}, { v: 2 }), PARENT],
		[bindingPayload({}, { tool: "bash" }), PARENT],
		[bindingPayload({}, { call_id: "toolu_other:1" }), PARENT],
		[bindingPayload({}, { call_id: `${OUTER}:` }), PARENT],
		[bindingPayload({}, {}, { v: 1, state: "archived", rows: 1.5 }), PARENT],
		[
			bindingPayload({}, {}, { v: 1, state: "archived", rows: 2 ** 60 }),
			PARENT,
		],
		[
			bindingPayload(
				{},
				{},
				{ v: 1, state: "archived", rows: 3, preview: "x" },
			),
			PARENT,
		],
		[bindingPayload({}, {}, { v: 1, state: "archived", digest: 7 }), PARENT],
		[bindingPayload({}, {}, { v: "1", state: "archived" }), PARENT],
	];
	for (const [payload, scope] of bad)
		assert.equal(
			parseDiffBinding(payload, scope),
			null,
			JSON.stringify(payload),
		);
});

test("reducer: an unadmitted binding (raw lookalike) paints nothing", () => {
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		page([entry(bindingPayload())]),
	);
	assert.equal(tools(state).length, 0);
	assert.equal(state.records.length, 0);
});

test("reducer: a projected binding is ONE capture-only record keyed by the nested call", () => {
	const rows = [entry(bindingPayload())];
	assert.equal(admitProjectedDiffBindings(rows, PARENT), 1);
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, page(rows));
	const [row] = tools(state);
	assert.equal(row.id, `tool:${CALL}`);
	assert.equal(row.toolCallId, CALL);
	assert.equal(row.toolName, "edit");
	assert.equal(row.captureOnly, true);
	// Metadata is not an executor result: no output, no error, no counts.
	assert.equal(row.output, null);
	assert.equal(row.isError, false);
	assert.equal(row.durationS, null);
	assert.deepEqual([row.added, row.removed], [0, 0]);
	assert.equal(row.diff, null);
	assert.deepEqual(row.diffFull, { state: "archived", rows: 450 });
});

test("reducer: a projected page admits only bindings for the REQUESTED session", () => {
	const rows = [entry(bindingPayload({}, { session_id: CHILD }))];
	assert.equal(admitProjectedDiffBindings(rows, PARENT), 0);
	assert.equal(tools(applyHistoryPage(EMPTY_TRANSCRIPT, page(rows))).length, 0);
});

test("reducer: a replayed binding upserts the same record (stable key, no duplicate)", () => {
	const first = [entry(bindingPayload())];
	admitProjectedDiffBindings(first, PARENT);
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, page(first));
	const again = [entry(bindingPayload())]; // a fresh read builds fresh objects
	admitProjectedDiffBindings(again, PARENT);
	state = applyHistoryPage(state, page(again));
	assert.equal(tools(state).length, 1);
	assert.equal(tools(state)[0].id, `tool:${CALL}`);
});

test("reducer: a live record for the call keeps its executor status and only gains the descriptor", () => {
	const live = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		page([
			{
				id: "t-nested",
				ts: 4,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: CALL,
					tool_name: "edit",
					is_error: true,
					content: [{ text: "edit failed", type: "text" }],
					provider_payload: { duration_s: 0.2 },
				},
			},
		]),
	);
	const rows = [entry(bindingPayload())];
	admitProjectedDiffBindings(rows, PARENT);
	const state = applyHistoryPage(live, page(rows));
	const all = tools(state);
	assert.equal(all.length, 1);
	assert.equal(all[0].isError, true);
	assert.equal(all[0].output, "edit failed");
	assert.notEqual(all[0].captureOnly, true);
	assert.deepEqual(all[0].diffFull, { state: "archived", rows: 450 });
});

test("reducer: a binding in the message envelope never paints its JSON as text", () => {
	const payload = { kind: "custom", ...bindingPayload() };
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		page([{ id: "m1", ts: 1, type: "message", payload }]),
	);
	assert.equal(state.records.length, 0);
});

test("child door: raw candidates need the viewed child id, and paint only once the GET verified them", () => {
	const forgedParent = entry(bindingPayload(), "b-parent");
	const childRow = entry(bindingPayload({}, { session_id: CHILD }), "b-child");
	const candidates = rawDiffBindingCandidates([forgedParent, childRow], CHILD);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].binding.callId, CALL);
	assert.equal(isAdmittedDiffBinding(childRow.payload), false);
	// A 404 or failed lookup admits nothing.
	assert.equal(admitVerifiedDiffBinding(childRow.payload, "not_found"), false);
	assert.equal(admitVerifiedDiffBinding(childRow.payload, null), false);
	assert.equal(
		tools(applyHistoryPage(EMPTY_TRANSCRIPT, page([childRow]))).length,
		0,
	);
	assert.equal(admitVerifiedDiffBinding(childRow.payload, "archived"), true);
	assert.equal(
		tools(applyHistoryPage(EMPTY_TRANSCRIPT, page([childRow]))).length,
		1,
	);
});

test("request: the projected history asks for diff_bindings beside open_frame, and only then", () => {
	const on = desktopEndpoint({
		op: "sessions.history",
		sessionId: PARENT,
		limit: 10,
		openFrame: true,
	});
	const off = desktopEndpoint({
		op: "sessions.history",
		sessionId: PARENT,
		limit: 10,
		openFrame: false,
	});
	assert.match(on.path, /open_frame=1/);
	assert.match(on.path, /diff_bindings=1/);
	assert.doesNotMatch(off.path, /diff_bindings/);
});

test("request: a nested call id reaches the scoped diff routes; a path does not", () => {
	const ok = (callId, op = "sessions.diff") =>
		desktopRequestSchema.safeParse({
			op,
			sessionId: PARENT,
			...(op === "subagents.diff" ? { childId: CHILD } : {}),
			callId,
			start: 0,
			limit: 200,
		}).success;
	assert.equal(ok(CALL), true);
	assert.equal(ok(CALL, "subagents.diff"), true);
	assert.equal(ok("toolu_plain"), true);
	assert.equal(ok("a:b:c"), false);
	assert.equal(ok("../x"), false);
	assert.equal(ok(`${OUTER}:`), false);
	const path = desktopEndpoint({
		op: "subagents.diff",
		sessionId: PARENT,
		childId: CHILD,
		callId: CALL,
		start: 0,
		limit: 200,
	}).path;
	assert.match(path, /tool-calls\/toolu_eval1%3A0123/);
});
