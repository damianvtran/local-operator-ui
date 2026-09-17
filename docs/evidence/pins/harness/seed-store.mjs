/**
 * Seed a local-operator store with named conversations, for the pins frames.
 *
 *     node docs/evidence/pins/harness/seed-store.mjs --root <config-root> \
 *          --titles "Retention sweep notes" "Migrate the billing ledger"
 *
 * WHY A RIG AND NOT THE PRODUCT: the pins claim needs a catalogue with several
 * conversations in it, and a session the product creates (`POST
 * /v1/desktop/sessions`) is called "Untitled chat" until a turn has run in it.
 * Frames about which conversation sits in which section read as the product when
 * the rows carry titles, and the title is a file the store already reads
 * (`title.json`, beside `transcript.jsonl`, `created_at.json` and the desktop
 * marker) — the shape `scripts/seed-paging-session.mjs` establishes. This writes
 * those four files per session and nothing else: no daemon, no database, no
 * shared state, and it never touches a store it did not create.
 *
 * The ids are derived from the titles, so two runs of this seeder produce the
 * same store, which is what lets a reviewer re-run the frames.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Every argument after `--titles`, up to the next `--flag`. */
function titleArgs() {
	const at = process.argv.indexOf("--titles");
	if (at === -1) return [];
	const out = [];
	for (const value of process.argv.slice(at + 1)) {
		if (value.startsWith("--")) break;
		out.push(value);
	}
	return out;
}

const rootAt = process.argv.indexOf("--root");
const ROOT = rootAt === -1 ? null : process.argv[rootAt + 1];
if (!ROOT) {
	console.error(
		"usage: node docs/evidence/pins/harness/seed-store.mjs --root <config-root> [--titles a b c]",
	);
	process.exit(2);
}

/**
 * `--generate N` writes N sessions with numbered titles.
 *
 * WHY. The search-only scene needs a store LARGER than the panel's own page (the catalogue
 * read asks for 500), and a hand-written list of 568 titles is a list nobody reads. The
 * numbering is also what makes the pick deterministic: the oldest sessions are the ones the
 * page drops, and their titles are the ones the scene searches for.
 */
function generated() {
	const at = process.argv.indexOf("--generate");
	if (at === -1) return [];
	const count = Number(process.argv[at + 1]);
	if (!Number.isFinite(count) || count <= 0) return [];
	return Array.from(
		{ length: count },
		(_, index) => `Sweep ${String(index + 1).padStart(3, "0")}`,
	);
}

const titles = generated().length
	? generated()
	: titleArgs().length
		? titleArgs()
		: [
				"Retention sweep notes",
				"Migrate the billing ledger",
				"Investigate the throughput dip",
				"Watchlist dossiers",
			];

/**
 * A 12-hex session id, deterministic in the title.
 *
 * The shape is not decoration: the desktop route and the pin store both validate
 * `^[a-f0-9]{12}$`, so a store seeded with anything else would be refused before
 * it reached a row.
 */
const sessionId = (title) =>
	createHash("sha1")
		.update(`pins-evidence:${title}`)
		.digest("hex")
		.slice(0, 12);

const sessions = join(ROOT, "sessions");
mkdirSync(sessions, { recursive: true });

const base = Math.floor(Date.now() / 1000) - 600;
const written = titles.map((title, index) => {
	const id = sessionId(title);
	const dir = join(sessions, id);
	mkdirSync(dir, { recursive: true });
	/*
	 * One short exchange, and the FIRST user message is the title EXACTLY: the
	 * store names a conversation after the opening user turn (`title.json` is only
	 * consulted when there is one), so a longer sentence here would rename every
	 * row and every frame with it.
	 */
	const startedAt = base + index * 60;
	const lines = [
		{
			id: `${id}-0001`,
			ts: startedAt,
			type: "message",
			payload: {
				kind: "message",
				role: "user",
				content: [{ text: title }],
			},
		},
		{
			id: `${id}-0002`,
			ts: startedAt + 30,
			type: "message",
			payload: {
				kind: "message",
				role: "assistant",
				content: [
					{
						text: `Here is where ${title.toLowerCase()} stands, and what I would do next.`,
					},
				],
			},
		},
	];
	writeFileSync(
		join(dir, "transcript.jsonl"),
		`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
	);
	writeFileSync(join(dir, "created_at.json"), JSON.stringify(startedAt));
	writeFileSync(join(dir, "title.json"), JSON.stringify({ title }));
	// The desktop marker, which is what lets the app open the session without
	// replaying a frontend checkpoint to recover a working directory.
	writeFileSync(
		join(dir, "desktop.json"),
		JSON.stringify({ cwd: process.env.HOME ?? homedir() }),
	);
	return { id, title };
});

console.log(JSON.stringify({ root: sessions, sessions: written }, null, 2));
