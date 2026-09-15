#!/usr/bin/env node
/**
 * The store the chat-sidebar selection frames are taken against.
 *
 *     node seed.mjs <scratch-root>
 *
 * Runs as the window-mode harness's SECOND seeding pass (`EXTRA_SEED`), i.e.
 * after its own `seed.mjs`, and it also creates the dev driver's frames
 * directory: the app writes a capture into that path and does not create it
 * itself, while the harness `rm -rf`s the whole scratch root just before this
 * runs, so the directory has to be made HERE rather than by the caller.
 *
 * Seven sessions, each with a `title.json` sidecar and a two-message transcript.
 * The titles are seeded rather than derived because these frames argue about
 * WHICH ROW is marked: a row whose label is `Untitled` tells a reviewer nothing
 * about whether the right one is highlighted, and auto-derived titles would
 * differ between the before and after trees. The ids are fixed and the
 * timestamps are offsets from a single `started`, so the rows land in the same
 * order on every run — which is what makes a before frame and an after frame a
 * comparison rather than two pictures.
 *
 * The SEVENTH is BOUND to a packaged profile (`architect`) and carries a title
 * long enough to truncate, because three states this set had no pixels for are
 * all the same seeded row: the trailing statement (`· architect`) and the
 * truncated title on a MARKED row, and the `pl-7` nested child row under its
 * entity. The binding is the sidecar the app itself writes — the session's
 * `attachment.json`, whose absence means "the user's own session" (see
 * `local_operator/resume.py`), so nothing here is a shape the app cannot
 * produce. Its id sorts after the six above it so the flat list keeps the order
 * the other frames were shot in.
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

/** The id the frames select — third of six, so the row has siblings above and below. */
const SELECTED = "b3b3b3b3b3b3";

/** The id bound to a profile, whose row carries a trailing statement and truncates. */
const BOUND = "b7b7b7b7b7b7";

const SESSIONS = [
	["b1b1b1b1b1b1", "Ledger reconciliation plan", "Reconcile the ledger for Q3"],
	["b2b2b2b2b2b2", "Loader cache invalidation", "Why does the loader re-read the index"],
	["b3b3b3b3b3b3", "Retention sweep notes", "Summarise the retention sweep"],
	["b4b4b4b4b4b4", "Throughput investigation", "Investigate the throughput drop"],
	["b5b5b5b5b5b5", "Session cookie audit", "Audit the session cookies"],
	["b6b6b6b6b6b6", "Deploy window checklist", "Draft the deploy window checklist"],
	[
		BOUND,
		"Architect handoff: reconcile the retention sweep with the loader cache invalidation findings",
		"Hand this to the architect",
	],
];

/* One `started` for the whole store, so the rows' order does not depend on when
   the seed ran. Offsets are minutes apart and descending in the list above, so
   `b1b1…` is the most recent. */
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
				`Working on "${title}". This transcript is a seeded fixture for the chat-sidebar selection frames.`,
			),
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n")}\n`,
	);
	writeFileSync(
		join(dir, "title.json"),
		`${JSON.stringify({ text: title, user_set: false, names: [title] })}\n`,
	);
	if (id === BOUND) {
		/* The app's own sidecar, written in the shape `write_session_attachment`
		   writes it: NAMES, not briefs. No `agent.yml` is seeded beside it — the
		   entity row comes from the packaged starter profiles the registry lists
		   anyway, so the frames are of the resolution a user gets on a fresh
		   install rather than of a fixture only this set can produce. */
		writeFileSync(
			join(dir, "attachment.json"),
			`${JSON.stringify({ team: "", agent: "architect", goal: "" })}\n`,
		);
	}
}

console.log(SELECTED);
