import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
			' export { desktopEndpoint, desktopRequestDeadlineDetail, desktopRequestDeadlineMs, desktopRequestSchema } from "./src/shared/desktop-contract";',
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
		retryable: true,
	});
	assert.deepEqual(mod.hubMarkFor(item({ error_class: "provider-error" })), {
		kind: "failed",
		retryable: true,
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
		mod.hubMarkLabel("coder", { kind: "failed", retryable: true }),
		"Retry the hub update for coder",
	);
	// A retry cannot change these answers, so the control says it opens details.
	assert.equal(
		mod.hubMarkLabel("coder", { kind: "failed", retryable: false }),
		"See why the hub update for coder failed",
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

test("the copy table is B6.4 (with the provider-error line re-worded), and an unknown class is generic", () => {
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "provider-error" })),
		"Couldn't reach the model that merges this. It retries on its own; press Retry to try now.",
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
	// The two classes that are NOT in B6.4's table. `hub-error` is the one the
	// backend raises for a failed FETCH as well as a failed write, so its sentence
	// names neither direction (UX round 2, U12).
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "no-credential" })),
		"Sign in to Radient to update from the hub.",
	);
	assert.equal(
		mod.hubErrorSentence(item({ error_class: "hub-error" })),
		"The update didn't complete. Try again.",
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

test("the sign-in line is drawn only for an item that needs the login", () => {
	assert.equal(mod.hubSignInLine(undefined), null);
	// UX U1: `credential: none` with items that updated anonymously is NOT a sign-in problem.
	assert.equal(mod.hubSignInLine(updates({ credential: "none" })), null);
	assert.equal(
		mod.hubSignInLine(
			updates({
				items: [item({ error_class: "no-credential", state: "failed" })],
			}),
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

test("an item that needs a decision is a review mark, never an apply (UX U3)", () => {
	for (const classification of ["both-changed", "baseline-unknown"])
		assert.deepEqual(mod.hubMarkFor(item({ classification })), {
			kind: "review",
		});
	// ...so Update-all does not count it either.
	assert.equal(
		mod.hubAvailableCount(
			updates({ items: [item({ classification: "both-changed" })] }),
			"agent",
		),
		0,
	);
	assert.match(
		mod.hubMarkDetail(item({ classification: "baseline-unknown" }), {
			kind: "review",
		}),
		/nothing records what you changed/,
	);
});

test("a failed mark whose class a retry cannot fix opens details instead", () => {
	for (const error_class of ["hub-item-missing", "prompt-too-long"])
		assert.deepEqual(mod.hubMarkFor(item({ state: "failed", error_class })), {
			kind: "failed",
			retryable: false,
		});
	assert.equal(
		mod.hubMarkAction({ kind: "failed", retryable: false }),
		"Click to see details.",
	);
	assert.equal(
		mod.hubMarkAction({ kind: "available", auto: true }),
		"Click to update.",
	);
	assert.equal(mod.hubMarkAction({ kind: "applied" }), null);
});

test("'Updated just now' decays with the apply time (UX U4)", () => {
	const now = Date.parse("2026-09-29T13:00:00Z");
	const applied = (last_applied_at) =>
		mod.hubMarkDetail(
			item({ state: "applied", last_applied_at }),
			{ kind: "applied" },
			now,
		);
	assert.equal(applied("2026-09-29T12:59:40Z"), "Updated just now.");
	assert.equal(applied("2026-09-29T12:48:00Z"), "Updated 12 min ago.");
	assert.equal(applied("2026-09-29T10:00:00Z"), "Updated 3 h ago.");
	assert.equal(applied("2026-09-27T10:00:00Z"), "Updated from the hub.");
	assert.equal(applied(undefined), "Updated from the hub.");
});

test("the roll-up counts every outcome and never says nothing over a failed run (R4)", () => {
	const r = (over) => ({
		kind: "agent",
		name: "x",
		applied: false,
		outcome: "merged",
		...over,
	});
	assert.equal(
		mod.hubRollup([
			r({ applied: true }),
			r({ applied: true }),
			r({ applied: true }),
			r({ name: "foxtrot", outcome: "needs-review" }),
		]),
		"3 updated, 1 needs your review (foxtrot)",
	);
	assert.equal(mod.hubRollup([]), "Nothing needed updating.");
	// B4.4's systemic stop: first fails, the rest are skipped - said, with the cause.
	assert.equal(
		mod.hubRollup([
			r({ outcome: "failed", error_class: "model-unavailable" }),
			r({ outcome: "skipped", skipped_reason: "model-unavailable" }),
			r({ outcome: "skipped", skipped_reason: "model-unavailable" }),
		]),
		"1 couldn't be updated, 2 skipped. No model available for merging. Check Settings › Agent Hub.",
	);
	// `model-unavailable` arrives as needs-review, but its mark is a retry, not a review.
	assert.equal(
		mod.hubRollup([
			r({ outcome: "needs-review", error_class: "model-unavailable" }),
		]),
		"1 couldn't be updated. No model available for merging. Check Settings › Agent Hub.",
	);
	assert.equal(
		mod
			.hubRollup([
				r({ outcome: "unavailable", error_class: "hub-item-missing" }),
			])
			.startsWith("1 couldn't"),
		true,
	);
	assert.equal(
		mod.hubRollup([r({ outcome: "would-merge" })]),
		"1 ready to update",
	);
	assert.equal(
		mod.hubRollup([r({ outcome: "unchanged" })]),
		"Everything was already up to date.",
	);
});

test("every non-success report has a sentence, and a plain success has none (U2)", () => {
	const note = (over, prefer) =>
		mod.hubReportNote(
			{ kind: "agent", name: "x", applied: false, outcome: "merged", ...over },
			prefer,
		);
	assert.equal(note({ applied: true }), null);
	assert.match(note({ outcome: "unchanged" }).message, /Already up to date/);
	assert.match(note({ outcome: "would-merge" }).message, /ready to update/);
	assert.match(
		note({ outcome: "needs-review", classification: "baseline-unknown" })
			.message,
		/Nothing records/,
	);
	assert.equal(
		note({ outcome: "failed", error_class: "hub-item-missing" }).tone,
		"error",
	);
	assert.match(
		note({ outcome: "skipped", skipped_reason: "provider-error/quota" })
			.message,
		/^Skipped\./,
	);
	assert.match(note({ applied: true }, "local").message, /yours was kept/);
	assert.match(note({ applied: true }, "remote").message, /the hub's was used/);
	// A subclass speaks with its parent's sentence; raw messages are never echoed.
	assert.equal(
		mod.hubClassSentence("provider-error/quota"),
		"Couldn't reach the model that merges this. It retries on its own; press Retry to try now.",
	);
	assert.doesNotMatch(
		note({
			outcome: "failed",
			error_class: "hub-error",
			message: "Traceback (most",
		}).message,
		/Traceback/,
	);
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

test("the unknown-baseline acknowledgement and the preview reach the wire (R3/R5)", () => {
	const body = mod.desktopEndpoint({
		op: "hub.apply",
		requestId: REQUEST,
		kind: "agent",
		name: "coder",
		prefer: "remote",
		acknowledgeUnknownBaseline: true,
		dryRun: true,
	}).body;
	assert.equal(body.acknowledge_unknown_baseline, true);
	assert.equal(body.dry_run, true);
	assert.equal(body.prefer, "remote");
});

test("the hub's writes wait longer than the backend's 120 s merge (R2/U9)", () => {
	const ms = (op) => mod.desktopRequestDeadlineMs(op);
	/*
	 * THE NUMBERS, NOT AN INEQUALITY (agent review round 2, R2-4). `> 120_000`
	 * passes a drift to 121 s and says nothing about apply-all vs a real item, so
	 * the load-bearing values are asserted exactly: one item is the backend's
	 * 120 s merge + 30 s + the move envelope's 15 s margin, and update-all is the
	 * five worst-case merges its own comment promises.
	 */
	assert.equal(ms("hub.apply"), 165_000);
	assert.equal(ms("hub.retry"), 165_000);
	assert.equal(ms("hub.applyAll"), 825_000);
	assert.equal(ms("hub.check"), 60_000);
	// The store read keeps the control budget: it never touches the hub.
	assert.equal(ms("hub.updates"), 20_000);
	// The give-up is a human sentence that says nothing about seconds or "the server".
	for (const op of ["hub.apply", "hub.applyAll", "hub.check", "hub.retry"]) {
		const { message } = mod.desktopRequestDeadlineDetail(op, ms(op));
		assert.match(message, /taking longer than expected/);
		assert.doesNotMatch(message, /seconds|server/);
	}
});

// The hook's configuration and the empty renders are load-bearing claims ("an
// older backend is never polled", "zero cost without a hub item") that a helper
// test cannot see, so they are pinned at the source, the way
// agent-hub-org-sharing.test.mjs pins its wiring.
const read = (file) =>
	readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the poll is 60 s, foreground-only, and gated on its own capability (R9)", () => {
	const hooks = read("src/renderer/src/shared/api/local-operator/hub-hooks.ts");
	assert.match(hooks, /refetchInterval: 60_000/);
	assert.match(hooks, /refetchIntervalInBackground: false/);
	assert.match(hooks, /staleTime: 30_000/);
	assert.match(hooks, /enabled,\n/);
	for (const file of [
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"src/renderer/src/features/agents/components/agents-page.tsx",
	])
		assert.match(read(file), /"hub_updates"/, file);
	assert.match(
		read("src/renderer/src/shared/api/local-operator/desktop-hooks.ts"),
		/\| "hub_updates"/,
	);
});

test("without a hub item nothing renders, and the sidebar has ONE action store (R6/R9)", () => {
	const mark = read(
		"src/renderer/src/features/chat/components/hub-update-mark.tsx",
	);
	assert.match(mark, /if \(!offerAll && !onCheck\) return null;/);
	/*
	 * THE CAPTION LINE IS HELD WHEN THE CALLER ASKS (design round 2, D13). The
	 * sign-in sentence arrives on a POLL, so an unreserved caption block let a
	 * poll push every row below the heading down one line; `reserve` draws the
	 * caption's own empty line while it has nothing to say. Both halves are
	 * asserted, because either one alone is the bug back again.
	 */
	assert.match(
		mark,
		/if \(!reserve && !signIn && !rollup && !note\) return null;/,
	);
	assert.match(mark, /\{reserve && !signIn && !rollup && !note && \(/);
	assert.match(
		read("src/renderer/src/features/chat/components/chat-sidebar.tsx"),
		/reserve=\{[\s\S]{0,120}?kind === "agent" &&/,
	);
	const panel = read(
		"src/renderer/src/features/agents/components/hub-update-panel.tsx",
	);
	assert.match(panel, /if \(!note\) return null;/);
	// Shared state lives in the store, never in per-hook `useState`.
	const hooks = read("src/renderer/src/shared/api/local-operator/hub-hooks.ts");
	assert.doesNotMatch(hooks, /useState\(/);
	assert.match(hooks, /useHubActionStore/);
});

test("the detail panes re-seed when the fetched definition changes (R1)", () => {
	const page = read(
		"src/renderer/src/features/agents/components/agents-page.tsx",
	);
	/*
	 * The panes are keyed by the record AND its fetched content. Only the two
	 * detail panes use a template key (the create panes are keyed by the literal
	 * `agent:create` / `team:create`), so this is exactly the pair.
	 */
	const keys = page.match(/key=\{`(agent|team):[^`]*`\}/g) ?? [];
	assert.equal(
		keys.length,
		2,
		"the two detail panes must be the template-keyed ones",
	);
	for (const key of keys)
		assert.match(
			key,
			/contentKey\(/,
			`a detail pane is not keyed by its content: ${key}`,
		);
});

/*
 * THE REPLACED-EDIT NOTICE, PINNED WHERE CI CAN REACH IT (agent review round 3,
 * N2). Its behaviour is asserted by the `update-under-an-open-editor` story, and
 * nothing runs Storybook stories in CI - `pnpm test:desktop` is the `node --test`
 * set, and the stories are a hand-run rig. So the same cheap source pins the R1
 * fix uses stand here: both editors must keep reporting their unsaved state up,
 * the notice must stay conditional on a DIRTY editor, and it must stay scoped to
 * the definition it describes (N1).
 */
test("the replaced-edit notice keeps its wiring, its condition and its scope (R2-5, N1/N2)", () => {
	const page = read(
		"src/renderer/src/features/agents/components/agents-page.tsx",
	);
	/*
	 * The dirty flag the notice reads must be fed by every pane (the panes report
	 * through `reportDirty`, which the page scopes by pane identity), and the
	 * notice itself must stay conditional on it - a merged definition under a CLEAN
	 * pane is silence, not a notice.
	 */
	assert.equal(
		(page.match(/onDirtyChange=\{reportDirty\}/g) ?? []).length,
		4,
		"every detail pane must report its unsaved state",
	);
	assert.match(page, /if \(editDirty\) setLostEdits\(true\);/);
	// ...and a change of IDENTITY adopts the new record and clears the notice
	// instead of comparing two definitions against each other (N1).
	assert.match(page, /if \(seededPane\.current\.identity !== openIdentity\)/);
	assert.match(
		page,
		/if \(seededPane\.current\.identity !== openIdentity\) \{[\s\S]{0,400}?setLostEdits\(false\);/,
	);
});
