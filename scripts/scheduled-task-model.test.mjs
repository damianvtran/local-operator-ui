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
	PARK_FOOTER_CLAUSE,
	PARKED_CLAUSE,
	STALE_ROWS_CLAUSE,
	isEmptyListing,
	workspaceName,
	WAKE_LINE_CAP,
	hiddenWakesLabel,
	keepEndsLabel,
	keepFirstRunLabel,
	keepRepeatLabel,
	legacyScheduleCadence,
	repeatEveryString,
	scheduledTaskRows,
	supervisorLead,
	toScheduledTaskRow,
	validateScheduledTask,
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
	/* The clause itself, and no INSTANT anywhere: `next 2:14 PM EDT` is what the
	   parked row must not print, and the clause now says `after its next turn`,
	   so the crude word test is replaced by the shape it was reaching for. */
	assert.equal(row.meta, PARKED_CLAUSE);
	assert.equal(/next \d/.test(row.meta), false);
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
		/^once · at /,
	);
	/* A recurring row's anchor is a NAMED clause (`starts`), not a bare `from`:
	   the wake lines above it lead with a clock, so an unnamed preposition there
	   read as a change of kind mid-list (the designer's D5). */
	assert.match(
		legacyScheduleCadence(
			{
				...base,
				interval: 1,
				unit: "hours",
				start_time_utc: new Date(2026, 3, 1, 9, 0).toISOString(),
			},
			NOW,
		),
		/^every 1h · starts /,
	);
});

test("one wake, one line: the disclosure and the count pluralise the same way", () => {
	/* `Show 1 more wakes` shipped on the populated list (the designer's D4, the
	   reviewer's R5): the label is also the control's ACCESSIBLE NAME, so the
	   singular is a correctness case rather than a nicety. */
	assert.equal(hiddenWakesLabel(1), "Show 1 more wake");
	assert.equal(hiddenWakesLabel(3), "Show 3 more wakes");
	assert.equal(wakeCountClause(1), "1 wake");
});

test("ties in the due instant are broken by name, and by nothing else", () => {
	/* Same instant, so the tie-break is the only thing that can order them, and
	   the wire's own order is deliberately the reverse of the answer. */
	const rows = scheduledTaskRows(
		[
			entry("bbbbbbbbbbbb", "Zeta", [schedule("w1", 30)]),
			entry("aaaaaaaaaaaa", "Alpha", [schedule("w1", 30)]),
		],
		NOW,
	);
	assert.deepEqual(
		rows.map((row) => row.name),
		["Alpha", "Zeta"],
	);
});

test("when nothing can fire, no row prints an instant", () => {
	const listing = [entry("aaaaaaaaaaaa", "Alpha", [schedule("w1", 30)])];
	const rows = scheduledTaskRows(listing, NOW, { dueInstants: false });
	const [row] = rows;
	/* The parked rule applied one state over (the designer's D2): the strip carries
	   the reason, and the row keeps the count and the work it describes. */
	assert.equal(row.dueInstants, false);
	assert.equal(row.parked, false);
	assert.equal(row.meta, "1 wake");
	assert.equal(row.wakes[0].dueLabel, "");
	assert.equal(row.wakes[0].cadence.length > 0, true);
	/* And the default is the trusted reading, or every other test here would be
	   asserting this branch. */
	const trusted = scheduledTaskRows(listing, NOW);
	assert.equal(trusted[0].dueInstants, true);
	assert.match(trusted[0].meta, /· next /);
});

test("the supervisor sentence is one truth, picked by three states", () => {
	assert.match(
		supervisorLead({ supported: true, running: false, detail: "" }),
		/^The wake supervisor is installed but not running/,
	);
	assert.match(
		supervisorLead({ supported: false, running: false, detail: "" }),
		/^Wakes are not supervised on this platform yet/,
	);
	/* `supported: false` also reports `verifiable: false`, so the order of the two
	   clauses is load-bearing: a Linux user must not read a launchd sentence. */
	assert.match(
		supervisorLead({
			supported: false,
			running: false,
			detail: "",
			verifiable: false,
		}),
		/^Wakes are not supervised on this platform yet/,
	);
	assert.match(
		supervisorLead({
			supported: true,
			running: false,
			detail: "",
			verifiable: false,
		}),
		/^Nothing supervises the wakes below/,
	);
	/*
	 * Each lead scopes itself to the wake rows, and the deixis is `below`: the
	 * strip renders ABOVE those rows, with the header above it and nothing else
	 * (measured natively on `supervisor-down`: strip y147..161, first row name
	 * y236..245). `above` was the round-2 wording and it pointed at nothing -
	 * round 2 raised the scope, round 3 corrected the direction.
	 */
	for (const lead of [
		supervisorLead({ supported: true, running: false, detail: "" }),
		supervisorLead({ supported: false, running: false, detail: "" }),
		supervisorLead({
			supported: true,
			running: false,
			detail: "",
			verifiable: false,
		}),
	]) {
		assert.match(lead, /wakes below/);
		assert.equal(/scheduled tasks/.test(lead), false);
	}
});

test("the editor's keep options state the value they keep", () => {
	const wakeRow = {
		id: "w1",
		message: "m",
		next_due_at: minutes(120),
		every_ms: 86_400_000,
		until_at: null,
		limit: null,
		fired_count: 3,
		overdue_s: 0,
		stale: false,
		last_fired_at: null,
		last_attempt_at: null,
	};
	assert.match(keepFirstRunLabel(wakeRow, NOW, false), /^Keep \d/);
	assert.equal(keepFirstRunLabel(wakeRow, NOW, true), "Keep it parked");
	assert.equal(keepRepeatLabel(wakeRow), "Keep every 1d");
	assert.equal(keepRepeatLabel({ ...wakeRow, every_ms: null }), "Keep as once");
	assert.equal(keepEndsLabel(wakeRow, NOW), "Keep never ending");
	assert.match(
		keepEndsLabel({ ...wakeRow, limit: 5 }, NOW),
		/^Keep 2 runs left$/,
	);
	assert.equal(
		keepEndsLabel({ ...wakeRow, limit: 4, fired_count: 3 }, NOW),
		"Keep 1 run left",
	);
	assert.match(
		keepEndsLabel({ ...wakeRow, until_at: minutes(60 * 24) }, NOW),
		/^Keep ending /,
	);
});

test("a listing that could not be READ is never the empty state", () => {
	/* The one predicate behind the empty state, and the round-2 MAJOR (D13/U8):
	   `read_error` is a 200, so a store whose index could not be listed satisfied
	   `!error` and the page told a user with thirty schedules that they had none,
	   directly under a strip saying the list may be incomplete. */
	const settled = {
		loading: false,
		error: false,
		readError: false,
		wakeRows: 0,
		legacyLoading: false,
		legacyRows: 0,
	};
	assert.equal(isEmptyListing(settled), true);
	assert.equal(isEmptyListing({ ...settled, readError: true }), false);
	/* And the other four terms keep their own cases. */
	assert.equal(isEmptyListing({ ...settled, loading: true }), false);
	assert.equal(isEmptyListing({ ...settled, error: true }), false);
	assert.equal(isEmptyListing({ ...settled, wakeRows: 1 }), false);
	assert.equal(isEmptyListing({ ...settled, legacyLoading: true }), false);
	assert.equal(isEmptyListing({ ...settled, legacyRows: 1 }), false);
});

test("the workspace clause names a directory, never a shell token", () => {
	/* Round-2 U1: the store's staged cwd is literally `~` until a workspace is
	   chosen, and the sentence printed it. */
	assert.equal(workspaceName("~"), "your home folder");
	assert.equal(workspaceName("~/"), "your home folder");
	assert.equal(workspaceName(""), "your home folder");
	assert.equal(workspaceName("~/invoices"), "invoices");
	assert.equal(workspaceName("/Users/someone/work/reports"), "reports");
	assert.equal(workspaceName("~other"), "your home folder");
});

test("the parking copy names the stop that parks and what resumes them", () => {
	/* Both halves were measured false in the running app (round-2 U9): a desktop
	   stop writes no durable marker, so it does not park, and opening a parked
	   conversation does not resume its wakes - a turn does. */
	for (const text of [PARKED_CLAUSE, PARK_FOOTER_CLAUSE]) {
		assert.equal(/when you open it/.test(text), false);
	}
	assert.match(PARKED_CLAUSE, /next turn/);
	assert.match(PARK_FOOTER_CLAUSE, /terminal stop parks/);
	assert.match(PARK_FOOTER_CLAUSE, /from this window leaves them armed/);
	/* The rows under a failed read are marked for what they are (U4). */
	assert.match(STALE_ROWS_CLAUSE, /last one that loaded/);
});

test("the dialog's refusals are inline, named, and independent", () => {
	const quiet = {
		message: "read my email",
		needsConversation: false,
		repeatMs: null,
		endsRuns: null,
		existingWakeCount: 0,
		alreadyRun: 0,
	};
	assert.equal(validateScheduledTask(quiet).invalid, false);
	/* The ceiling, spelled the way it has always been. */
	assert.equal(
		validateScheduledTask({ ...quiet, existingWakeCount: 16 }).conversation,
		"This conversation already has 16 wakes, the most it can hold. Cancel one to add another.",
	);
	assert.equal(
		validateScheduledTask({ ...quiet, needsConversation: true }).conversation,
		"Pick a conversation.",
	);
	/* The repeat floor. */
	assert.equal(
		validateScheduledTask({ ...quiet, repeatMs: 30_000 }).repeat,
		"Wakes repeat no more often than once a minute.",
	);
	assert.equal(
		validateScheduledTask({ ...quiet, repeatMs: 60_000 }).repeat,
		"",
	);
	/* The wire's own prompt ceiling, stated where the value is: past it the main
	   process refuses the whole request with "Invalid desktop operation." (R3). */
	const long = validateScheduledTask({ ...quiet, message: "x".repeat(2_500) });
	assert.equal(long.invalid, true);
	assert.match(long.prompt, /^This prompt is 2,500 characters/);
	assert.match(long.prompt, /at most 2,000/);
	assert.equal(
		validateScheduledTask({ ...quiet, message: "x".repeat(2_000) }).prompt,
		"",
	);
	assert.equal(
		validateScheduledTask({ ...quiet, message: "   " }).invalid,
		true,
	);
	/* A run budget the wake has already met (the designer's D3 point 4). */
	assert.equal(
		validateScheduledTask({ ...quiet, endsRuns: 1, alreadyRun: 3 }).ends,
		"This wake has already run 3 times, so the run budget has to be at least 4.",
	);
	assert.equal(
		validateScheduledTask({ ...quiet, endsRuns: 4, alreadyRun: 3 }).ends,
		"",
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
