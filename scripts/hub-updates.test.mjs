import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The hub auto-update UI's decisions and wire vocabulary.
 *
 *     node --test scripts/hub-updates.test.mjs
 *
 * WHAT IT PINS, and the instrument for each:
 *
 *   1. WHICH MARK AN ITEM GETS (`hubMarkFor`) and the sentence behind it - the
 *      B6.2/B6.4 rules. Pure functions, bundled and called directly. The case
 *      that matters most is "available with auto-update OFF still shows a
 *      mark": the operator asked for indicators in manual mode, and a filter
 *      that only drew marks for `auto_will_apply` would pass every other case.
 *   2. NO-CREDENTIAL IS NOT A ROW MARK (B6.2.4) and the sign-in line appears
 *      only for a user who has something linked (B6.2.6: zero UI cost for a
 *      user who never used the hub).
 *   3. THE COPY TABLE (B6.4) verbatim, and an unknown class degrading to a
 *      generic sentence rather than to `undefined`.
 *   4. THE FIVE OPS ARE IN THE CLOSED VOCABULARY, compose the routes the
 *      backend serves (B5.1), and refuse a stray field (`.strict()`) or a
 *      malformed request id. This is the half a mocked story cannot see: a
 *      story stubs the bridge, so a wrong path here would render fine.
 *
 * WHAT IT DOES NOT PROVE: that the backend answers these routes (QA's live
 * pass does) or that any of it renders (the frames on the pull request do).
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/hub-updates";' +
			' export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
	external: ["zod"],
	tsconfig: "tsconfig.app.json",
});
const source = `${bundle.outputFiles[0].text}`;
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
).catch(async () => {
	// `zod` is external so the bundle keeps one copy; a data: URL cannot resolve
	// it, so the fallback writes beside the repo's node_modules.
	const { writeFileSync, unlinkSync } = await import("node:fs");
	const file = `${process.cwd()}/scripts/.hub-updates.bundle.${process.pid}.mjs`;
	writeFileSync(file, source);
	try {
		return await import(file);
	} finally {
		unlinkSync(file);
	}
});

const item = (over = {}) => ({
	kind: "agent",
	name: "coder",
	state: "available",
	classification: "remote-only",
	auto_will_apply: false,
	...over,
});
const updates = (over = {}) => ({
	generated_at: "2026-09-29T12:00:00Z",
	credential: "ok",
	settings: { auto_agents: false, auto_teams: false, interval_min: 60 },
	counts: { available: 1, "up-to-date": 3 },
	items: [item()],
	...over,
});
const REQUEST = "0f0e0d0c-0b0a-4908-8706-050403020100";

test("an available item is marked whether or not auto-update is on", () => {
	assert.deepEqual(mod.hubMarkFor(item({ auto_will_apply: false })), {
		kind: "available",
		auto: false,
	});
	assert.deepEqual(mod.hubMarkFor(item({ auto_will_apply: true })), {
		kind: "available",
		auto: true,
	});
});

test("up-to-date, absent and no-credential items draw no mark", () => {
	assert.equal(mod.hubMarkFor(undefined), null);
	assert.equal(mod.hubMarkFor(item({ state: "up-to-date" })), null);
	assert.equal(
		mod.hubMarkFor(item({ state: "available", error_class: "no-credential" })),
		null,
	);
	assert.equal(mod.hubMarkFor(item({ state: "some-future-state" })), null);
});

test("a refused merge goes to review; other failures go to retry", () => {
	assert.deepEqual(mod.hubMarkFor(item({ error_class: "merge-refused" })), {
		kind: "review",
	});
	assert.deepEqual(mod.hubMarkFor(item({ state: "failed" })), {
		kind: "failed",
	});
	assert.deepEqual(mod.hubMarkFor(item({ error_class: "provider-error" })), {
		kind: "failed",
	});
	assert.deepEqual(mod.hubMarkFor(item({ state: "updating" })), {
		kind: "updating",
	});
});

test("the accessible name states the action and names the item", () => {
	assert.equal(
		mod.hubMarkLabel("coder", { kind: "available", auto: false }),
		"Update coder from the hub",
	);
	assert.equal(
		mod.hubMarkLabel("coder", { kind: "failed" }),
		"Retry the hub update for coder",
	);
});

test("the detail separates 'updates automatically' from 'needs you'", () => {
	const auto = mod.hubMarkDetail(item({ auto_will_apply: true }), {
		kind: "available",
		auto: true,
	});
	assert.match(auto, /automatically/);
	const needsYou = mod.hubMarkDetail(item({ classification: "both-changed" }), {
		kind: "available",
		auto: false,
	});
	assert.match(needsYou, /needs you/);
	assert.doesNotMatch(needsYou, /automatically/);
});

test("the copy table is B6.4 verbatim, and an unknown class is generic", () => {
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "provider-error" })),
		"Couldn't reach your model to merge this. Will retry; or retry now.",
	);
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "model-unavailable" })),
		"No model available for merging. Check Settings › Agent Hub.",
	);
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "prompt-too-long" })),
		"This one is too large to merge automatically.",
	);
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "merge-refused" })),
		"The hub and your copy both changed the same part. Review it.",
	);
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "concurrent-edit" })),
		"It changed while updating. Try again.",
	);
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "hub-item-missing" })),
		"No longer available on the hub (or you lost access).",
	);
	const generic = mod.hubErrorSentence(
		item({ error_class: "from-the-future" }),
	);
	assert.ok(generic.length > 10 && !generic.includes("undefined"));
	// The raw exception text is never the copy.
	assert.doesNotMatch(
		mod.hubErrorSentence(
			item({ error_class: "provider-error", last_error: "Traceback (most" }),
		),
		/Traceback/,
	);
});

test("the sign-in line needs a credential problem AND something linked", () => {
	assert.equal(mod.hubSignInLine(undefined), null);
	assert.equal(mod.hubSignInLine(updates()), null);
	assert.equal(
		mod.hubSignInLine(updates({ credential: "none", counts: {}, items: [] })),
		null,
	);
	assert.equal(
		mod.hubSignInLine(
			updates({ credential: "none", counts: { "up-to-date": 2 }, items: [] }),
		),
		"Sign in to Radient to get hub updates",
	);
});

test("update-all counts only what a click would take, per kind", () => {
	const data = updates({
		items: [
			item({ name: "a" }),
			item({ name: "b", kind: "team" }),
			item({ name: "c", error_class: "merge-refused" }),
			item({ name: "d", state: "failed" }),
		],
	});
	assert.equal(mod.hubAvailableCount(data, "agent"), 1);
	assert.equal(mod.hubAvailableCount(data, "team"), 1);
});

test("the roll-up names the outcomes and never says nothing", () => {
	assert.equal(
		mod.hubRollup([
			{ applied: true, outcome: "merged" },
			{ applied: true, outcome: "merged" },
			{ applied: true, outcome: "merged" },
			{ applied: false, outcome: "needs-review" },
		]),
		"3 updated, 1 needs your review",
	);
	assert.equal(mod.hubRollup([]), "Nothing needed updating.");
});

test("the five ops compose the backend's routes", () => {
	assert.deepEqual(mod.desktopEndpoint({ op: "hub.updates" }), {
		path: "/v1/desktop/hub/updates",
		method: "GET",
	});
	assert.deepEqual(
		mod.desktopEndpoint({
			op: "hub.apply",
			requestId: REQUEST,
			kind: "agent",
			name: "coder",
			prefer: "local",
		}),
		{
			path: "/v1/desktop/hub/updates/apply",
			method: "POST",
			body: {
				request_id: REQUEST,
				kind: "agent",
				name: "coder",
				prefer: "local",
			},
		},
	);
	assert.equal(
		mod.desktopEndpoint({ op: "hub.applyAll", requestId: REQUEST }).path,
		"/v1/desktop/hub/updates/apply-all",
	);
	assert.deepEqual(
		mod.desktopEndpoint({ op: "hub.applyAll", requestId: REQUEST }).body,
		{ request_id: REQUEST },
	);
	assert.equal(
		mod.desktopEndpoint({
			op: "hub.retry",
			requestId: REQUEST,
			kind: "team",
			name: "lopdev",
		}).path,
		"/v1/desktop/hub/updates/retry",
	);
	assert.equal(
		mod.desktopEndpoint({ op: "hub.check", requestId: REQUEST }).path,
		"/v1/desktop/hub/updates/check",
	);
});

test("the schema is closed: stray fields, bad kinds and bad ids are refused", () => {
	const parse = (request) =>
		mod.desktopRequestSchema.safeParse(request).success;
	assert.equal(parse({ op: "hub.updates" }), true);
	assert.equal(parse({ op: "hub.updates", extra: 1 }), false);
	assert.equal(
		parse({ op: "hub.apply", requestId: REQUEST, kind: "agent", name: "x" }),
		true,
	);
	assert.equal(
		parse({ op: "hub.apply", requestId: REQUEST, kind: "skill", name: "x" }),
		false,
	);
	assert.equal(
		parse({ op: "hub.apply", requestId: "nope", kind: "agent", name: "x" }),
		false,
	);
	assert.equal(
		parse({
			op: "hub.apply",
			requestId: REQUEST,
			kind: "agent",
			name: "x",
			prefer: "both",
		}),
		false,
	);
	// A conflict decision is per item: apply-all must not accept `prefer`.
	assert.equal(
		parse({ op: "hub.applyAll", requestId: REQUEST, prefer: "local" }),
		false,
	);
	assert.equal(
		parse({ op: "hub.retry", requestId: REQUEST, kind: "team" }),
		false,
	);
});
