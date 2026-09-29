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
 * ONE conversation carries every case the scene needs:
 *   - default 200 turns => 402 checkpoints, the rail's density case (v1 allows
 *     overlap at this size, and the frame is what "must not look broken" means);
 *   - turn 120 is STEERED — a mid-run user row after a tool row, which folds
 *     into that turn's open run, so the collapse hides it inside the bar: the
 *     jump-into-a-collapsed-run case, where expand-first has to fire;
 *   - turns 124 and 128 carry non-complete outcomes (error, interrupted);
 *   - ~1,400 rows puts the OLDEST tick beyond the near path's 12-page budget,
 *     which is the refusal case.
 *
 * Usage: node scripts/transcript-rail-fixture.mjs <config_dir> [turns]
 *
 * The scene's full command line (daemon + token + driver) is in
 * `docs/evidence/transcript-rail/README.md`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RAIL_FIXTURE_SESSION = "be1a9fef0001";
/* The refusal's own conversation: deep enough that its OLDEST tick is beyond
 * the near path's 12-page budget on a fresh read (320 turns, ~2,240 rows). */
export const RAIL_FIXTURE_DEEP_SESSION = "be1a9fef0002";

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

export function fixtureRows(turns = 200, session = RAIL_FIXTURE_SESSION) {
	const rows = [];
	/* The deep session's ids carry a `d` prefix so a page can tell the two
	 * rails apart: the scene navigates between them, and the checkpoints of
	 * one must never answer for the other. */
	const p = session === RAIL_FIXTURE_SESSION ? "" : "d";
	let ts = BASE_TS;
	for (let turn = 1; turn <= turns; turn += 1) {
		const tag = String(turn).padStart(4, "0");
		const token = `tok-${tag}`;
		ts += 20;
		rows.push(
			user(`${p}u${tag}`, ts, `${USER_TEXTS[(turn - 1) % 10]} (turn ${turn})`),
		);
		ts += 5;
		rows.push(start(session, `${p}att${tag}`, ts, token));
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
			turn === ERROR_TURN
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

if (process.argv[1]?.endsWith("transcript-rail-fixture.mjs")) {
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
	console.log(
		`wrote ${written.rows} rows for ${RAIL_FIXTURE_SESSION} -> ${written.path}`,
	);
	console.log(
		`wrote ${deep.rows} rows for ${RAIL_FIXTURE_DEEP_SESSION} -> ${deep.path}`,
	);
}
