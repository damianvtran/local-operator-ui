/**
 * A stand-in for `local_operator serve`, for the archive/deletion frames.
 *
 * WHY THIS EXISTS. The backend half of session archive and delete is its own
 * pull request (`damianvtran/local-operator`, branch `feat/session-archive-delete`)
 * and it had not been pushed when the desktop half was built, so there was no
 * daemon anywhere that answered `session_archive`. The frames in
 * `docs/evidence/session-archive/` are of the REAL app (the real sidebar, the
 * real store, the real header and dialog) talking to this, which answers the
 * FROZEN contract's shapes and nothing else. The pull request says per claim
 * which parts were exercised against this and which are still owed to QA against
 * the real daemon.
 *
 * WHAT IT IS NOT. Not a backend: no store, no turns, no transcript. FOUR
 * conversations, one of them archived at boot and one carrying the live-session
 * claim the two refusal frames are of, and a search over their names. Every op it
 * has no answer for is answered 503 and named on stderr, so a scene that needs one
 * shows up as a missing route rather than as a screen that quietly did not paint.
 *
 * IT IS STATEFUL, deliberately (the archive and delete routes mutate the rows), so
 * a scene run leaves it holding what the run did: give each launch its OWN
 * process - `--records` is per process - or the next launch starts from a store
 * the previous one emptied.
 *
 * Usage: node stub-daemon.mjs --port <n> --records <dir> [--no-archive]
 *
 * `--records` is the directory the DRIVER copies into the app's own
 * `<config>/run/serve`, which is how `discovery.ts` admits a daemon at all: a
 * record, a live pid, and a `/health` answer naming the same `instance_id`.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const PORT = Number(arg("port", "18234"));
const RECORDS = arg("records", null);
/* `--no-archive` is the WITHDRAWN half: the same app against a backend that has
 * never heard of archiving, which is the fail-closed pair's other frame. */
const ARCHIVE = !process.argv.includes("--no-archive");
const INSTANCE_ID = randomUUID();
/** The record's `started_at` is fixed at boot; the heartbeat moves. */
const startedAt = Date.now() / 1000;

/**
 * Four conversations, in the wire's own field names, and one of them archived.
 * The archived one is what the sidebar's `Include archived` control is for: it is
 * absent from the default list and from a default search, and present in both
 * once the control is on.
 */
const conversations = [
	{
		id: "2d5ad5da0025",
		name: "Invoice reconciliation",
		mtime: 40,
		preview: "Reconcile March invoices against the ledger",
		archived: false,
		pinned: false,
		active: true,
		/*
		 * IDLE, deliberately, and the reason is a fact about the instrument: a
		 * `busy` row draws an indeterminate status glyph, and `captureSettled`
		 * requires two consecutive byte-identical frames - so a running turn makes
		 * every frame of this set "never held still". Nothing a frame here is OF
		 * depends on a turn being in flight, and the delete route's own 409 (the
		 * live-session guard) is exercised by the scene's own fixture instead.
		 */
		live_state: "idle",
		pending: null,
		status: { code: "recent", label: "Recent" },
		binding: { agent: null, team: null },
	},
	{
		id: "e059761608ae",
		name: "Release notes for 0.29",
		mtime: 900,
		preview: "Draft the release notes from the merged pull requests",
		archived: false,
		pinned: false,
		active: false,
		live_state: "idle",
		pending: null,
		status: { code: "recent", label: "Recent" },
		binding: { agent: null, team: null },
	},
	{
		id: "7c1b0f2a4d31",
		name: "Migration checklist",
		mtime: 4_000,
		preview: "The steps left before the schema migration",
		archived: false,
		pinned: false,
		active: false,
		live_state: "idle",
		pending: null,
		status: { code: "recent", label: "Recent" },
		binding: { agent: null, team: null },
		/*
		 * THE GUARD'S PRECONDITION, arranged by hand and disclosed as such: the real
		 * route refuses a delete (and an archive) for a conversation a RUNNING SESSION
		 * holds, which on a real install is a `.session.pid` marker beside the
		 * transcript rather than a running turn. The stub has no runtimes, so the claim
		 * is a field - and `live_state` stays `idle` on purpose, because a `busy` row
		 * draws an indeterminate glyph and no frame of this set may depend on that.
		 * This is the conversation the two refusal frames are OF; every other row
		 * accepts both writes.
		 */
		live_claim: true,
	},
	{
		/*
		 * THE ROW THAT CARRIES AN UNREAD MARK, which is the binding case for the
		 * reserved slot's cost: the mark is a trailing slot OUTSIDE the truncating
		 * title, so this row has less title than a bare one at the same width - and
		 * it is the row a reader who wants a wide title is most likely to be reading.
		 * `attention.unseen` plus a `complete` status is exactly what
		 * `unreadMarkKind` reads, so the glyph is drawn rather than described.
		 *
		 * Oldest mtime, so it sorts LAST and none of the other frames' rows move:
		 * every claim those frames carry is about the rows above it.
		 */
		id: "b3f1a09c7d52",
		name: "Quarterly retention sweep",
		mtime: 900_000,
		preview: "Which transcripts the sweep kept and which it dropped",
		archived: false,
		pinned: false,
		active: false,
		live_state: "idle",
		pending: null,
		status: { code: "complete", label: "Complete" },
		attention: { unseen: true },
		binding: { agent: null, team: null },
	},
	{
		id: "a91f4c7e2b60",
		name: "Old onboarding notes",
		mtime: 90_000,
		preview: "What we learned onboarding the first two customers",
		archived: true,
		pinned: false,
		active: false,
		live_state: "idle",
		pending: null,
		status: { code: "recent", label: "Recent" },
		binding: { agent: null, team: null },
	},
];

/** The command catalogue the composer reads; the archive three are the subject. */
const commands = [
	{
		name: "archive",
		description: "Archive the open conversation",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.archive",
		execution: "native",
	},
	{
		name: "unarchive",
		description: "Restore the open conversation to the lists",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.unarchive",
		execution: "native",
	},
	{
		name: "delete",
		description: "Delete the open conversation permanently",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.delete",
		execution: "native",
	},
	{
		name: "clear",
		description: "Clear the view without deleting anything",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.clear",
		execution: "native",
	},
];

const ok = (result) => ({ status: 200, body: { result } });

const route = (method, pathname, query, body) => {
	if (method === "GET" && pathname === "/health") {
		return ok({
			instance_id: INSTANCE_ID,
			pid: process.pid,
			version: "0.0.0-stub",
			prefix: process.cwd(),
			install_kind: "stub",
		});
	}
	/*
	 * The claim handshake, which is what turns "a daemon is on this machine" into
	 * "this app is attached to it". Without an answer here the app says so in a
	 * banner across the top of the window - true about the stub, and noise over the
	 * surface these frames are of.
	 */
	if (method === "POST" && pathname === "/v1/desktop/claim") {
		return ok({ claimed: true });
	}
	if (method === "GET" && pathname === "/v1/capabilities") {
		return ok({
			desktop_contract: 1,
			desktop_available: true,
			desktop_auth: "bearer",
			features: {
				/*
				 * The seven keys `REQUIRED_BACKEND_FEATURES` names, so the compatibility
				 * banner does not cover the surfaces these frames are OF. They describe
				 * THIS STAND-IN rather than the app: a real daemon advertises them
				 * because it has them, and the stub advertises them because the banner's
				 * subject (which routes exist) is not what a sidebar frame is about. The
				 * README says so beside the frames.
				 */
				auth: 1,
				settings: 1,
				commands: 1,
				catalogues: 1,
				lifecycle: 1,
				mcp: 1,
				radient: 1,
				session_catalogue: 2,
				session_search: 1,
				session_move: 1,
				profile_catalogue: 1,
				team_catalogue: 1,
				/*
				 * THE PIN STORE TOO, unconditionally: the per-row controls are a PAIR, and
				 * the width rule this feature delivers is about that pair - two sibling
				 * reserved slots above the panel's default width, one shared control below
				 * it. A stand-in that advertised only the archive half would photograph a
				 * row no user can reach, so the capability and the route below describe the
				 * panel as delivered. Nothing in these frames presses the pin.
				 */
				session_pins: 1,
				...(ARCHIVE ? { session_archive: 1, session_delete: 1 } : {}),
			},
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/commands") {
		return ok({ commands: ARCHIVE ? commands : commands.slice(3) });
	}
	if (method === "GET" && pathname === "/v1/desktop/sessions") {
		const include = query.get("include_archived") === "true";
		return ok({
			sessions: conversations.filter((row) => include || !row.archived),
			truncated: false,
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/sessions/search") {
		const needle = (query.get("q") ?? "").toLocaleLowerCase();
		const include = query.get("include_archived") === "true";
		const matched = conversations.filter((row) =>
			row.name.toLocaleLowerCase().includes(needle),
		);
		return ok({
			sessions: (include
				? matched
				: matched.filter((row) => !row.archived)
			).map((row) => ({
				id: row.id,
				name: row.name,
				mtime: row.mtime,
				forked: false,
				rank: 0,
				body_match: false,
				archived: row.archived,
			})),
			query: query.get("q") ?? "",
			limit: 100,
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/profiles") {
		return ok({ profiles: [] });
	}
	if (method === "GET" && pathname === "/v1/desktop/teams") {
		return ok({ teams: [] });
	}
	/*
	 * The pin route, present because the capability above is: the fixture is a
	 * stand-in for a daemon that HAS the pin store, and a capability without its
	 * route would make a press answer 503 while the panel drew the control.
	 */
	const pinMatch = pathname.match(/^\/v1\/desktop\/sessions\/([^/]+)\/pin$/);
	if (method === "POST" && pinMatch) {
		const row = conversations.find((entry) => entry.id === pinMatch[1]);
		if (!row) {
			return { status: 404, body: { detail: "No such conversation." } };
		}
		row.pinned = body?.pinned === true;
		return ok({ session_id: row.id, pinned: row.pinned === true });
	}
	const archiveMatch = pathname.match(
		/^\/v1\/desktop\/sessions\/([^/]+)\/archive$/,
	);
	if (method === "POST" && archiveMatch) {
		const row = conversations.find((entry) => entry.id === archiveMatch[1]);
		if (!row) {
			return { status: 404, body: { detail: "No such conversation." } };
		}
		/*
		 * THE SAME GUARD AS THE DELETE, and it is quoted rather than invented: the
		 * sibling route's own sentence, as the UX round reported reading it against a
		 * real daemon. A stub cannot derive the wording, so the frame shows the
		 * client's rendering of a backend sentence (the panel's warning ink and its
		 * Retry) rather than a sentence this file authored.
		 */
		if (row.live_claim) {
			return {
				status: 409,
				body: {
					detail:
						"That conversation is open in a running session. Stop it before archiving it.",
				},
			};
		}
		row.archived = body?.archived === true;
		return ok({ session_id: row.id, archived: row.archived });
	}
	const deleteMatch = pathname.match(/^\/v1\/desktop\/sessions\/([^/]+)$/);
	if (method === "DELETE" && deleteMatch) {
		const at = conversations.findIndex((entry) => entry.id === deleteMatch[1]);
		if (at === -1) {
			return { status: 404, body: { detail: "No such conversation." } };
		}
		/*
		 * The live-session guard, which the dialog is built to report: a turn is
		 * running in this conversation, so the route refuses and NAMES the guard
		 * rather than deleting a transcript a running agent is writing to.
		 */
		if (
			conversations[at].live_state === "busy" ||
			conversations[at].live_claim
		) {
			return {
				status: 409,
				body: {
					detail:
						"That conversation is open in a running session. Stop it before deleting it.",
				},
			};
		}
		conversations.splice(at, 1);
		return ok({ session_id: deleteMatch[1], deleted: true });
	}
	if (method === "GET" && deleteMatch) {
		const row = conversations.find((entry) => entry.id === deleteMatch[1]);
		return row
			? ok(row)
			: { status: 404, body: { detail: "No such conversation." } };
	}
	return {
		status: 503,
		body: { detail: `the stub has no answer for ${method} ${pathname}` },
	};
};

const server = createServer((request, response) => {
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", () => {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
		let body = null;
		if (chunks.length > 0) {
			try {
				body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				body = null;
			}
		}
		const answer = route(
			request.method ?? "GET",
			url.pathname,
			url.searchParams,
			body,
		);
		process.stderr.write(
			`stub ${request.method} ${url.pathname}${url.search} -> ${answer.status}\n`,
		);
		response.writeHead(answer.status, { "content-type": "application/json" });
		response.end(JSON.stringify(answer.body));
	});
});

server.listen(PORT, "127.0.0.1", () => {
	process.stderr.write(`stub daemon listening on 127.0.0.1:${PORT}\n`);
	if (RECORDS) {
		mkdirSync(RECORDS, { recursive: true });
		const recordPath = join(RECORDS, `${process.pid}.json`);
		const write = () => {
			const now = Date.now() / 1000;
			writeFileSync(
				recordPath,
				JSON.stringify({
					pid: process.pid,
					host: "127.0.0.1",
					port: PORT,
					instance_id: INSTANCE_ID,
					version: "0.0.0-stub",
					source_ref: "feat/session-archive-delete",
					prefix: process.cwd(),
					install_kind: "stub",
					desktop: true,
					claim_key: "stub",
					started_at: startedAt,
					heartbeat_at: now,
				}),
			);
		};
		write();
		/*
		 * The heartbeat is not decoration: `discovery.ts` calls a record with a live
		 * pid and a STOPPED heartbeat `wedged`, and the app says so in a banner across
		 * the top of the window - which would cover the very surfaces these frames are
		 * of. The real daemon rewrites its record on `HEARTBEAT_INTERVAL_S`.
		 */
		setInterval(write, 5_000).unref();
		process.stderr.write(`serve record written to ${RECORDS}\n`);
	}
});
