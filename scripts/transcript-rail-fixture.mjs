#!/usr/bin/env node
/**
 * THE `transcript-rail` SCENE'S FIXTURE: a synthetic transcript journal.
 *
 * The checkpoint rail's evidence has to run against a REAL manifest — the
 * derivation is the backend's, so a stubbed one would photograph the scene's
 * own arithmetic. This script writes the conversation the daemon derives that
 * manifest from, into the config root the run owns, BEFORE its daemon starts:
 * `sessions/<id>/transcript.jsonl`, in the journal's own row format (the
 * shapes `local-operator`'s `tests/unit/session/test_transcript_index.py`
 * pins against the S3 spike's measurements of the real store).
 *
 * FOUR conversations carry the scene's cases, each id-prefixed so a page can
 * tell their rails apart:
 *   - `be1a9fef0001` (default 200 turns => 402 checkpoints): the rail's density
 *     case (v1 allows overlap at this size, and the frame is what "must not
 *     look broken" means); turn 120 is STEERED — a mid-run user row after a
 *     tool row, which folds into that turn's open run, so the collapse hides it
 *     inside the bar (the jump-into-a-collapsed-run case); turns 124 and 128
 *     carry non-complete outcomes (error, interrupted);
 *   - `be1a9fef0002` (320 turns, ~2,240 rows): the refusal case — its OLDEST
 *     tick is beyond the near path's budget from a fresh read;
 *   - `be1a9fef0003` (6 turns => 12 discrete ticks): the SPARSE rail frame, with
 *     turn 2's user row deliberately long (the bounded card) and turn 3 an
 *     error outcome (the outcome-row card);
 *   - `be1a9fef0004` (~200k rows): the BUILDING state's host — big enough that
 *     a cold/stale read answers `building` while the index refresh runs (the
 *     scene appends a row before each capture, so the leg stays deterministic
 *     on a warm cache).
 *
 * Usage: node scripts/transcript-rail-fixture.mjs <config_dir> [turns]
 *
 * The scene's full command line (daemon + token + driver) is in
 * `docs/evidence/transcript-rail/README.md`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

export const RAIL_FIXTURE_SESSION = "be1a9fef0001";
/* The refusal's own conversation: deep enough that its OLDEST tick is beyond
 * the near path's 12-page budget on a fresh read (320 turns, ~2,240 rows). */
export const RAIL_FIXTURE_DEEP_SESSION = "be1a9fef0002";
/* The rail's SPARSE state (6 turns => 12 discrete ticks), host for the bounded
 * card (turn 2's user row is deliberately long) and the outcome-row card
 * (turn 3 carries an error outcome). */
export const RAIL_FIXTURE_SPARSE_SESSION = "be1a9fef0003";
/* The BUILDING state's host: a journal big enough that the index build exceeds
 * the backend's first-paint wait, so a cold/stale read answers `building`.
 * The scene appends a row before each building capture, so the leg is
 * deterministic even on a warm cache. */
export const RAIL_FIXTURE_BULK_SESSION = "be1a9fef0004";
const RAIL_FIXTURE_BULK_TURNS = 240;

const BASE_TS = 1780000000; // epoch seconds; ~2026-05-28, increasing across the log
const STEER_TURN = 120;
const ERROR_TURN = 124;
const INTERRUPTED_TURN = 128;

const USER_TEXTS = [
	"Check the download queue for anything stuck",
	"Now widen the retry window and re-run the failing shard",
	"Pull the last week of error rates and summarise the trend",
	"Write the migration for the new index and dry-run it",
	"Compare the two cache layouts and pick one",
	"Draft the release note for the sidebar fix",
	"Re-shoot the frames for the collapsed-turn story set",
	"Add the missing test for the refusal copy",
	"Trim the log noise from the poll loop",
	"Verify the scroll restore after a session switch",
];
const ANSWER_TEXTS = [
	"Done — nothing in the queue is stuck; the oldest entry is three minutes old.",
	"Retry window widened to 90 s and the shard is green on the second attempt.",
	"Errors are flat at 0.4% with one spike on Tuesday; the spike is the deploy.",
	"Migration dry-runs clean against the snapshot; plan attached.",
	"The ledger layout wins on write amplification; keeping it as is.",
	"Release note drafted and linked in the thread.",
	"Frames re-shot; the settled cell reads Took 12s on both palettes.",
	"Test added; it fails on the old copy and passes on the new one.",
	"Poll loop trimmed; the warn count drops from 41 to 2 per hour.",
	"Restore verified at 1380x900 and 800x600.",
];

const user = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "user", content: [{ text }] },
});
const assistant = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "assistant", content: [{ text }] },
});
const tool = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "tool", content: [{ text }] },
});
const start = (session, id, ts, token) => ({
	id,
	ts,
	type: "custom",
	payload: {
		custom_type: "attention_started",
		details: {
			conversation_id: `session/${session}`,
			token,
		},
	},
});
const marker = (session, id, ts, token, kind = "complete") => ({
	id,
	ts,
	type: "custom",
	payload: {
		custom_type: "completion_attention",
		details: {
			conversation_id: `session/${session}`,
			token,
			eligible: true,
			kind,
			anchor: "a-anchor",
		},
	},
});

/*
 * THE BULK SESSION'S ROWS: the same message shapes at a scale that makes the
 * backend's index build exceed its first-paint wait (`_FIRST_PAINT_WAIT_S`,
 * 0.2 s), which is the only way a driven scene can photograph the rail's
 * BUILDING state — the read answers `building` while the refresh task runs.
 * ~84 rows per turn, 2400 turns default (~200k rows, ~40 MB): measured build
 * time is seconds, and the state is never claimed from a stub.
 */
export function bulkRows(turns = RAIL_FIXTURE_BULK_TURNS) {
	const rows = [];
	let ts = BASE_TS;
	for (let turn = 1; turn <= turns; turn += 1) {
		const tag = String(turn).padStart(4, "0");
		const token = `btok-${tag}`;
		ts += 20;
		rows.push(start(RAIL_FIXTURE_BULK_SESSION, `katt${tag}`, ts, token));
		ts += 5;
		rows.push(
			user(`ku${tag}`, ts, `Bulk item ${turn}: keep the pipeline honest.`),
		);
		/*
		 * Rows per turn are deliberately large and turns few: the BUILD cost is
		 * the row count, the rail's tick count is the turn count, and this
		 * session exists to make a build slow while its rail stays light enough
		 * that the stale manifest shown DURING a rebuild is not a wall of ticks
		 * (240 turns => 480 checkpoints, ~840 rows per turn => ~200k rows).
		 */
		for (let step = 0; step < 420; step += 1) {
			ts += 2;
			rows.push(
				assistant(
					`kp${tag}${String(step).padStart(2, "0")}`,
					ts,
					`Working through bulk step ${step + 1} of 40 for turn ${turn}; the ledger read returned twelve rows and the plan is unchanged.`,
				),
			);
			ts += 2;
			rows.push(
				tool(
					`kt${tag}${String(step).padStart(2, "0")}`,
					ts,
					`bulk command ${turn}.${step + 1}: exit 0, 0.4s, no output kept`,
				),
			);
		}
		ts += 30;
		rows.push(
			assistant(
				`kn${tag}`,
				ts,
				`Bulk turn ${turn} settled; nothing needs a reader.`,
			),
		);
		ts += 10;
		rows.push(
			marker(RAIL_FIXTURE_BULK_SESSION, `kcm${tag}`, ts, token, "complete"),
		);
		ts += 60;
	}
	return rows;
}

export function writeBulkFixture(root, turns = RAIL_FIXTURE_BULK_TURNS) {
	const path = join(
		root,
		"sessions",
		RAIL_FIXTURE_BULK_SESSION,
		"transcript.jsonl",
	);
	mkdirSync(join(root, "sessions", RAIL_FIXTURE_BULK_SESSION), {
		recursive: true,
	});
	const rows = bulkRows(turns);
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
	return { path, rows: rows.length };
}

export function fixtureRows(turns = 200, session = RAIL_FIXTURE_SESSION) {
	const rows = [];
	/* Every session's ids carry a per-session prefix (`""`, `d`, `q`, `k`) so
	 * a page can tell the rails apart: the scene navigates between them, and
	 * the checkpoints of one must never answer for another. */
	const p =
		session === RAIL_FIXTURE_SESSION
			? ""
			: session === RAIL_FIXTURE_DEEP_SESSION
				? "d"
				: session === RAIL_FIXTURE_SPARSE_SESSION
					? "q"
					: "k";
	let ts = BASE_TS;
	for (let turn = 1; turn <= turns; turn += 1) {
		const tag = String(turn).padStart(4, "0");
		const token = `tok-${tag}`;
		ts += 20;
		/*
		 * The sparse session's turn 2 is the bounded-card case: a message far
		 * longer than the card's ~8-line bound, so the internal scroll is a
		 * measured fact rather than a claim.
		 */
		const longBody =
			session === RAIL_FIXTURE_SPARSE_SESSION && turn === 2
				? ` ${Array.from({ length: 12 }, (_, line) => `Paragraph ${line + 1} of the long message: the card must bound this at roughly eight lines of body-sm and scroll the rest internally rather than growing past the column.`).join(" ")}`
				: "";
		/*
		 * `attention_started` lands BEFORE its user row - the real journal's
		 * order (S3 note 1: "attention_started lands BEFORE its user row"), and
		 * the attach rule needs the user ordinal at/after the start's: a marker
		 * resolves "the LAST user checkpoint with ordinal in [S(token), M]", so
		 * with the user row first the window [S, M] excludes it and every turn
		 * settled with no outcome (measured on the first round-2 runs, which
		 * photographed the outcome-row card with no row in it).
		 */
		rows.push(start(session, `${p}att${tag}`, ts, token));
		ts += 5;
		rows.push(
			user(
				`${p}u${tag}`,
				ts,
				`${USER_TEXTS[(turn - 1) % 10]} (turn ${turn})${longBody}`,
			),
		);
		ts += 15;
		rows.push(
			assistant(
				`${p}p${tag}`,
				ts,
				"Working on it — checking the ledger first.",
			),
		);
		ts += 25;
		rows.push(tool(`${p}t${tag}a`, ts, `ledger read ${turn}: 12 rows`));
		ts += 30;
		rows.push(
			tool(`${p}t${tag}b`, ts, `command ${turn}: exit 0, 6.2s, 41 lines kept`),
		);
		ts += 30;
		if (session === RAIL_FIXTURE_SESSION && turn === STEER_TURN) {
			// A mid-run user row: the tool row above is the last paint, so the run
			// is still open and this folds into it as a steer — the row the
			// collapse hides inside the bar.
			rows.push(user(`s${tag}`, ts, "keep going, then check the tail"));
			ts += 15;
		}
		rows.push(assistant(`${p}n${tag}`, ts, ANSWER_TEXTS[(turn - 1) % 10]));
		ts += 10;
		const kind =
			session === RAIL_FIXTURE_SPARSE_SESSION
				? turn === 3
					? "error"
					: "complete"
				: turn === ERROR_TURN
					? "error"
					: turn === INTERRUPTED_TURN
						? "interrupted"
						: "complete";
		rows.push(marker(session, `${p}cm${tag}`, ts, token, kind));
		ts += 120;
	}
	return rows;
}

export function writeFixture(
	root,
	turns = 200,
	session = RAIL_FIXTURE_SESSION,
) {
	const path = join(root, "sessions", session, "transcript.jsonl");
	mkdirSync(join(root, "sessions", session), { recursive: true });
	const rows = fixtureRows(turns, session);
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
	return { path, rows: rows.length };
}

/*
 * The shared entry-point helper, not `process.argv[1]?.endsWith(...)` - the
 * lexical comparison is the silent no-op `entry-point.test.mjs` scans for
 * (through a symlinked directory the file loads, the CLI never runs and the
 * process exits 0), and CI's release-contract step drives that suite.
 */
if (isEntryPoint(import.meta.url)) {
	const root = process.argv[2];
	if (!root) {
		console.error(
			"usage: node scripts/transcript-rail-fixture.mjs <config_dir> [turns]",
		);
		process.exit(2);
	}
	const turns = process.argv[3] ? Number(process.argv[3]) : 200;
	const written = writeFixture(root, turns);
	const deep = writeFixture(root, 320, RAIL_FIXTURE_DEEP_SESSION);
	const sparse = writeFixture(root, 6, RAIL_FIXTURE_SPARSE_SESSION);
	const bulk = writeBulkFixture(root);
	for (const [label, out] of [
		[RAIL_FIXTURE_SESSION, written],
		[RAIL_FIXTURE_DEEP_SESSION, deep],
		[RAIL_FIXTURE_SPARSE_SESSION, sparse],
		[RAIL_FIXTURE_BULK_SESSION, bulk],
	]) {
		console.log(`wrote ${out.rows} rows for ${label} -> ${out.path}`);
	}
}
