#!/usr/bin/env node
/**
 * Synthetic config-root templates for the Mac proof harness
 * (`scripts/mac-proof-capture.mjs --seed <scenario>`).
 *
 * WHY THIS EXISTS. The harness photographs the real app on an ISOLATED `lop
 * serve` whose config root starts empty, so a scene like "the asks drawer with a
 * suggested command" (#1902) or "a notification's details page" (#1907) would
 * photograph an empty state. Neither state can be produced through a read-only
 * API call either: the harness never prompts or engages (its HTTP allowlist
 * refuses it), core has no create route for notifications, and an ask only exists
 * once a runtime queued one. So the state is WRITTEN, as files, in exactly the
 * shapes core itself writes, just before `lop serve` starts on them.
 *
 * WHY GENERATED PER RUN, NOT COMMITTED. An ask is `open` only while
 * `now < expires_at` (core asks/store.py:730-735), so a frozen snapshot would go
 * stale within a day. The declarative CONTENT is committed
 * (`docs/evidence/mac-proof/seeds/<scenario>/seed.json`); the bytes with
 * timestamps are generated into a scratch directory and never committed.
 *
 * WHY THE DERIVED FILES TOO. `lop serve` never rebuilds the asks index at
 * startup - only a live writer does (core asks/queue.py `_publish` and
 * asks/dismiss.py) - and `GET /v1/desktop/asks` reads ONLY the index
 * (core server/routes/desktop_sessions.py:5213-5239). Without `asks/<sid>.json`
 * there is no ask on screen. Both the log row and the index row are built from
 * ONE record by ONE function (`pendingRow`), so they cannot disagree if a
 * runtime later re-derives the index from the log.
 *
 * KEEPING IN STEP WITH CORE. Every constant below cites the core file:line it
 * copies, at tag v0.105.3 (b85e47c, the runtime the Mac and this host install).
 * Checked against origin/main e4a6b6e on 2026-11-16: the notifications `_SCHEMA`
 * is byte-identical (same lines); asks/queue.py's `_question_shape` /
 * `_carried_command` moved +78 lines (3097 -> 3175, 3162 -> 3240) with the
 * shape unchanged; asks/store.py, asks/policy.py and harness/types.py did not
 * change. `mac-proof-seed.test.mjs` compares the DDL with core's `_SCHEMA` when a
 * core checkout is present, and the harness BLOCKS a run whose seeded rows do
 * not come back from the real daemon, so drift is caught at the run, not on a
 * frame of an empty state.
 *
 * Node built-ins only (the Mac runs it from any checkout with no install).
 * `node:sqlite` is needed only for `notification-details` and ships unflagged
 * from Node 22.13 (the repo's .nvmrc pins 22.13.1); an older Node is refused
 * with that sentence rather than a stack trace.
 *
 * Usage:
 *   node scripts/mac-proof-seed.mjs --scenario ask-command|notification-details \
 *     --out <abs empty dir> [--now <epoch ms>]
 */

import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The scenarios, each with its committed spec under docs/evidence/mac-proof/seeds/. */
export const SEED_SCENARIOS = Object.freeze([
	"ask-command",
	"notification-details",
]);

export class SeedError extends Error {}

/* ------------------------------------------------------------ core constants */

/** core session/transcript.py:104 ENTRY_MESSAGE. */
const ENTRY_MESSAGE = "message";
/** core resume.py:383 TITLE_SIDECAR_NAME. */
const TITLE_SIDECAR = "title.json";
/** core session/creation.py:16 CREATED_AT_NAME (a bare epoch-seconds number, :19-31). */
const CREATED_AT = "created_at.json";
/** core network/carry.py:87 DESKTOP_MARKER_NAME; payload server/utils/desktop_sessions.py:840. */
const DESKTOP_MARKER = "desktop.json";
/** core asks/store.py:54 ASKS_LOG_NAME, :59 ASKS_DIRNAME, :63 SESSIONS_DIRNAME. */
const ASKS_LOG = "asks.jsonl";
const ASKS_DIR = "asks";
const SESSIONS_DIR = "sessions";
/** core asks/store.py:68 INDEX_SCHEMA, :71 EVENT_SCHEMA, :73 EVENT_QUEUED, :153 STATUS_OPEN. */
const INDEX_SCHEMA = 1;
const EVENT_SCHEMA = 1;
const EVENT_QUEUED = "queued";
const STATUS_OPEN = "open";
/** core asks/policy.py:143 MIN_TIMEOUT_S, :146 MAX_TIMEOUT_S, :153 URGENT_MAX_S (is_urgent :251-253). */
export const MIN_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 86400;
const URGENT_MAX_S = 900;
/** core asks/store.py:240-253 new_ask_id: `a-` + 4 hex. */
const ASK_ID = /^a-[0-9a-f]{4}$/;
/** core harness/types.py:1989 ASK_COMMAND_MAX_CHARS. */
export const ASK_COMMAND_MAX_CHARS = 500;
/** A conversation id, as every desktop route takes it. */
const SESSION_ID = /^[a-f0-9]{12}$/;

/** core notifications/store.py:60 NOTIFICATIONS_DB_NAME, :64 SCHEMA_VERSION. */
export const NOTIFICATIONS_DB = "notifications.db";
export const SCHEMA_VERSION = 3;
/** core notifications/store.py:114-120 and :128. */
const TITLE_MAX = 120;
const BODY_MAX = 4000;
const LINKS_MAX = 5;
const LINK_LABEL_MAX = 80;
const LINK_URL_MAX = 500;
const KEY_MAX = 120;
const EXCERPT_MAX = 160;
const HISTORY_CAP = 20;
/** core notifications/store.py:79-84 PRIORITIES. */
const PRIORITIES = ["high", "normal", "low"];
/** core notifications/store.py:103 READ_VIA (the explicit read a person makes). */
const READ_VIA_EXPLICIT = "explicit";
/** core server/routes/desktop_notifications.py:69, the notify-row half of _ITEM_ID_PATTERN. */
export const NOTIFICATION_ID = /^n_[a-z2-7]{16}$/;
/**
 * Keys the one-time remote cleanup marks read (core notifications/store.py:353
 * CLEANUP_VIA and the remote_attention namespaces): a seeded unread row under one
 * of these would flip to read on the first write and the frame would lie.
 */
const RESERVED_KEY_PREFIXES = ["remote-done:", "remote-notice:"];

/**
 * core notifications/store.py:368-465 `_SCHEMA`, VERBATIM (whitespace included,
 * so the test can compare it with core's text statement by statement). The
 * file must be what core's own `_connect_once` (:577-605) would have created:
 * readers open it read-only and never create it (:816-831).
 */
export const NOTIFICATIONS_SCHEMA = Object.freeze([
	`
    CREATE TABLE IF NOT EXISTS items (
      id            TEXT PRIMARY KEY,
      seq           INTEGER NOT NULL UNIQUE,
      session_id    TEXT NOT NULL,
      session_title TEXT NOT NULL DEFAULT '',
      agent_id      TEXT NOT NULL DEFAULT '',
      team_id       TEXT NOT NULL DEFAULT '',
      priority      TEXT NOT NULL CHECK (priority IN ('high','normal','low')),
      title         TEXT NOT NULL,
      body_md       TEXT NOT NULL DEFAULT '',
      links_json    TEXT NOT NULL DEFAULT '[]',
      key           TEXT NOT NULL DEFAULT '',
      content_hash  TEXT NOT NULL,
      revision      INTEGER NOT NULL DEFAULT 1,
      repeat_count  INTEGER NOT NULL DEFAULT 1,
      anchor_id     TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      read_rev      INTEGER NOT NULL DEFAULT 0,
      read_at       INTEGER,
      read_via      TEXT,
      read_surface  TEXT,
      dismissed_at  INTEGER,
      dismissed_via TEXT,
      delivered_rev INTEGER NOT NULL DEFAULT 0,
      delivered_by  TEXT,
      delivered_at  INTEGER
    )
    `,
	"CREATE UNIQUE INDEX IF NOT EXISTS items_key ON items(session_id, key) WHERE key <> ''",
	"CREATE INDEX IF NOT EXISTS items_list ON items(dismissed_at, updated_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS items_session ON items(session_id, updated_at DESC)",
	`
    CREATE TABLE IF NOT EXISTS item_history (
      item_id  TEXT NOT NULL,
      revision INTEGER NOT NULL,
      at       INTEGER NOT NULL,
      title    TEXT NOT NULL,
      excerpt  TEXT NOT NULL,
      PRIMARY KEY (item_id, revision)
    )
    `,
	`
    CREATE TABLE IF NOT EXISTS ref_state (
      ref     TEXT PRIMARY KEY,
      read_at INTEGER,
      seq     INTEGER NOT NULL
    )
    `,
	"CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
	`
    CREATE TABLE IF NOT EXISTS bulk_tokens (
      token TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      filters_json TEXT,
      through_seq INTEGER NOT NULL,
      eligible_count INTEGER NOT NULL,
      skipped_ask_count INTEGER NOT NULL,
      op TEXT,
      result_json TEXT,
      request_json TEXT,
      undo_json TEXT
    )
    `,
	`
    CREATE TABLE IF NOT EXISTS bulk_rows (
      token TEXT NOT NULL,
      item_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      post_seq INTEGER NOT NULL,
      before_json TEXT NOT NULL,
      PRIMARY KEY (token, item_id)
    )
    `,
	"CREATE INDEX IF NOT EXISTS bulk_tokens_expiry ON bulk_tokens(expires_at)",
	`
    CREATE TABLE IF NOT EXISTS bulk_ask_refs (
      token TEXT NOT NULL,
      ref TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      expected_seq INTEGER NOT NULL DEFAULT 0,
      read_at INTEGER,
      post_seq INTEGER,
      PRIMARY KEY (token, ref)
    )
    `,
]);

/* ------------------------------------------------------------ pure rules */

/**
 * core harness/types.py:2009-2033 `ask_command_problem`, applied to the spec's
 * command. Core re-applies it in `_carried_command` (asks/queue.py:3162) and
 * DROPS a failing command silently, so a seed that broke the rule would render
 * an ask with no command - the very thing #1902's frame exists to show. Here it
 * refuses instead. Core strips first; a seed must already be stripped.
 * Categories: Cc/Cf/Zl/Zp refused (:1998); Zs only as U+0020 (:2006).
 */
export function askCommandProblem(command) {
	if (typeof command !== "string" || command.length === 0)
		return "command is empty; omit it instead";
	if (command !== command.trim())
		return "command has leading or trailing whitespace (core strips it; the seed must not rely on that)";
	// Python's len counts code points, not UTF-16 units.
	if ([...command].length > ASK_COMMAND_MAX_CHARS)
		return `command is longer than ${ASK_COMMAND_MAX_CHARS} characters`;
	for (const char of command) {
		if (
			/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(char) ||
			(/\p{Zs}/u.test(char) && char !== " ")
		)
			return `command must be one plain line: U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} is not allowed`;
	}
	return null;
}

/** core notifications/store.py:220-222 `content_hash`. */
export function contentHash(title, bodyMd, linksJson, priority) {
	return createHash("sha256")
		.update([title, bodyMd, linksJson, priority].join("\x1f"), "utf8")
		.digest("hex");
}

/** core notifications/store.py:210-213 `excerpt`: whitespace collapsed, capped with an ellipsis. */
export function excerpt(text, limit = EXCERPT_MAX) {
	const flat = String(text ?? "")
		.split(/\s+/)
		.filter(Boolean)
		.join(" ");
	const chars = [...flat];
	return chars.length <= limit
		? flat
		: `${chars
				.slice(0, limit - 1)
				.join("")
				.trimEnd()}\u2026`;
}

/**
 * One question as core's log stores it: asks/queue.py:3097-3159
 * `_question_shape` (key order kept), `command`/`command_target` added only
 * with a command (:3147-3158). Options are AskOption dumps, types.py:1935-1941.
 */
function questionShape(q) {
	const shape = {
		id: q.id,
		question: q.question,
		options: (q.options ?? []).map((o) => ({
			label: o.label,
			description: o.description ?? "",
		})),
		multi: Boolean(q.multi),
		recommended: q.recommended ?? null,
		secret: false,
		persist: false,
		human_required: false,
		question_id: "",
	};
	if (q.command !== undefined) {
		shape.command = q.command;
		shape.command_target = q.commandTarget === "user" ? "user" : "agent";
	}
	return shape;
}

/**
 * The folded ask record both files come from: asks/queue.py:436-447 builds it
 * at queue time (`expires_at = now + timeout_s * 1000`, `urgent =
 * policy.is_urgent(timeout_s)`); the fold adds `status` (asks/store.py:730-735)
 * and the sticky `delivered`.
 */
export function askRecord(ask, now) {
	return {
		ask_id: ask.askId,
		created_at: now,
		expires_at: now + ask.timeoutS * 1000,
		timeout_s: ask.timeoutS,
		urgent: ask.timeoutS <= URGENT_MAX_S,
		tool_call_id: ask.toolCallId,
		questions: ask.questions.map(questionShape),
		status: STATUS_OPEN,
		delivered: false,
	};
}

/**
 * core asks/store.py:1091-1196 `pending_row`, for an open ask with no answers,
 * attachments, relay, context or draft (none of those keys is emitted then:
 * each is ADDED only when present, :1124-1195).
 */
export function pendingRow(record) {
	return {
		ask_id: String(record.ask_id ?? ""),
		created_at: Math.trunc(record.created_at ?? 0),
		expires_at: Math.trunc(record.expires_at ?? 0),
		timeout_s: Math.trunc(record.timeout_s ?? 0),
		urgent: Boolean(record.urgent),
		status: String(record.status ?? STATUS_OPEN),
		delivered: Boolean(record.delivered),
		questions: (record.questions ?? []).map((q) => ({ ...q })),
	};
}

/** `JSON.stringify` with keys sorted, the form core's index writer uses (store.py:1479 sort_keys=True). */
function sortedJson(value) {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, v[k]]),
				)
			: v,
	);
}

/** A stable 32-hex transcript entry id (core uses uuid4().hex, transcript.py:3075). */
function entryId(scenario, n) {
	return createHash("sha256")
		.update(`mac-proof:${scenario}:${n}`)
		.digest("hex")
		.slice(0, 32);
}

/* ------------------------------------------------------------ the spec */

export function seedSpecPath(scenario, root = join(HERE, "..")) {
	return join(
		root,
		"docs",
		"evidence",
		"mac-proof",
		"seeds",
		scenario,
		"seed.json",
	);
}

/** Read and validate a scenario's committed spec. Throws `SeedError` naming the field. */
export function loadSeedSpec(scenario, { path = seedSpecPath(scenario) } = {}) {
	if (!SEED_SCENARIOS.includes(scenario))
		throw new SeedError(
			`unknown seed scenario ${scenario} (have: ${SEED_SCENARIOS.join(", ")})`,
		);
	let spec;
	try {
		spec = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new SeedError(`cannot read seed spec ${path}: ${error.message}`);
	}
	const problem = specProblem(spec, scenario);
	if (problem) throw new SeedError(`${path}: ${problem}`);
	return spec;
}

/** Null when the spec is within core's rules; otherwise the first refusal. */
export function specProblem(spec, scenario) {
	if (spec?.scenario !== scenario)
		return `scenario is ${JSON.stringify(spec?.scenario)}, expected ${scenario}`;
	const s = spec.session;
	if (!s || !SESSION_ID.test(s.id ?? ""))
		return "session.id must be 12 lowercase hex characters";
	if (typeof s.title !== "string" || !s.title.trim())
		return "session.title is empty";
	if (typeof s.cwd !== "string" || !isAbsolute(s.cwd))
		return "session.cwd must be absolute";
	if (!Array.isArray(spec.transcript) || spec.transcript.length === 0)
		return "transcript is empty (core lists a session only with a non-empty transcript.jsonl)";
	for (const [i, m] of spec.transcript.entries())
		if (
			!["user", "assistant"].includes(m.role) ||
			typeof m.text !== "string" ||
			!m.text
		)
			return `transcript[${i}] needs role user|assistant and text`;
	if (scenario === "ask-command") {
		const a = spec.ask;
		if (!a) return "ask is missing";
		if (!ASK_ID.test(a.askId ?? ""))
			return "ask.askId must be a- + 4 hex (asks/store.py:240-253)";
		if (
			!Number.isInteger(a.timeoutS) ||
			a.timeoutS < MIN_TIMEOUT_S ||
			a.timeoutS > MAX_TIMEOUT_S
		)
			return `ask.timeoutS must be ${MIN_TIMEOUT_S}..${MAX_TIMEOUT_S} (asks/policy.py:143-146)`;
		if (typeof a.toolCallId !== "string" || !a.toolCallId)
			return "ask.toolCallId is empty";
		if (!Array.isArray(a.questions) || a.questions.length === 0)
			return "ask.questions is empty";
		const targets = new Set();
		const ids = new Set();
		for (const [i, q] of a.questions.entries()) {
			if (!q.id || ids.has(q.id))
				return `ask.questions[${i}].id is empty or repeated`;
			ids.add(q.id);
			if (!q.question) return `ask.questions[${i}].question is empty`;
			for (const o of q.options ?? [])
				if (!o.label) return `ask.questions[${i}] has an option with no label`;
			const why = askCommandProblem(q.command);
			if (why) return `ask.questions[${i}].command: ${why}`;
			if (!["agent", "user"].includes(q.commandTarget))
				return `ask.questions[${i}].commandTarget must be agent or user`;
			targets.add(q.commandTarget);
		}
		// The frame exists to show both device kinds (#1902): Run for the agent, Insert-only for the user.
		if (!(targets.has("agent") && targets.has("user")))
			return "ask needs one question with commandTarget agent and one with user";
	} else {
		if (!NOTIFICATION_ID.test(spec.detailId ?? ""))
			return "detailId must match ^n_[a-z2-7]{16}$";
		if (!Array.isArray(spec.notifications)) return "notifications is missing";
		const ids = new Set();
		for (const [i, n] of spec.notifications.entries()) {
			if (!NOTIFICATION_ID.test(n.id ?? "") || ids.has(n.id))
				return `notifications[${i}].id must match ^n_[a-z2-7]{16}$ and be unique (desktop_notifications.py:69)`;
			ids.add(n.id);
			if (!PRIORITIES.includes(n.priority))
				return `notifications[${i}].priority must be high|normal|low`;
			const title = String(n.title ?? "");
			if (
				!title ||
				title !== title.split(/\s+/).filter(Boolean).join(" ") ||
				[...title].length > TITLE_MAX
			)
				return `notifications[${i}].title must be one collapsed line of 1..${TITLE_MAX} characters (store.py:985-987)`;
			if ([...bodyOf(n)].length > BODY_MAX)
				return `notifications[${i}].body is over ${BODY_MAX} characters`;
			const links = n.links ?? [];
			if (links.length > LINKS_MAX)
				return `notifications[${i}] has more than ${LINKS_MAX} links`;
			for (const l of links)
				if (
					!/^https?:\/\//i.test(l.url ?? "") ||
					l.url.length > LINK_URL_MAX ||
					!l.label ||
					l.label.length > LINK_LABEL_MAX
				)
					return `notifications[${i}] has a link core's normalize_links would drop (store.py:225-242)`;
			const key = n.key ?? "";
			if (
				key.length > KEY_MAX ||
				RESERVED_KEY_PREFIXES.some((p) => key.startsWith(p))
			)
				return `notifications[${i}].key is too long or in a cleanup namespace`;
			const revision = n.revision ?? 1;
			const history = n.history ?? [];
			if (history.length > HISTORY_CAP)
				return `notifications[${i}] has more than ${HISTORY_CAP} history rows`;
			if (history.length > 0 && !key)
				return `notifications[${i}] has history but no key (revisions exist only under a key)`;
			for (const h of history)
				if (
					!Number.isInteger(h.revision) ||
					h.revision < 1 ||
					h.revision >= revision
				)
					return `notifications[${i}] history revisions must be 1..revision-1`;
		}
		if (!ids.has(spec.detailId)) return "detailId names no notification";
	}
	return null;
}

function bodyOf(n) {
	return Array.isArray(n.body) ? n.body.join("\n\n") : String(n.body ?? "");
}

/**
 * What the harness must read back from the REAL daemon before any frame, so an
 * empty-state frame can never pass as proof (`seedRowsProblem`).
 */
export function seedExpectations(spec) {
	if (spec.scenario === "ask-command")
		return {
			scenario: spec.scenario,
			path: "/v1/desktop/asks",
			sessionId: spec.session.id,
			askId: spec.ask.askId,
			commands: spec.ask.questions.map((q) => ({
				id: q.id,
				command: q.command,
				command_target: q.commandTarget,
			})),
		};
	const detail = spec.notifications.find((n) => n.id === spec.detailId);
	return {
		scenario: spec.scenario,
		path: `/v1/desktop/notifications/${spec.detailId}`,
		sessionId: spec.session.id,
		notificationId: spec.detailId,
		historyRevisions: (detail.history ?? [])
			.map((h) => h.revision)
			.sort((a, b) => a - b),
		/*
		 * The read state of every seeded item, recorded in the receipt. The
		 * detail scenes photograph a read face that was SEEDED, not driven: an
		 * unfocused window's `notifications.read` is refused by main's
		 * foreground guard (ui desktop-ipc.ts:95-101, :166-185 at v0.59.2), so
		 * the receipt has to say which state each item started in. A reader can
		 * then tell the seeded face from one the app produced.
		 */
		detailRead: detail.read === true,
		items: spec.notifications.map((n) => ({ id: n.id, read: n.read === true })),
	};
}

/**
 * Null when the daemon's answer (`{status, message, result}`, core `reply`)
 * carries the seeded rows; otherwise what is missing. Shapes: `GET
 * /v1/desktop/asks` -> `result.asks[]` rows (asks/store.py:1316-1355, each
 * `pending_row` + `session_id`/`cwd`); `GET /v1/desktop/notifications/{id}` ->
 * `result.item` + `result.history` (notifications/items.py:749-756).
 */
export function seedRowsProblem(expect, body) {
	const result = body?.result;
	if (!result)
		return `${expect.path} answered no result (non-2xx or unreachable)`;
	if (expect.scenario === "ask-command") {
		const row = (result.asks ?? []).find(
			(a) => a.session_id === expect.sessionId && a.ask_id === expect.askId,
		);
		if (!row)
			return `${expect.path} does not list ask ${expect.askId} of session ${expect.sessionId}`;
		if (row.status !== STATUS_OPEN)
			return `ask ${expect.askId} is ${row.status}, not open`;
		for (const want of expect.commands) {
			const q = (row.questions ?? []).find((x) => x.id === want.id);
			if (
				!q ||
				q.command !== want.command ||
				q.command_target !== want.command_target
			)
				return `ask ${expect.askId} question ${want.id} came back without command/command_target ${want.command_target}`;
		}
		return null;
	}
	if (result.item?.id !== expect.notificationId)
		return `${expect.path} did not return item ${expect.notificationId}`;
	const got = (result.history ?? [])
		.map((h) => h.revision)
		.sort((a, b) => a - b);
	if (JSON.stringify(got) !== JSON.stringify(expect.historyRevisions))
		return `${expect.notificationId} history revisions ${JSON.stringify(got)}, expected ${JSON.stringify(expect.historyRevisions)}`;
	// The seeded read face has to be the daemon's answer (core
	// notifications/items.py serializes `read`), or the frame would depict a
	// state that only the seed file claims.
	if (
		typeof expect.detailRead === "boolean" &&
		result.item.read !== expect.detailRead
	)
		return `${expect.notificationId} came back read=${JSON.stringify(result.item.read)}, seeded read=${expect.detailRead}`;
	return null;
}

/* ------------------------------------------------------------ writers */

function writeSession(out, spec, now) {
	const dir = join(out, SESSIONS_DIR, spec.session.id);
	mkdirSync(dir, { recursive: true });
	const createdS =
		Math.floor(now / 1000) - (spec.session.createdMinutesAgo ?? 30) * 60;
	const rows = [];
	let n = 0;
	const step = Math.max(
		1,
		Math.floor(
			((spec.session.createdMinutesAgo ?? 30) * 60) /
				(spec.transcript.length + 2),
		),
	);
	let ts = createdS;
	for (const m of spec.transcript) {
		ts += step;
		// core harness/types.py:1141-1167 Message (extra="forbid": only these keys).
		const payload = { role: m.role, content: [{ type: "text", text: m.text }] };
		if (m.askCall && spec.ask)
			payload.tool_calls = [
				{
					// core harness/types.py:685-693 ToolCall.
					id: spec.ask.toolCallId,
					name: "ask",
					arguments: {
						questions: spec.ask.questions.map((q) => {
							const { commandTarget, ...rest } = q;
							return { ...rest, command_target: commandTarget };
						}),
					},
				},
			];
		rows.push({
			id: entryId(spec.scenario, n++),
			ts,
			type: ENTRY_MESSAGE,
			payload,
		});
		if (m.askCall && spec.ask) {
			ts += 1;
			rows.push({
				id: entryId(spec.scenario, n++),
				ts,
				type: ENTRY_MESSAGE,
				payload: {
					role: "tool",
					content: [
						{
							type: "text",
							text: `Queued ask ${spec.ask.askId}; the answer arrives as its own turn.`,
						},
					],
					tool_call_id: spec.ask.toolCallId,
					tool_name: "ask",
				},
			});
		}
	}
	// core session/transcript.py:494-498 TranscriptEntry.to_json, one per line.
	writeFileSync(
		join(dir, "transcript.jsonl"),
		`${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
	);
	// core resume.py:881 write_session_title payload.
	writeFileSync(
		join(dir, TITLE_SIDECAR),
		JSON.stringify({
			text: spec.session.title,
			user_set: true,
			names: [spec.session.title],
		}),
	);
	writeFileSync(join(dir, CREATED_AT), JSON.stringify(createdS));
	writeFileSync(
		join(dir, DESKTOP_MARKER),
		JSON.stringify({ version: 1, cwd: spec.session.cwd }),
	);
	return dir;
}

function writeAsk(out, spec, sessionDir, now) {
	const record = askRecord(spec.ask, now);
	const { status: _s, delivered: _d, ...queued } = record;
	// core asks/queue.py:447: {"v", "kind", "at", **record} (status/delivered are the fold's).
	const event = { v: EVENT_SCHEMA, kind: EVENT_QUEUED, at: now, ...queued };
	writeFileSync(join(sessionDir, ASKS_LOG), `${JSON.stringify(event)}\n`);
	// core asks/store.py:1467-1473 write_entry.
	const entry = {
		schema: INDEX_SCHEMA,
		session_id: spec.session.id,
		cwd: spec.session.cwd,
		updated_at: now,
		asks: [pendingRow(record)],
	};
	mkdirSync(join(out, ASKS_DIR), { recursive: true });
	writeFileSync(
		join(out, ASKS_DIR, `${spec.session.id}.json`),
		sortedJson(entry),
	);
	return { record, entry };
}

/** The message Node's `emitExperimentalWarning("SQLite")` starts with. */
const SQLITE_EXPERIMENTAL = /^SQLite is an experimental feature/;

/**
 * Run `fn` with Node's ONE "SQLite is an experimental feature" warning dropped
 * (QA r1 Q1-2). Node 22 emits it through `process.emitWarning(msg,
 * "ExperimentalWarning")` the first time `node:sqlite` loads, and it landed on
 * the harness's stderr as noise. Only that warning: any other warning, and any
 * other ExperimentalWarning, still reaches `process.emitWarning` unchanged, and
 * the original is restored when `fn` settles. Never `--no-warnings`.
 */
export async function withoutSqliteExperimentalWarning(fn) {
	const original = process.emitWarning;
	process.emitWarning = function emitWarning(warning, ...rest) {
		const type =
			typeof rest[0] === "string" ? rest[0] : (rest[0]?.type ?? warning?.name);
		const text = typeof warning === "string" ? warning : warning?.message;
		if (type === "ExperimentalWarning" && SQLITE_EXPERIMENTAL.test(text ?? ""))
			return;
		return original.call(process, warning, ...rest);
	};
	try {
		return await fn();
	} finally {
		process.emitWarning = original;
	}
}

/** `node:sqlite`, or a SeedError naming the Node it needs. */
export async function loadSqlite() {
	try {
		return await withoutSqliteExperimentalWarning(() => import("node:sqlite"));
	} catch (error) {
		throw new SeedError(
			`the notification-details seed needs node:sqlite (Node >= 22.13, as .nvmrc pins); this is Node ${process.versions.node} (${error.code ?? error.message})`,
		);
	}
}

async function writeNotifications(out, spec, now) {
	const { DatabaseSync } = await loadSqlite();
	const path = join(out, NOTIFICATIONS_DB);
	// core notifications/store.py:580-583: private before SQLite writes anything.
	writeFileSync(path, "", { mode: 0o600 });
	const db = new DatabaseSync(path);
	try {
		// DELETE, not WAL: the template is copied file by file into the rig, and
		// a -wal/-shm pair left beside it would be either lost or stale. Core
		// adopts WAL itself the first time it opens the file for a write.
		db.exec("PRAGMA journal_mode=DELETE");
		db.exec("BEGIN IMMEDIATE");
		for (const statement of NOTIFICATIONS_SCHEMA) db.exec(statement);
		const insert = db.prepare(
			// The column list of core's create path (store.py:1019-1023) plus
			// revision/repeat_count, which a revised item carries (:1083-1086).
			"INSERT INTO items (id, seq, session_id, session_title, agent_id, team_id, " +
				"priority, title, body_md, links_json, key, content_hash, revision, " +
				"repeat_count, anchor_id, created_at, updated_at, read_rev, read_at, read_via) " +
				"VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)",
		);
		const history = db.prepare(
			"INSERT INTO item_history (item_id, revision, at, title, excerpt) VALUES (?, ?, ?, ?, ?)",
		);
		// Oldest first, so `seq` (store.py:889-898) grows with time as core's would.
		const items = [...spec.notifications].sort(
			(a, b) => (b.minutesAgo ?? 0) - (a.minutesAgo ?? 0),
		);
		let seq = 1;
		for (const n of items) {
			const updated = now - (n.minutesAgo ?? 0) * 60_000;
			const hist = [...(n.history ?? [])].sort(
				(a, b) => a.revision - b.revision,
			);
			const created = hist.length
				? now - (hist[0].minutesAgo ?? 0) * 60_000
				: updated;
			const body = bodyOf(n);
			// store.py:990: compact separators, ensure_ascii=False - JSON.stringify's form.
			const linksJson = JSON.stringify(
				(n.links ?? []).map((l) => ({ label: l.label, url: l.url })),
			);
			const revision = n.revision ?? 1;
			insert.run(
				n.id,
				seq++,
				spec.session.id,
				spec.session.title,
				n.priority,
				n.title,
				body,
				linksJson,
				n.key ?? "",
				contentHash(n.title, body, linksJson, n.priority),
				revision,
				revision,
				created,
				updated,
				n.read ? revision : 0,
				n.read ? updated : null,
				n.read ? READ_VIA_EXPLICIT : null,
			);
			// store.py:1065-1075: an earlier revision's title and excerpt, at its own updated_at.
			for (const h of hist)
				history.run(
					n.id,
					h.revision,
					now - (h.minutesAgo ?? 0) * 60_000,
					h.title,
					excerpt(h.body),
				);
		}
		// store.py:596 seeds next_seq; :889-898 keeps it one past the last stamp.
		db.prepare("INSERT INTO meta(k, v) VALUES ('next_seq', ?)").run(
			String(seq),
		);
		db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
		db.exec("COMMIT");
	} finally {
		db.close();
	}
	chmodSync(path, 0o600);
	return path;
}

/**
 * Generate `scenario` into `out` (absolute; absent or empty). Answers what was
 * written and the expectations the harness checks against the daemon.
 */
export async function generateSeed({
	scenario,
	out,
	now = Date.now(),
	specPath,
} = {}) {
	if (!out || !isAbsolute(out))
		throw new SeedError(`--out must be an absolute directory (got ${out})`);
	if (!Number.isSafeInteger(now) || now <= 0)
		throw new SeedError(`--now must be epoch milliseconds (got ${now})`);
	const spec = loadSeedSpec(
		scenario,
		specPath ? { path: specPath } : undefined,
	);
	if (existsSync(out) && readdirSync(out).length > 0)
		throw new SeedError(
			`--out ${out} is not empty; the seed never writes over existing files`,
		);
	mkdirSync(out, { recursive: true });
	const sessionDir = writeSession(out, spec, now);
	if (scenario === "ask-command") writeAsk(out, spec, sessionDir, now);
	else await writeNotifications(out, spec, now);
	const files = listFiles(out);
	return {
		scenario,
		out,
		now,
		sessionId: spec.session.id,
		files,
		expect: seedExpectations(spec),
	};
}

function listFiles(root, rel = "") {
	const out = [];
	for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
		const path = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...listFiles(root, path));
		else out.push(path);
	}
	return out.sort();
}

/**
 * The standalone CLI's `--out` must never be the operator's own config root
 * (review r1 R1-4): `generateSeed` refuses only a relative or non-empty dir, so
 * `--out ~/.local-operator` on a machine where it is absent or empty would
 * write a synthetic session and ask index into the real daemon's root. The
 * harness path never hits this (it writes `<rig>/seed`, already checked).
 *
 * Roots: the harness's own `operatorRoots()` (`~/.local-operator` and the
 * app's userData dirs, for both the account home and $HOME) plus this
 * process's `LOCAL_OPERATOR_CONFIG_DIR` when set - the root a `lop` started
 * from this shell would use. Compared as realpaths by `operatorPathProblem`, so
 * a symlink into a root is refused too, as is a dir that CONTAINS a root.
 * Its one carve-out is kept: an agent scratchpad under
 * `~/.local-operator/sessions/<id>/scratchpad` (where the repo's scratch rule
 * puts rigs and seeds), which the daemon never reads as a session.
 *
 * Imported lazily: mac-proof-capture.mjs imports this module, and a static
 * import back would make the two a load-order cycle.
 */
export async function seedOutProblem(out, env = process.env) {
	if (!out || !isAbsolute(out)) return null; // generateSeed names this one
	const { operatorRoots, operatorPathProblem } = await import(
		"./mac-proof-capture.mjs"
	);
	const roots = operatorRoots();
	if (
		env.LOCAL_OPERATOR_CONFIG_DIR &&
		isAbsolute(env.LOCAL_OPERATOR_CONFIG_DIR)
	)
		roots.push(env.LOCAL_OPERATOR_CONFIG_DIR);
	return operatorPathProblem("--out", out, roots);
}

export const SEED_USAGE = `node scripts/mac-proof-seed.mjs --scenario <${SEED_SCENARIOS.join("|")}> --out <abs empty dir> [--now <epoch ms>]`;

export async function main(argv = process.argv.slice(2)) {
	const opts = { scenario: null, out: null, now: Date.now() };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = () => {
			const v = argv[++i];
			if (v === undefined || v.startsWith("--"))
				throw new SeedError(`${flag} needs a value`);
			return v;
		};
		try {
			if (flag === "--scenario") opts.scenario = value();
			else if (flag === "--out") opts.out = value();
			else if (flag === "--now") opts.now = Number(value());
			else if (flag === "--help" || flag === "-h") {
				console.log(SEED_USAGE);
				return 0;
			} else throw new SeedError(`unknown argument ${flag}`);
		} catch (error) {
			console.error(
				`[mac-proof-seed] refused: ${error.message}\n${SEED_USAGE}`,
			);
			return 2;
		}
	}
	try {
		const problem = await seedOutProblem(opts.out);
		if (problem) throw new SeedError(problem);
		const result = await generateSeed(opts);
		console.log(JSON.stringify(result, null, 2));
		return 0;
	} catch (error) {
		if (!(error instanceof SeedError)) throw error;
		console.error(`[mac-proof-seed] refused: ${error.message}`);
		return 2;
	}
}

if (isEntryPoint(import.meta.url)) {
	main().then((code) => process.exit(code));
}
