#!/usr/bin/env node
/**
 * The store the ack/selection frames are taken against, plus the backend
 * configuration that makes a REAL turn possible.
 *
 *     node seed.mjs <scratch-root>
 *
 * Runs as this set's own seeding pass, before the backend starts. It writes:
 *
 * - `config.yml` naming the TEST hosting (`hosting: test`, `model_name: mock`).
 *   This is what lets the rig run an actual turn with no network and no spend
 *   (`providers/registry.py`'s `test` provider, `wire="mock"`), which is the
 *   ingredient `use-completion-view` needs: a real completion publishes a real
 *   attention record, and the mark the sidebar draws is that record's `unseen`
 *   level rather than a fixture. The backend's own notifier suppresses itself
 *   for a mock process, so a rig turn cannot put a banner on the operator's
 *   screen.
 * - four seeded conversations with fixed ids, fixed timestamps and seeded
 *   titles, so the selection scenes compare the SAME list on the before and
 *   after trees.
 * - the dev driver's frames directory (the app writes captures into it and
 *   does not create it itself).
 *
 * The shapes come from the backend source and mirror the committed
 * `docs/evidence/chat-sidebar-selection/harness/seed.mjs`: a session directory
 * is 12 lowercase hex, `transcript.jsonl` carries one JSON object per line with
 * a `type` and a `payload`, and `title.json` is the app's own sidecar shape.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = process.argv[2];
if (!root) {
	console.error("usage: seed.mjs <scratch-root>");
	process.exit(1);
}
const CONFIG = join(resolve(root), "config");
if (CONFIG === join(homedir(), ".local-operator")) {
	console.error("refusing to seed into the live config dir");
	process.exit(1);
}
mkdirSync(join(resolve(root), "frames"), { recursive: true });

/* The conversation the turn scenes run in: the one the app will be VIEWING. */
const VIEWED = "c1c1c1c1c1c1";
/* The conversation the selection scenes click AWAY to. */
const OTHER = "c2c2c2c2c2c2";
/* A third row, so a click has siblings above and below it. */
const THIRD = "c3c3c3c3c3c3";
/* A fourth, beyond the ones the scenes name. */
const FOURTH = "c4c4c4c4c4c4";

const SESSIONS = [
	[VIEWED, "Quarterly ledger reconciliation", "Reconcile the ledger for Q3"],
	[OTHER, "Loader cache invalidation", "Why does the loader re-read the index"],
	[THIRD, "Retention sweep summary", "Summarise the retention sweep"],
	[FOURTH, "Throughput investigation", "Investigate the throughput drop"],
];

/*
 * One `started` for the whole store, so the rows' order does not depend on when
 * the seed ran. Offsets are minutes apart and descending in the list above, so
 * the first row is the most recent and the four land in a stable order.
 */
const started = Date.UTC(2026, 8, 14, 9, 0, 0) / 1000;

const row = (ts, role, text) => ({
	id: `${ts.toString(16).padStart(16, "0")}${role.padEnd(16, "0").slice(0, 16)}`,
	ts,
	type: "message",
	payload: { kind: "message", role, content: [{ text }] },
});

for (const [index, [id, title, question]] of SESSIONS.entries()) {
	const dir = join(CONFIG, "sessions", id);
	mkdirSync(dir, { recursive: true });
	const at = started - index * 600;
	writeFileSync(
		join(dir, "transcript.jsonl"),
		`${[
			row(at, "user", question),
			row(
				at + 4,
				"assistant",
				`Working on "${title}". This transcript is a seeded fixture for the ack/selection frames.`,
			),
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n")}\n`,
	);
	writeFileSync(
		join(dir, "title.json"),
		`${JSON.stringify({ text: title, user_set: false, names: [title] })}\n`,
	);
}

/*
 * The test hosting, verbatim from `scripts/submit-latency.test.mjs`'s own
 * backend boot: a real provider path with no network, which is what makes the
 * turn scenes real rather than staged. `aida.enabled: false` is the second
 * half of the same isolation: the runtime would otherwise ensure its own
 * assistant session and pin a row for her at boot, and this set's scenes and
 * frames are about the seeded conversations only. `LOCAL_OPERATOR_NO_AIDA` is
 * set on the launches as well, because the env switch and the config key are
 * two halves of one gate (`aida/bootstrap.py::config_enabled`).
 */
writeFileSync(
	join(CONFIG, "config.yml"),
	"version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n  aida:\n    enabled: false\n",
);

console.log(VIEWED);
