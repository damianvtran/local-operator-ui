import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Schedules page's view model, asserted against the rules it implements.
 *
 * `scheduled-task-model.ts` is pure TypeScript with no React and no DOM, so it
 * bundles the same way `run-detail-model.ts` does and runs under `node --test`.
 *
 * Three things are checked, and the first is why the file exists:
 *
 * 1. The rules that have a RIGHT ANSWER are asserted rather than eyeballed in a
 *    story: the sort (soonest first, undateable last, ties by name), which rows
 *    are dropped, what a parked row says INSTEAD of an instant, and how a legacy
 *    row's cadence is spelled in the wake surface's vocabulary.
 * 2. The failure paths. The listing is a wire payload, so a row with no name, a
 *    schedule with no readable instant, and an entry with no schedules at all
 *    are all normal - each has to degrade to an omitted segment rather than to a
 *    zero, a crash, or a row that claims something the payload did not say.
 * 3. The wake-primitive vocabulary the page SHARES with the run pane. The page
 *    renders the pane's `deriveWakes` output, so these assertions are also the
 *    guard that the two surfaces cannot come to spell one object two ways.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/schedules/scheduled-task-model";',
			'export * from "./src/renderer/src/shared/api/local-operator/wakes-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	MAX_WAKE_SCHEDULES,
	PARKED_CLAUSE,
	WAKE_LINE_CAP,
	legacyScheduleCadence,
	repeatEveryString,
	scheduledTaskRows,
	toScheduledTaskRow,
	wakeCountClause,
	wakeCreateBody,
	wakePromptHead,
	wakeRowName,
} = model;

/** One pinned instant, so every label below is reproducible. */
const NOW = new Date(2026, 2, 15, 14, 0, 0, 0).getTime();
const minutes = (value) => NOW + value * 60_000;

const schedule = (id, dueMinutes, extra = {}) => ({
	id,
	message: `wake ${id}`,
	next_due_at: minutes(dueMinutes),
	every_ms: null,
	until_at: null,
	limit: null,
	fired_count: 0,
	overdue_s: 0,
	stale: false,
	last_fired_at: null,
	last_attempt_at: null,
	...extra,
});

const entry = (sessionId, name, schedules, extra = {}) => ({
	session_id: sessionId,
	name,
	cwd: "/Users/someone/invoices",
	origin: "",
	updated_at: minutes(-30),
	dormant: false,
	ghost: false,
	next_due_at: null,
	schedules,
	...extra,
});

test("rows are conversations, ordered by the soonest wake, undateable last", () => {
	const rows = scheduledTaskRows(
		[
			entry("bbbbbbbbbbbb", "Beta", [schedule("w1", 120)]),
			entry("aaaaaaaaaaaa", "Alpha", [schedule("w1", 30), schedule("w2", 5)]),
			entry("cccccccccccc", "Gamma", [
				schedule("w1", 600, { next_due_at: null }),
			]),
		],
		NOW,
	);
	assert.deepEqual(
		rows.map((row) => row.name),
		["Alpha", "Beta", "Gamma"],
	);
	/* The row's own instant is the soonest of its wakes, so the head's clause and
	   the first line's label cannot disagree. */
	assert.equal(rows[0].nextDueAt, minutes(5));
	assert.equal(rows[0].meta, `2 wakes · next ${rows[0].wakes[0].dueLabel}`);
});

test("an entry whose last wake retired is not a row", () => {
	assert.deepEqual(
		scheduledTaskRows([entry("aaaaaaaaaaaa", "Alpha", [])], NOW),
		[],
	);
});

test("a stopped conversation states the fact instead of an instant", () => {
	const row = toScheduledTaskRow(
		entry(
			"aaaaaaaaaaaa",
			"Alpha",
			[schedule("w1", 30, { every_ms: 3_600_000, fired_count: 2 })],
			{ dormant: true },
		),
		NOW,
	);
	assert.equal(row.parked, true);
	assert.equal(row.meta, PARKED_CLAUSE);
	assert.ok(!row.meta.includes("next"));
	/* And the wake LINES drop their instants too: the stored instant is neither
	   when it fires nor when it will fire after a re-open, so the line keeps its
	   prompt and its cadence and loses the time. */
	assert.deepEqual(
		row.wakes.map((wake) => wake.dueLabel),
		[""],
	);
	assert.match(row.wakes[0].cadence, /^every /);
	/* A ghost (no transcript) is the same state to a reader. */
	assert.equal(
		toScheduledTaskRow(
			entry("aaaaaaaaaaaa", "Alpha", [schedule("w1", 30)], { ghost: true }),
			NOW,
		).parked,
		true,
	);
});

test("a fired recurrence says so, and a fresh one says nothing", () => {
	const row = toScheduledTaskRow(
		entry("aaaaaaaaaaaa", "Alpha", [
			schedule("w1", 30, { every_ms: 3_600_000, fired_count: 3 }),
			schedule("w2", 90),
		]),
		NOW,
	);
	const [first, second] = row.wakes;
	assert.equal(first.ranLabel, "Ran 3 times");
	assert.match(first.cadence, /^every /);
	assert.equal(second.ranLabel, "");
	assert.equal(second.cadence, "once");
});

test("a nameless session is still addressable and still says where it runs", () => {
	assert.equal(wakeRowName("Invoices", "a1b2c3d4e5f6", "/x/y"), "Invoices");
	assert.equal(
		wakeRowName("  ", "a1b2c3d4e5f6", "/Users/someone/invoices"),
		"a1b2c3d4 · invoices",
	);
	assert.equal(wakeRowName("", "a1b2c3d4e5f6", ""), "a1b2c3d4");
});

test("the count clause and the line cap are the page's own numbers", () => {
	assert.equal(wakeCountClause(1), "1 wake");
	assert.equal(wakeCountClause(2), "2 wakes");
	const row = toScheduledTaskRow(
		entry(
			"aaaaaaaaaaaa",
			"Alpha",
			[1, 2, 3, 4, 5, 6].map((index) => schedule(`w${index}`, index * 10)),
		),
		NOW,
	);
	assert.equal(row.visibleWakes.length, WAKE_LINE_CAP);
	assert.equal(row.hiddenWakes, 6 - WAKE_LINE_CAP);
	assert.equal(row.wakes.length, 6);
});

test("a legacy row's cadence is spelled in the wake vocabulary, bounds included", () => {
	const base = {
		id: "id",
		agent_id: "agent",
		prompt: "prompt",
		is_active: true,
		one_time: false,
		created_at: new Date(2026, 2, 12).toISOString(),
	};
	assert.equal(
		legacyScheduleCadence({ ...base, interval: 1, unit: "hours" }, NOW),
		"every 1h",
	);
	assert.equal(
		legacyScheduleCadence({ ...base, interval: 15, unit: "minutes" }, NOW),
		"every 15m",
	);
	/* An end bound is a fact the legacy row has and a wake does not, so it rides
	   as its own clause rather than being folded into the recurrence sentence. */
	assert.match(
		legacyScheduleCadence(
			{
				...base,
				interval: 1,
				unit: "days",
				end_time_utc: new Date(2026, 3, 1).toISOString(),
			},
			NOW,
		),
		/^every 1d · until /,
	);
	assert.equal(
		legacyScheduleCadence(
			{ ...base, one_time: true, interval: 1, unit: "days" },
			NOW,
		),
		"once",
	);
	assert.match(
		legacyScheduleCadence(
			{
				...base,
				one_time: true,
				interval: 1,
				unit: "days",
				start_time_utc: new Date(2026, 3, 1, 9, 0).toISOString(),
			},
			NOW,
		),
		/^once · /,
	);
});

test("the dialog's two grammars: repeat durations, and a prompt head", () => {
	assert.equal(repeatEveryString(1, "hours"), "1h");
	assert.equal(repeatEveryString(30, "minutes"), "30m");
	assert.equal(repeatEveryString(2, "days"), "2d");
	assert.equal(repeatEveryString(1, "weeks"), "1w");
	assert.equal(MAX_WAKE_SCHEDULES, 16);

	assert.equal(wakePromptHead("Read my unread email"), "Read my unread email");
	assert.equal(
		wakePromptHead(
			"Read my unread email, group it by whether it needs a reply today, and summarise",
		),
		"Read my unread email, group it by whether it…",
	);
	/* The clipped form drops the punctuation it was cut on: a label, not a
	   sentence that ran into an ellipsis. */
	assert.equal(
		wakePromptHead("Clean up the invoices sheet."),
		"Clean up the invoices sheet",
	);
});

test("the create body refuses a request that names nowhere to run", () => {
	const body = wakeCreateBody({
		requestId: "11111111-2222-4333-8444-555555555555",
		sessionId: "a1b2c3d4e5f6",
		message: "Do the thing.",
		firstRun: { in: "1h" },
	});
	assert.deepEqual(body, {
		requestId: "11111111-2222-4333-8444-555555555555",
		sessionId: "a1b2c3d4e5f6",
		message: "Do the thing.",
		in: "1h",
	});
	/* The two destination shapes are exclusive by construction, and the guard
	   exists for the one caller that can still get it wrong at runtime. */
	assert.throws(
		() =>
			wakeCreateBody({
				requestId: "11111111-2222-4333-8444-555555555555",
				cwd: "",
				message: "Do the thing.",
				firstRun: { in: "1h" },
			}),
		/A scheduled task needs somewhere to run/,
	);
	const newConversation = wakeCreateBody({
		requestId: "11111111-2222-4333-8444-555555555555",
		cwd: "~/invoices",
		message: "Do the thing.",
		firstRun: { at: "2026-03-15T18:00:00.000Z" },
		every: "1d",
		limit: 3,
	});
	assert.equal(newConversation.cwd, "~/invoices");
	assert.equal(newConversation.at, "2026-03-15T18:00:00.000Z");
	assert.equal(newConversation.every, "1d");
	assert.equal(newConversation.limit, 3);
	/* An unset bound is ABSENT, never `null`: an edit that sent `every: null`
	   would be a request to clear a recurrence the user did not touch. */
	assert.ok(
		!(
			"every" in
			wakeCreateBody({
				requestId: "11111111-2222-4333-8444-555555555555",
				cwd: "~/invoices",
				message: "Do the thing.",
				firstRun: { in: "1h" },
			})
		),
	);
});
