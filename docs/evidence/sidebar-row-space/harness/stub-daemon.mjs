/**
 * A stand-in for `local_operator serve`, for the sidebar row-space frames.
 *
 * WHY THIS EXISTS, given the archive set already has one. This set photographs
 * the row's HORIZONTAL BUDGET - how much of a row the per-row controls take at
 * rest and under the pointer, at three panel widths - and that claim needs two
 * things the archive fixture does not carry: a conversation whose title is long
 * enough to TRUNCATE, and a conversation that is PINNED at boot. Its four titles
 * all fit their box, so a frame of it could not show the dead space the operator
 * reported; a scene that pinned a row by pressing would photograph a different
 * list before and after that press.
 *
 * It is otherwise the same stand-in: the real app over a frozen-contract
 * responder. WHAT IT IS NOT: a backend. No store, no turns, no transcript. Six
 * conversations, one pinned, one archived at boot and one carrying the unread
 * mark's own attention shape. Every op it has no answer for is answered 503 and
 * named on stderr.
 *
 * IT IS STATEFUL, deliberately (the archive and pin routes mutate the rows), so a
 * scene run leaves it holding what the run did: give each launch its OWN process -
 * `--records` is per process.
 *
 * Usage: node stub-daemon.mjs --port <n> --records <dir>
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
/*
 * THE PAGED CATALOGUE (evidence set `sidebar-lazy-chats`).
 *
 * `--catalogue=<n>` swaps the six-conversation fixture for a LARGE one spread
 * across teams and agents, and (unless `--no-page`) advertises
 * `session_catalogue_page` so the app asks for it a page at a time. Without the
 * flag this file answers exactly what it answered before it grew this branch, so
 * the frames of `sidebar-row-space` are photographed over an unchanged stand-in.
 *
 * `--truncate=<n>` is the WITHDRAWN half's lever: answer at most n rows and IGNORE
 * the requested limit, which is what a daemon that cannot page does - 500 of 757,
 * with no cursor. A group whose conversations sit past that cap then draws "No
 * chats yet", which is the operator's own screenshot.
 */
const CATALOGUE = Number(arg("catalogue", "0"));
const TRUNCATE = Number(arg("truncate", "0"));
const PAGED = CATALOGUE > 0 && !process.argv.includes("--no-page");
/* `--scope-empty` answers every SCOPED read with no rows while the census still
 * counts the scope: the page has not caught up with the store, which is the state
the group must say "Loading chats…" in rather than "No chats yet". */
const SCOPE_EMPTY = process.argv.includes("--scope-empty");
/* `--scope-error` makes every SCOPED read refuse, so the group's own failure
 * sentence and its Retry are photographed. */
const SCOPE_ERROR = process.argv.includes("--scope-error");
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
		live_state: "idle",
		pending: null,
		status: { code: "recent", label: "Recent" },
		binding: { agent: null, team: null },
	},
	{
		/*
		 * THE PINNED ROW, and it is a FIXTURE FIELD rather than a press so that the
		 * frame set is one launch's worth of state: the pinned row is the row the
		 * operator's own screenshot carried (a pinned conversation whose title
		 * truncates early with nothing drawn to its right), and a scene that had to
		 * press a pin first would photograph a different list for every frame taken
		 * before the press.
		 */
		id: "c4e17b90a2f6",
		name: "AWS cost increase review with Grafana dashboards",
		mtime: 200,
		preview: "Why the Grafana bill moved this month and what to do about it",
		archived: false,
		pinned: true,
		active: false,
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
		/*
		 * THE SHORT TITLE, deliberately: it FITS its box at every width in this set,
		 * which is the row a marquee must leave alone. A scene with only long titles
		 * would have no frame in which "the title does not move" could be seen to be
		 * true, and the rule is one half of the change.
		 */
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
	},
	{
		/*
		 * THE LONG TITLE, and the reason this fixture is not the archive set's: the
		 * operator's report is a TITLE-TRUNCATES-EARLY report, and none of the four
		 * conversations that set carries is long enough to truncate in a 180px box.
		 * This one is 55 characters and truncates at every width photographed here,
		 * so the dead space to its right is a measurement rather than a class name.
		 *
		 * It also carries the unread mark, in the shape `mergeCompletionAttention`
		 * accepts, so the marked row and the long row are ONE row: the mark is drawn
		 * inside the row's LEADING status slot and costs the title nothing
		 * (`docs/design/session-archive-delete.md`, D14), which is a fact this set
		 * inherits rather than re-states.
		 */
		id: "b3f1a09c7d52",
		name: "Quarterly retention sweep and the transcripts it dropped",
		mtime: 90_000,
		preview: "Which transcripts the sweep kept and which it dropped",
		archived: false,
		pinned: false,
		active: false,
		live_state: "idle",
		pending: null,
		status: { code: "complete", label: "Complete" },
		attention: {
			conversation_id: "session/b3f1a09c7d52",
			completion_token: "stub-completion-b3f1a09c7d52",
			anchor_id: null,
			kind: "complete",
			unseen: true,
			revision: [1, 1],
			supported: true,
		},
		binding: { agent: null, team: null },
	},
	{
		id: "a91f4c7e2b60",
		name: "Old onboarding notes",
		mtime: 900_000,
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
				/*
				 * ONLY WHEN THE STUB IS SERVING THE PAGED CATALOGUE. The key is the whole
				 * switch this evidence set is about, and an unconditional one would change
				 * what every OTHER frame in `docs/evidence/` renders - the withdrawn pair
				 * above all, whose subject is a panel that does not know the feature.
				 */
				...(PAGED ? { session_catalogue_page: 1 } : {}),
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
		const limit = Number(query.get("limit") ?? "100");
		const kind = query.get("scope_kind");
		const name = query.get("scope_name");
		const cursor = query.get("cursor");
		/*
		 * A SCOPED READ AGAINST A STUB ARMED WITH A FAILURE answers the failure and
		 * nothing else, so the group's own sentence and its Retry are photographed
		 * rather than inferred from the store's test suite.
		 */
		if (kind && SCOPE_ERROR) {
			/*
			 * 500 RATHER THAN 503, and that is not a detail: the app maps 503 to its own
			 * control-plane sentence ("the server does not accept this app's desktop
			 * controls", which `remote-error.ts` reserves for a closed plane), so a 503
			 * here would photograph a pairing message instead of the group's failure.
			 * A backend fault is a 500.
			 */
			return {
				status: 500,
				body: { detail: "The stub was asked to refuse scoped reads." },
			};
		}
		if (kind && SCOPE_EMPTY) {
			/*
			 * THE CENSUS STILL COUNTS THE SCOPE. That is the whole point of this arm:
			 * the store SAYS the group holds conversations while the page carries none
			 * of them, which is the state the group must describe as loading rather
			 * than as empty.
			 */
			return ok({
				sessions: [],
				truncated: false,
				next_cursor: null,
				cursor_missing: false,
				scope: { kind, name },
				...(PAGED
					? { counts: censusOf(served.filter((row) => include || !row.archived)) }
					: {}),
			});
		}
		let rows = served.filter((row) => include || !row.archived);
		if (kind) {
			rows = rows.filter((row) =>
				kind === "team"
					? row.binding?.team === name
					: !row.binding?.team && row.binding?.agent === name,
			);
		}
		/*
		 * `--truncate` is the WITHDRAWN half's lever: a daemon that cannot page still
		 * caps a page, ignores the requested `limit`, and has no cursor to give. The
		 * app then holds `N` rows of a larger catalogue with `truncated: true` - which
		 * is what makes an unexpanded group's chats unreachable and its sentence
		 * false.
		 */
		if (TRUNCATE > 0) {
			const capped = rows.slice(0, TRUNCATE);
			return ok({
				sessions: capped,
				truncated: capped.length < rows.length,
			});
		}
		/*
		 * The cursor is this file's own spelling (`off:<n>`), because the client treats
		 * it as opaque; an unrecognisable one is answered with the FIRST page and
		 * `cursor_missing`, which is the route's own rule for a token it cannot use.
		 */
		const offset = cursor === null ? 0 : Number(cursor.slice(3)) || 0;
		const page = rows.slice(offset, offset + limit);
		const more = offset + page.length < rows.length;
		return ok({
			sessions: page,
			truncated: more,
			...(PAGED
				? {
						next_cursor: more ? `off:${offset + page.length}` : null,
						cursor_missing: cursor !== null && !cursor.startsWith("off:"),
						...(kind ? { scope: { kind, name } } : {}),
						...(query.get("with_counts") === "true"
							? { counts: censusOf(served.filter((r) => include || !r.archived)) }
							: {}),
					}
				: {}),
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
		/*
		 * THE ROSTER THE SIDEBAR'S ENTITY REGION IS BUILT FROM. The paged catalogue's
		 * agents are real roster rows and not just a `binding` field: a `[data-entity]`
		 * row exists because `profiles.list` named it, so a fixture that bound its
		 * conversations to agents nobody lists would render no agent group at all.
		 * `source: "custom"` rather than `builtin`, which is what makes these the
		 * user's OWN agents (`ownAgents` partitions the builtin shelf away).
		 */
		return ok({
			profiles:
				CATALOGUE > 0
					? [
							{ name: "reviewer", source: "custom", description: "" },
							{ name: "qa-tester", source: "custom", description: "" },
						]
					: [],
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/teams") {
		return ok({
			teams:
				CATALOGUE > 0
					? [
							{ name: "lopdev", description: "" },
							{ name: "minervadev", description: "" },
						]
					: [],
		});
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

/*
 * THE LARGE CATALOGUE: `--catalogue=<n>` conversations spread across two teams,
 * two agents and the unbound population.
 *
 * WHY THE SHAPE IS WHAT IT IS. The paging claims need a group whose chats sit PAST
 * the head page (`HEAD_PAGE = 50`): a group of 70 does, so an app that reads
 * fifty rows and stops draws a group it cannot fill, which is exactly the state
 * the operator photographed. The 20-chat group is the one a SMALL page still
 * carries, so a frame can show a group that is genuinely page-complete. The
 * unbound rows exist so the flat list has a tail of its own to extend.
 *
 * The ids are deterministic (`p<index>`) rather than random, so two runs of this
 * rig produce comparable frames and a re-capture is a diff-free operation.
 */
const pagedCatalogue = () => {
	const rows = [];
	const add = (index, binding, over = {}) => {
		rows.push({
			id: `p${String(index).padStart(3, "0")}`,
			name: `Chat ${String(index).padStart(3, "0")}`,
			mtime: 1_700_000_000 - index,
			preview: null,
			archived: false,
			pinned: false,
			active: false,
			live_state: "idle",
			pending: null,
			status: { code: "recent", label: "Recent" },
			binding,
			...over,
		});
	};
	/*
	 * THE ORDER OF THIS ARRAY IS THE ORDER THE PANEL SEES, and it is chosen for one
	 * reason: the FIRST FIFTY rows must be every conversation that is NOT in the
	 * team under test. The stand-in slices in array order, so that is what makes the
	 * head page and the group's own page DISJOINT - which is what the operator's own
	 * store looks like (434 chats in one team, 283 rendered) and what makes
	 * "expanding the group fetched something" a number rather than an impression.
	 */
	let index = 0;
	// 50 conversations belonging to somebody else: the unbound tail, a second team,
	// and two agents. ONE is running, so `Active chats` has a row rather than a
	// sentence; ONE is pinned, so the pinned section is photographed too.
	for (let i = 0; i < 15; i += 1) {
		add(index, { agent: null, team: null }, {
			...(i === 0 ? { active: true, live_state: "busy" } : {}),
			...(i === 1 ? { pinned: true } : {}),
		});
		index += 1;
	}
	for (let i = 0; i < 20; i += 1) add(index++, { agent: null, team: "minervadev" });
	for (let i = 0; i < 8; i += 1) add(index++, { agent: "reviewer", team: null });
	for (let i = 0; i < 7; i += 1) add(index++, { agent: "qa-tester", team: null });
	// The 70 the page cannot carry: past every one of the fifty above.
	for (let i = 0; i < 70; i += 1) add(index++, { agent: null, team: "lopdev" });
	return rows;
};
/** The rows this process serves: the six-conversation fixture, or the large one. */
const served = CATALOGUE > 0 ? pagedCatalogue() : conversations;

/**
 * The per-scope census the paged route reports under `with_counts`.
 *
 * Built from the fixture rather than written down, so the badge and the rows can
 * never disagree in this rig: a hand-written total would let a frame show a group
 * whose badge says 70 over a page that carries 25 of an invented 40.
 */
const censusOf = (rows) => {
	const counts = new Map();
	let active = 0;
	let unbound = 0;
	for (const row of rows) {
		if (row.active) active += 1;
		const team = row.binding?.team ?? "";
		const agent = row.binding?.agent ?? "";
		if (!team && !agent) {
			unbound += 1;
			continue;
		}
		const kind = team ? "team" : "agent";
		const name = team || agent;
		const key = `${kind}:${name}`;
		const at = counts.get(key) ?? { kind, name, total: 0, active: 0 };
		at.total += 1;
		if (row.active) at.active += 1;
		counts.set(key, at);
	}
	return {
		total: rows.length,
		active,
		unbound,
		scopes: [...counts.values()].sort(
			(a, b) => b.total - a.total || a.kind.localeCompare(b.kind),
		),
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
