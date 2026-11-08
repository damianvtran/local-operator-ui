/**
 * The sidebar's background-work fact: one predicate, one sentence, executable.
 *
 *     node --test scripts/chat-session-subagents.test.mjs
 *
 * THE OPERATOR'S REPORT (2026-11-07) is what this file pins: a session whose
 * turn had ended while a subagent and a background job were still at work
 * looked idle in the desktop sidebar - filed under Today, idle glyph - because
 * Running keyed on `status.code` alone and a build drain had suppressed
 * `delegating` in core. Core now publishes `background_work` on every row and
 * status frame; `hasBackgroundWork` is its one reader (the Running section, the
 * lane under the status cell, the tooltip clause), and `backgroundWorkClause`
 * is the sentence.
 *
 * WHY A MODULE AND NOT A JSX CONDITION: this repository's desktop suite is
 * `node:test` over `scripts/*.test.mjs` with no DOM harness, so a decision
 * written in the sidebar's JSX is one no test here can reach. The pixels (the
 * lane's geometry and ink) are the story frames' and the real-app frames' job.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-session-subagents";',
			'export { isRunningRow, sectionOf } from "./src/renderer/src/features/chat/chat-list-sections";',
			'export { statusFrameCounts } from "./src/renderer/src/shared/hooks/use-desktop-feed";',
			'export { setLocale } from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: ROOT,
		loader: "ts",
	},
	alias: {
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared": `${ROOT}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
});
const {
	hasBackgroundWork,
	backgroundWorkClause,
	isRunningRow,
	statusFrameCounts,
	clauseReplacesLabel,
	setLocale,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A row in the wire's own field names. */
const row = (code, fields = {}, label = code) => ({
	session_id: "fixture",
	status: { code, label },
	...fields,
});

test("Running = a running code OR background_work, whatever the code", () => {
	// The reported case: the turn ended (`idle`, a drain suppressed delegating)
	// but a subagent and a job are still at work.
	const reported = row("idle", {
		background_work: true,
		subagents_running: 1,
		jobs_running: 1,
	});
	assert.equal(hasBackgroundWork(reported), true);
	assert.equal(isRunningRow(reported), true);
	// Every resting or finished code joins Running while work runs.
	for (const code of [
		"complete",
		"recent",
		"attached",
		"interrupted",
		"error",
	]) {
		assert.equal(
			isRunningRow(row(code, { background_work: true, jobs_running: 1 })),
			true,
			code,
		);
		assert.equal(isRunningRow(row(code, { background_work: false })), false);
	}
	// A live code stays Running with no background work at all.
	assert.equal(isRunningRow(row("busy", { background_work: false })), true);
});

test("the flag is read, not re-summed from the counts", () => {
	// Core owns what counts as work; a positive count with the flag false is
	// core's answer (e.g. a wait it does not count), and is not overridden.
	assert.equal(
		hasBackgroundWork(row("idle", { background_work: false, waiting_on: 1 })),
		false,
	);
	// `null` counts ("unknown") never invent work.
	assert.equal(
		hasBackgroundWork(
			row("idle", {
				background_work: false,
				jobs_running: null,
				subagents_running: null,
			}),
		),
		false,
	);
});

test("older backend (no flag): the code-only behaviour is kept", () => {
	// `delegating` was the one code that implied children; it keeps the lane.
	assert.equal(
		hasBackgroundWork(row("delegating", { subagents_running: 2 })),
		true,
	);
	// Counts alone on an older backend do not move a row's section.
	const old = row("complete", { subagents_running: 2, jobs_running: 1 });
	assert.equal(hasBackgroundWork(old), false);
	assert.equal(isRunningRow(old), false);
});

test("remote rows: same rule; link down or uncertain reach stands down", () => {
	const remote = {
		locality: "remote",
		background_work: true,
		subagents_running: 1,
	};
	assert.equal(isRunningRow(row("idle", remote)), true);
	for (const stale of [
		{ link_down: true },
		{ link_down: true, link_reconnecting: true },
		{ peer_reach: "unknown" },
		{ peer_reach: "not-attempted" },
	]) {
		const r = row("idle", { ...remote, ...stale });
		assert.equal(hasBackgroundWork(r), false, JSON.stringify(stale));
		assert.equal(isRunningRow(r), false, JSON.stringify(stale));
		assert.equal(backgroundWorkClause(r), "", JSON.stringify(stale));
	}
});

test("the clause: '1 subagent, 1 job running' and the wire's ' · ' spelling", () => {
	// A current backend: the flag is set whenever these counts are positive.
	const c = (code, fields) =>
		backgroundWorkClause(row(code, { background_work: true, ...fields }));
	assert.equal(
		c("idle", { subagents_running: 1, jobs_running: 1 }),
		"1 subagent, 1 job running",
	);
	assert.equal(
		c("busy", { subagents_running: 2, subagents_queued: 1 }),
		"2 subagents running · 1 queued",
	);
	assert.equal(c("idle", { subagents_queued: 2 }), "2 subagents queued");
	assert.equal(c("idle", { subagents_queued: 1 }), "1 subagent queued");
	assert.equal(c("complete", { jobs_running: 3 }), "3 jobs running");
	assert.equal(
		c("idle", { subagents_running: 2, jobs_running: 2, subagents_queued: 3 }),
		"2 subagents, 2 jobs running · 3 queued",
	);
	// The wait is spoken only when it is the sole fact.
	assert.equal(c("idle", { waiting_on: 1 }), "Waiting on background work");
	assert.equal(c("idle", { waiting_on: 1, jobs_running: 1 }), "1 job running");
	// A `waiting` row's label already says the wait (QA round 1, Q2).
	assert.equal(c("waiting", { waiting_on: 1 }), "");
	// Nothing positive, nothing said; unknown is not zero but is not a fact.
	assert.equal(c("idle", {}), "");
	assert.equal(c("idle", { subagents_running: null, jobs_running: 0 }), "");
});

test("the clause reads the section's predicate (review R1/R3, QA Q1)", () => {
	// Flag false: core says nothing runs, so nothing is said, whatever the counts.
	const quiet = row("complete", {
		background_work: false,
		subagents_running: 2,
		jobs_running: 1,
		waiting_on: 1,
	});
	assert.equal(isRunningRow(quiet), false);
	assert.equal(backgroundWorkClause(quiet), "");
	// Older backend (no flag), a row the section and lane do not mark: only
	// main's own subagent sentence survives; the jobs and wait parts this change
	// added stay silent, so the row never claims a job the lane does not show.
	const old = row("complete", { subagents_running: 2, jobs_running: 1 });
	assert.equal(isRunningRow(old), false);
	assert.equal(backgroundWorkClause(old), "2 subagents running");
	assert.equal(backgroundWorkClause(row("idle", { jobs_running: 1 })), "");
	assert.equal(backgroundWorkClause(row("idle", { waiting_on: 1 })), "");
	assert.equal(
		backgroundWorkClause(row("attached", { subagents_queued: 2 })),
		"2 subagents queued",
	);
	// Older backend, delegating (the code-only rule marks it): the job speaks.
	assert.equal(
		backgroundWorkClause(
			row("delegating", { subagents_running: 1, jobs_running: 1 }),
		),
		"1 job running",
	);
});

test("a resting label yields to the clause; a louder one keeps it (design D1)", () => {
	const clause = "1 subagent, 1 job running";
	for (const code of ["idle", "recent", undefined]) {
		const r = code === undefined ? { session_id: "x" } : row(code);
		assert.equal(clauseReplacesLabel(r, clause), true, String(code));
		assert.equal(clauseReplacesLabel(r, ""), false, String(code));
	}
	for (const code of ["complete", "approval", "attached", "error", "waiting"]) {
		assert.equal(clauseReplacesLabel(row(code), clause), false, code);
	}
});

test("list joins use the locale's conjunction, not unit spacing (i18n I1)", () => {
	const fields = {
		background_work: true,
		subagents_running: 1,
		jobs_running: 1,
	};
	try {
		setLocale("ru");
		const ru = backgroundWorkClause(row("idle", fields));
		// CLDR unit/short joined these with a bare space: "1 субагент 1 задание".
		assert.match(ru, /1 субагент, 1 задание/u, ru);
		setLocale("zh-CN");
		const zh = backgroundWorkClause(row("idle", fields));
		// ... and with nothing at all in zh-CN: "1个子智能体1个任务".
		assert.match(zh, /1个子智能体、1个任务/u, zh);
	} finally {
		setLocale("en");
	}
	assert.equal(
		backgroundWorkClause(row("idle", fields)),
		"1 subagent, 1 job running",
	);
});

test("delegating: the label already spells the subagent counts", () => {
	const c = (fields) =>
		backgroundWorkClause(
			row("delegating", fields, "2 subagents running · 1 queued"),
		);
	assert.equal(c({ subagents_running: 2, subagents_queued: 1 }), "");
	// A job is not in core's delegating label, so it still speaks.
	assert.equal(c({ subagents_running: 2, jobs_running: 1 }), "1 job running");
});

test("a status frame's counts are projected only when the backend sends the flag", () => {
	assert.equal(
		statusFrameCounts({ code: "idle", label: "Idle", revision: 3 }),
		undefined,
	);
	assert.deepEqual(
		statusFrameCounts({
			code: "idle",
			label: "Idle",
			revision: 4,
			subagents_running: 0,
			subagents_queued: 0,
			jobs_running: null,
			waiting_on: 0,
			background_work: false,
		}),
		{
			background_work: false,
			subagents_running: 0,
			subagents_queued: 0,
			jobs_running: null,
			waiting_on: 0,
		},
	);
});
