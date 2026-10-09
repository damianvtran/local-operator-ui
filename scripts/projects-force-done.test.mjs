import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * "MARK DONE ANYWAY": the pure half of the projects-board status-refusal fix.
 *
 * WHAT THIS FILE PINS, and why each piece is separable from the dialog:
 *
 *  1. THE WIRE. `projects.update` gained an optional TOP-LEVEL `force_done`
 *     (the daemon's escape from the done-gate). It must (a) be rejected inside
 *     `fields` - the strict schema is what keeps a flag about the CALL from
 *     being mistaken for a field of the ROW - and (b) reach the PATCH body only
 *     when TRUE, so every other write is byte-identical to what shipped before
 *     and an older daemon (which 422s an unknown body key) is never sent one.
 *  2. THE CLASSIFIER. The daemon declares the open-milestones refusal with the
 *     machine code `project_done_incomplete` and the names in `incomplete`. The
 *     CODE is what authorises the force offer; a sentence-only match (an older
 *     daemon saying `project_invalid`) is still recognised, so it can be
 *     spoken, but is marked `coded: false` so nothing offers it a force.
 *  3. THE COPY: plural-correct question, the names truncated with "and N more",
 *     the forced-close toast's count read from the PATCH answer's own row.
 *  4. THE RETRY POLICY. A 4xx PATCH is a refusal; sending it twice only delays
 *     the sentence by the backoff. Transport failures keep the single retry.
 *
 * Bundled rather than imported (the `projects-inline-edit.test.mjs` pattern):
 * these are TypeScript modules in the renderer tree.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as model from "./src/renderer/src/features/projects/project-model";',
			'export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";',
			'export { retryDesktopMutation, retryDesktopQuery } from "./src/renderer/src/shared/api/local-operator/backend-error";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared/hooks/use-optional-query-client":
			"./src/renderer/src/shared/hooks/use-optional-query-client.ts",
	},
});
const {
	model,
	desktopRequestSchema,
	desktopEndpoint,
	retryDesktopMutation,
	retryDesktopQuery,
	DesktopControlError,
	defaultQueryOptions,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	doneGateRefusal,
	doneGateQuestion,
	doneGateNamesClause,
	forcedCloseToastText,
	refusalCopy,
	PROJECT_DONE_INCOMPLETE_CODE,
	PROJECT_NOT_MOVED_COPY,
} = model;

/* ---------------------------------------------------------------- the wire */

test("force_done is accepted at the op's top level and rejected inside fields", () => {
	const top = desktopRequestSchema.safeParse({
		op: "projects.update",
		key: "p1",
		fields: { status: "done" },
		force_done: true,
	});
	assert.equal(top.success, true, "top-level force_done is the contract");
	const nested = desktopRequestSchema.safeParse({
		op: "projects.update",
		key: "p1",
		fields: { status: "done", force_done: true },
	});
	assert.equal(
		nested.success,
		false,
		"force_done inside fields would be a flag mistaken for a row field",
	);
	const wrongType = desktopRequestSchema.safeParse({
		op: "projects.update",
		key: "p1",
		fields: { status: "done" },
		force_done: "true",
	});
	assert.equal(wrongType.success, false, "the daemon takes a strict boolean");
});

test("the PATCH body carries force_done only when it is true", () => {
	const body = (extra) =>
		desktopEndpoint(
			desktopRequestSchema.parse({
				op: "projects.update",
				key: "p1",
				fields: { status: "done" },
				...extra,
			}),
		).body;
	assert.deepEqual(body({}), { status: "done" }, "omitted: body unchanged");
	assert.deepEqual(
		body({ force_done: false }),
		{ status: "done" },
		"false is the same request as absent and must not travel",
	);
	assert.deepEqual(body({ force_done: true }), {
		status: "done",
		force_done: true,
	});
	const endpoint = desktopEndpoint({
		op: "projects.update",
		key: "a b",
		fields: { status: "done" },
		force_done: true,
	});
	assert.equal(endpoint.method, "PATCH");
	assert.equal(endpoint.path, "/v1/desktop/projects/a%20b");
});

/* ---------------------------------------------------------- the classifier */

const SENTENCE =
	"cannot set status 'done': 2 milestones still incomplete ('api parity', \"it's late\") \u2014 complete them, or pass force_done=true to close with them open";

test("the machine code classifies, with the names from `incomplete`", () => {
	const refusal = doneGateRefusal({
		code: PROJECT_DONE_INCOMPLETE_CODE,
		message: SENTENCE,
		detail: {
			code: "project_done_incomplete",
			message: SENTENCE,
			incomplete: ["api parity", "it's late"],
		},
	});
	assert.deepEqual(refusal, {
		count: 2,
		names: ["api parity", "it's late"],
		coded: true,
	});
});

test("a coded refusal with an unreadable list still classifies, from the sentence", () => {
	const refusal = doneGateRefusal({
		code: PROJECT_DONE_INCOMPLETE_CODE,
		message: SENTENCE,
		detail: { code: "project_done_incomplete" },
	});
	assert.equal(refusal.coded, true);
	assert.deepEqual(refusal.names, ["api parity", "it's late"]);
	assert.equal(refusal.count, 2);
});

test("a coded refusal with neither list nor parsable sentence gets no names, not a crash", () => {
	const refusal = doneGateRefusal({
		code: PROJECT_DONE_INCOMPLETE_CODE,
		message: "something reworded",
		detail: { incomplete: [] },
	});
	assert.deepEqual(refusal, { count: 0, names: [], coded: true });
});

test("an older daemon's sentence-only refusal is recognised but NEVER offered a force", () => {
	const refusal = doneGateRefusal({
		code: "project_invalid",
		message: SENTENCE,
	});
	assert.equal(refusal.coded, false, "no code, no force offer");
	assert.deepEqual(refusal.names, ["api parity", "it's late"]);
});

test("other refusals and non-refusals are not the done-gate", () => {
	assert.equal(
		doneGateRefusal({ code: "project_invalid", message: "bad date" }),
		null,
	);
	assert.equal(doneGateRefusal({ code: null, message: "" }), null);
});

/* ---------------------------------------------------------------- the copy */

test("the question agrees in number and truncates long lists", () => {
	assert.equal(
		doneGateQuestion({ count: 1, names: ["beta cut"], coded: true }),
		"1 milestone is still open (beta cut). Mark done anyway?",
	);
	assert.equal(
		doneGateQuestion({ count: 2, names: ["a", "b"], coded: true }),
		"2 milestones are still open (a and b). Mark done anyway?",
	);
	const seven = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
	assert.equal(
		doneGateQuestion({ count: 7, names: seven, coded: true }),
		"7 milestones are still open (m1, m2, m3 and 4 more). Mark done anyway?",
	);
	assert.equal(
		doneGateQuestion({ count: 4, names: [], coded: true }),
		"4 milestones are still open. Mark done anyway?",
		"no names, no empty parentheses",
	);
});

test("the names clause: exactly at the cap is spelled out, one over truncates", () => {
	assert.equal(doneGateNamesClause(["a", "b", "c"]), "a, b and c");
	assert.equal(doneGateNamesClause(["a", "b", "c", "d"]), "a, b, c and 1 more");
});

test("the forced-close toast says it closed with N open, N from the answer's row", () => {
	const row = {
		forced_done: true,
		milestones_total: 9,
		milestones_completed: 2,
	};
	assert.equal(
		forcedCloseToastText(row, 99, "Done"),
		"Moved to Done with 7 milestones still open",
	);
	assert.equal(
		forcedCloseToastText(
			{ forced_done: true, milestones_total: 3, milestones_completed: 2 },
			9,
			"Done",
		),
		"Moved to Done with 1 milestone still open",
	);
	assert.equal(
		forcedCloseToastText({ forced_done: true }, 4, "Done"),
		"Moved to Done with 4 milestones still open",
		"an unreadable row falls back to the count the dialog showed",
	);
	assert.equal(
		forcedCloseToastText({ forced_done: false }, 4, "Done"),
		"Moved to Done",
		"nothing was left open by the time it landed: an ordinary move",
	);
	assert.equal(forcedCloseToastText(null, 4, "Done"), "Moved to Done");
});

test("the refusal copy and the not-moved fallback are in the app's voice", () => {
	assert.match(
		refusalCopy(SENTENCE),
		/^This can't be marked done yet: 2 milestones are still incomplete/,
	);
	assert.match(PROJECT_NOT_MOVED_COPY, /^The project was not moved\./);
});

/* ------------------------------------------------------------ retry policy */

const refused = (status) => new DesktopControlError(status, "refused");

test("a 4xx refusal is not retried; transport and 5xx failures keep the single retry", () => {
	assert.equal(retryDesktopMutation(0, refused(422)), false);
	assert.equal(retryDesktopMutation(0, refused(409)), false);
	assert.equal(retryDesktopMutation(0, refused(404)), false);
	assert.equal(retryDesktopMutation(0, refused(500)), true);
	assert.equal(retryDesktopMutation(0, refused(503)), true);
	assert.equal(retryDesktopMutation(0, refused(null)), true);
	assert.equal(retryDesktopMutation(0, new Error("boom")), true);
	assert.equal(
		retryDesktopMutation(1, refused(503)),
		false,
		"once, not forever",
	);
});

test("the app default still retries mutations, so the override is what changes 422", () => {
	// Guards the premise: if the default ever stopped retrying, this opt-out
	// would be dead code and the test above would be pinning nothing.
	assert.equal(defaultQueryOptions.mutations.retry, 1);
	assert.equal(typeof retryDesktopQuery, "function");
});
