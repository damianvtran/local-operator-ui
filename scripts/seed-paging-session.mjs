#!/usr/bin/env node
/**
 * Seed a real backend session with enough durable history to need real paging.
 *
 *     node scripts/seed-paging-session.mjs <config-dir> [rows]
 *
 * Why a seeder rather than a real conversation. The behaviour under test needs
 * at least two durable pages (the transport asks for 100 rows at a time), which
 * is 250+ turns of an agent actually answering — hours of model calls, a
 * different transcript every run, and nothing an independent QA pass could
 * reproduce. What the paging path consumes is the TRANSCRIPT FILE, so the
 * cheapest honest fixture is that file: the backend reads it with its own
 * `read_transcript_page`, serves it over its own `/v1/desktop/sessions/{id}/
 * history` route, the app's own main-process transport fetches it, and the
 * renderer's own reducer folds it. Nothing about the path under test is
 * simulated; only the conversation's CONTENT is synthetic.
 *
 * The rows are the same JSONL shape `local_operator/session/transcript.py`
 * appends — `{id, ts, type: "message", payload: {kind, role, content}}` — with
 * ids that are 32 hex characters, because that is what the session store's own
 * id pattern accepts and what the paging cursor (`before_id`) is matched
 * against.
 *
 * Row heights vary on purpose. A transcript of identical one-line rows would
 * make the anchor arithmetic look correct for the wrong reason: every row the
 * same height means an off-by-one in row identity produces a displacement of
 * zero. Prose of varying length, and a periodic long block, means a mistake
 * shows up as a visible number.
 *
 * Writes into an ISOLATED config dir, never the operator's real
 * `~/.local-operator`. The dir is the first argument and the script refuses to
 * run without one.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const CONFIG = process.argv[2];
const ROWS = Number(process.argv[3] ?? 260);

if (!CONFIG) {
	console.error("usage: seed-paging-session.mjs <config-dir> [rows]");
	process.exit(1);
}
const root = resolve(CONFIG);
if (root === join(homedir(), ".local-operator")) {
	// The QA gate's rule, enforced rather than documented: a seeded fixture must
	// never land in the operator's live session store.
	console.error("refusing to seed into the live config dir");
	process.exit(1);
}

const id = () => randomBytes(16).toString("hex");
const sessionId = randomBytes(6).toString("hex");
const dir = join(root, "sessions", sessionId);
mkdirSync(dir, { recursive: true });

// Deterministic, so two runs of the seeder produce byte-identical transcripts
// and a QA pass can compare its numbers against the ones in the README.
let seed = 0x2f6e2b1;
const rand = () => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
};

const WORDS =
	"the transcript holds every durable row this conversation has ever written and the reader scrolls back through it one page at a time while the anchor stays exactly where they left it".split(
		" ",
	);
const prose = (n) =>
	Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(
		" ",
	);

const start = Date.now() / 1000 - ROWS * 60;
const lines = [];
for (let i = 0; i < ROWS; i++) {
	const user = i % 2 === 0;
	// Every twentieth assistant row is a long block, so the transcript has rows
	// tall enough to make a mis-measured anchor visible rather than plausible.
	const words = user ? 6 + Math.floor(rand() * 14) : i % 20 === 1 ? 180 : 20 + Math.floor(rand() * 60);
	lines.push(
		JSON.stringify({
			id: id(),
			ts: start + i * 60,
			type: "message",
			payload: {
				kind: "message",
				role: user ? "user" : "assistant",
				content: [{ text: `[row ${String(i).padStart(4, "0")}] ${prose(words)}` }],
			},
		}),
	);
}

writeFileSync(join(dir, "transcript.jsonl"), `${lines.join("\n")}\n`);
writeFileSync(
	join(dir, "created_at.json"),
	JSON.stringify(start),
);
// The desktop marker is what lets the pool open this session without replaying
// a frontend checkpoint to recover a working directory.
writeFileSync(
	join(dir, "desktop.json"),
	JSON.stringify({ cwd: process.env.HOME ?? homedir() }),
);
writeFileSync(
	join(dir, "title.json"),
	JSON.stringify({ title: "Scroll paging fixture" }),
);

console.log(
	JSON.stringify(
		{ sessionId, rows: ROWS, pages: Math.ceil(ROWS / 100), dir },
		null,
		2,
	),
);
