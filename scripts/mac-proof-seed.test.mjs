import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	ASK_COMMAND_MAX_CHARS,
	NOTIFICATIONS_SCHEMA,
	SCHEMA_VERSION,
	SEED_SCENARIOS,
	SeedError,
	askCommandProblem,
	askRecord,
	contentHash,
	excerpt,
	generateSeed,
	loadSeedSpec,
	main,
	pendingRow,
	seedRowsProblem,
	specProblem,
} from "./mac-proof-seed.mjs";

/**
 * Contract tests for `scripts/mac-proof-seed.mjs`, the synthetic config-root
 * generator behind `mac-proof-capture.mjs --seed`. What is proven here:
 *
 *   - the generated tree is exactly the files core reads, with the ask log row
 *     and the derived index row coming from ONE record;
 *   - core's `ask_command_problem` rules are enforced (refused, never dropped);
 *   - `notifications.db` carries core's `_SCHEMA` verbatim, `user_version` 3,
 *     DELETE journal mode and no sidecars, and its rows hash like core's;
 *   - when a core checkout is present (`~/local-operator`, or
 *     `LOCAL_OPERATOR_CORE_REPO`), the DDL and the shared constants are compared
 *     with core's own source at tag v0.105.3 and origin/main, read through
 *     `git show` (that checkout's working tree may be on any branch).
 *
 * That the REAL `lop serve` reads these files back is proven on the real path
 * (PR evidence) and at every capture (the harness BLOCKS otherwise).
 */

const TREE = mkdtempSync(join(os.tmpdir(), "mac-proof-seed-test-"));
after(() => rmSync(TREE, { recursive: true, force: true }));

const NOW = 1_763_300_000_000;
const HAVE_SQLITE = await import("node:sqlite").then(
	() => true,
	() => false,
);

test("every scenario's committed spec passes its own validation", () => {
	assert.deepEqual([...SEED_SCENARIOS].sort(), [
		"ask-command",
		"notification-details",
	]);
	for (const scenario of SEED_SCENARIOS) {
		const spec = loadSeedSpec(scenario);
		assert.equal(spec.scenario, scenario);
		assert.equal(specProblem(spec, scenario), null);
	}
});

test("ask_command_problem: core's rules, refused rather than silently dropped", () => {
	assert.equal(askCommandProblem("git status --short --branch"), null);
	assert.equal(askCommandProblem("a".repeat(ASK_COMMAND_MAX_CHARS)), null);
	// Code points, as Python's len counts them: 500 astral characters pass.
	assert.equal(
		askCommandProblem("\u{1F600}".repeat(ASK_COMMAND_MAX_CHARS)),
		null,
	);
	for (const [command, pattern] of [
		["", /empty/],
		["a".repeat(ASK_COMMAND_MAX_CHARS + 1), /longer than 500/],
		["git\tstatus", /U\+0009/],
		["echo hi\nrm -rf x", /U\+000A/],
		["git\u00a0status", /U\+00A0/],
		["git\u200bstatus", /U\+200B/],
		["git\u2028status", /U\+2028/],
		["git\u2029status", /U\+2029/],
		[" git status", /whitespace/],
	])
		assert.match(
			askCommandProblem(command) ?? "",
			pattern,
			JSON.stringify(command),
		);
});

test("ask-command: the session files plus asks.jsonl and the derived index, from ONE record", async () => {
	const out = join(TREE, "ask");
	const result = await generateSeed({ scenario: "ask-command", out, now: NOW });
	const sid = "fa1902000001";
	assert.deepEqual(result.files, [
		`asks/${sid}.json`,
		`sessions/${sid}/asks.jsonl`,
		`sessions/${sid}/created_at.json`,
		`sessions/${sid}/desktop.json`,
		`sessions/${sid}/title.json`,
		`sessions/${sid}/transcript.jsonl`,
	]);
	const logLines = readFileSync(
		join(out, "sessions", sid, "asks.jsonl"),
		"utf8",
	)
		.trim()
		.split("\n");
	assert.equal(logLines.length, 1);
	const event = JSON.parse(logLines[0]);
	const index = JSON.parse(
		readFileSync(join(out, "asks", `${sid}.json`), "utf8"),
	);
	assert.equal(event.v, 1);
	assert.equal(event.kind, "queued");
	assert.equal(event.at, NOW);
	assert.equal(
		event.expires_at,
		NOW + 24 * 3600 * 1000,
		"expires 24 h after generation",
	);
	assert.equal(event.timeout_s, 86400);
	assert.equal(event.urgent, false);
	assert.equal("status" in event, false, "status is the fold's, never logged");
	assert.deepEqual(Object.keys(index).sort(), [
		"asks",
		"cwd",
		"schema",
		"session_id",
		"updated_at",
	]);
	assert.equal(index.schema, 1);
	assert.equal(index.session_id, sid);
	assert.equal(index.asks.length, 1);
	const row = index.asks[0];
	// The index row IS pendingRow(the record the log row was built from).
	const { v: _v, kind: _k, at: _a, ...queued } = event;
	assert.deepEqual(
		row,
		pendingRow({ ...queued, status: "open", delivered: false }),
	);
	assert.deepEqual(
		row,
		pendingRow(askRecord(loadSeedSpec("ask-command").ask, NOW)),
	);
	assert.equal(row.status, "open");
	assert.deepEqual(row.questions, event.questions);
	assert.deepEqual(
		row.questions.map((q) => [q.id, q.command, q.command_target]),
		[
			["q-branch", "git status --short --branch", "agent"],
			["q-update", "brew upgrade --cask local-operator", "user"],
		],
	);
	// Key ORDER is checked on the log row: the index is written sort_keys=True,
	// exactly as core's write_entry does (asks/store.py:1479).
	for (const q of event.questions)
		assert.deepEqual(Object.keys(q), [
			"id",
			"question",
			"options",
			"multi",
			"recommended",
			"secret",
			"persist",
			"human_required",
			"question_id",
			"command",
			"command_target",
		]);
	// The session: listed only with a non-empty transcript; entries in core's shape.
	const transcript = readFileSync(
		join(out, "sessions", sid, "transcript.jsonl"),
		"utf8",
	)
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));
	assert.deepEqual(
		transcript.map((e) => e.payload.role),
		["user", "assistant", "tool"],
	);
	for (const e of transcript) {
		assert.match(e.id, /^[0-9a-f]{32}$/);
		assert.equal(e.type, "message");
		assert.ok(e.ts * 1000 < NOW, "entries precede the ask");
	}
	assert.equal(transcript[1].payload.tool_calls[0].name, "ask");
	assert.equal(transcript[1].payload.tool_calls[0].id, event.tool_call_id);
	assert.equal(transcript[2].payload.tool_call_id, event.tool_call_id);
	assert.deepEqual(
		JSON.parse(readFileSync(join(out, "sessions", sid, "title.json"), "utf8")),
		{
			text: "Mac proof: suggested command ask",
			user_set: true,
			names: ["Mac proof: suggested command ask"],
		},
	);
	assert.equal(
		typeof JSON.parse(
			readFileSync(join(out, "sessions", sid, "created_at.json"), "utf8"),
		),
		"number",
	);
	assert.deepEqual(
		JSON.parse(
			readFileSync(join(out, "sessions", sid, "desktop.json"), "utf8"),
		),
		{
			version: 1,
			cwd: "/tmp",
		},
	);
	assert.equal(
		existsSync(join(out, "sessions", sid, "origin.json")),
		false,
		"origin.json would hide the row",
	);
	// What the harness checks against the daemon.
	assert.deepEqual(result.expect, {
		scenario: "ask-command",
		path: "/v1/desktop/asks",
		sessionId: sid,
		askId: "a-1902",
		commands: [
			{
				id: "q-branch",
				command: "git status --short --branch",
				command_target: "agent",
			},
			{
				id: "q-update",
				command: "brew upgrade --cask local-operator",
				command_target: "user",
			},
		],
	});
	// A read-back built from the index itself passes; a missing command does not.
	const answer = {
		result: { asks: [{ ...row, session_id: sid, cwd: "/tmp" }] },
	};
	assert.equal(seedRowsProblem(result.expect, answer), null);
	const stripped = structuredClone(answer);
	stripped.result.asks[0].questions[1].command = undefined;
	assert.match(
		seedRowsProblem(result.expect, stripped) ?? "",
		/q-update came back without command/,
	);
	assert.match(
		seedRowsProblem(result.expect, { result: { asks: [] } }) ?? "",
		/does not list ask a-1902/,
	);
	assert.match(
		seedRowsProblem(result.expect, null) ?? "",
		/answered no result/,
	);
	const timedOut = structuredClone(answer);
	timedOut.result.asks[0].status = "timed_out";
	assert.match(
		seedRowsProblem(result.expect, timedOut) ?? "",
		/timed_out, not open/,
	);
});

test("a spec that breaks core's rules is refused, and the output dir must be absolute and empty", async () => {
	const good = loadSeedSpec("ask-command");
	const write = (name, spec) => {
		const path = join(TREE, `${name}.json`);
		writeFileSync(path, JSON.stringify(spec));
		return path;
	};
	const cases = [
		[
			"tab-command",
			(s) => {
				s.ask.questions[0].command = "git\tstatus";
			},
			/U\+0009/,
		],
		[
			"long-timeout",
			(s) => {
				s.ask.timeoutS = 86401;
			},
			/timeout/,
		],
		[
			"bad-ask-id",
			(s) => {
				s.ask.askId = "ask-1";
			},
			/askId/,
		],
		[
			"bad-session",
			(s) => {
				s.session.id = "FA1902000001";
			},
			/session/,
		],
		[
			"bad-target",
			(s) => {
				s.ask.questions[1].commandTarget = "both";
			},
			/commandTarget/,
		],
	];
	for (const [name, mutate, pattern] of cases) {
		const spec = structuredClone(good);
		mutate(spec);
		await assert.rejects(
			generateSeed({
				scenario: "ask-command",
				out: join(TREE, `out-${name}`),
				now: NOW,
				specPath: write(name, spec),
			}),
			(error) => error instanceof SeedError && pattern.test(error.message),
			name,
		);
		assert.equal(
			existsSync(join(TREE, `out-${name}`)),
			false,
			`${name}: nothing written`,
		);
	}
	await assert.rejects(
		generateSeed({ scenario: "ask-command", out: "rel/dir", now: NOW }),
		/absolute/,
	);
	await assert.rejects(
		generateSeed({ scenario: "nope", out: join(TREE, "nope"), now: NOW }),
		/scenario/,
	);
	const busy = join(TREE, "busy");
	mkdirSync(busy, { recursive: true });
	writeFileSync(join(busy, "keep.txt"), "mine");
	await assert.rejects(
		generateSeed({ scenario: "ask-command", out: busy, now: NOW }),
		/not empty/,
	);
	assert.equal(readFileSync(join(busy, "keep.txt"), "utf8"), "mine");
	// The CLI says so with exit 2 instead of a stack trace.
	const quiet = console.error;
	console.error = () => {};
	try {
		assert.equal(await main(["--scenario", "ask-command", "--out", busy]), 2);
		assert.equal(await main(["--bogus"]), 2);
	} finally {
		console.error = quiet;
	}
});

test(
	"notification-details: core's schema verbatim, user_version 3, DELETE journal, no sidecars, rows hashed like core",
	{
		skip: HAVE_SQLITE
			? false
			: `node:sqlite unavailable on Node ${process.versions.node}`,
	},
	async () => {
		const { DatabaseSync } = await import("node:sqlite");
		const out = join(TREE, "notify");
		const result = await generateSeed({
			scenario: "notification-details",
			out,
			now: NOW,
		});
		const sid = "fa1907000001";
		assert.deepEqual(result.files, [
			"notifications.db",
			`sessions/${sid}/created_at.json`,
			`sessions/${sid}/desktop.json`,
			`sessions/${sid}/title.json`,
			`sessions/${sid}/transcript.jsonl`,
		]);
		assert.deepEqual(
			readdirSync(out).sort(),
			["notifications.db", "sessions"],
			"no -wal/-shm/-journal",
		);
		const db = new DatabaseSync(join(out, "notifications.db"));
		try {
			assert.equal(
				db.prepare("PRAGMA user_version").get().user_version,
				SCHEMA_VERSION,
			);
			assert.equal(
				db.prepare("PRAGMA journal_mode").get().journal_mode,
				"delete",
			);
			// sqlite_master keeps each statement's text as written, except that SQLite
			// drops the `IF NOT EXISTS` clause, so the DDL is checkable once that goes.
			const stored = db
				.prepare(
					"SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid",
				)
				.all()
				.map((r) => r.sql.replace(/\s+/g, " ").trim());
			const declared = NOTIFICATIONS_SCHEMA.map((sql) =>
				sql
					.replace(/\s+/g, " ")
					.replace(/ IF NOT EXISTS /, " ")
					.trim(),
			);
			assert.deepEqual(stored, declared);
			const items = db.prepare("SELECT * FROM items ORDER BY seq").all();
			assert.equal(items.length, 5);
			const detail = items.find((i) => i.id === "n_macproofdetailaa");
			assert.equal(detail.priority, "high");
			assert.equal(detail.revision, 3);
			assert.equal(detail.session_id, sid);
			assert.ok(
				detail.body_md.split("\n\n").length >= 4,
				"multi-paragraph body",
			);
			assert.equal(JSON.parse(detail.links_json).length, 2);
			for (const item of items) {
				assert.match(item.id, /^n_[a-z2-7]{16}$/);
				assert.equal(
					item.content_hash,
					contentHash(item.title, item.body_md, item.links_json, item.priority),
				);
			}
			const read = items.filter((i) => i.read_rev >= i.revision);
			assert.deepEqual(
				read.map((i) => i.id),
				["n_macproofreadaaaa"],
			);
			assert.equal(read[0].read_via, "explicit");
			assert.equal(
				items.filter((i) => i.read_rev === 0).length,
				4,
				"the rest unread",
			);
			const history = db
				.prepare("SELECT * FROM item_history ORDER BY revision")
				.all();
			assert.deepEqual(
				history.map((h) => [h.item_id, h.revision]),
				[
					["n_macproofdetailaa", 1],
					["n_macproofdetailaa", 2],
				],
			);
			for (const h of history) assert.ok(h.excerpt.length <= 160);
			const next = db.prepare("SELECT v FROM meta WHERE k='next_seq'").get().v;
			assert.equal(Number(next), Math.max(...items.map((i) => i.seq)) + 1);
		} finally {
			db.close();
		}
		assert.deepEqual(result.expect, {
			scenario: "notification-details",
			path: "/v1/desktop/notifications/n_macproofdetailaa",
			sessionId: sid,
			notificationId: "n_macproofdetailaa",
			historyRevisions: [1, 2],
		});
	},
);

test("excerpt matches core's whitespace collapse and ellipsis", () => {
	assert.equal(excerpt("  a\n\nb\tc  "), "a b c");
	const long = `${"word ".repeat(60)}end`;
	const cut = excerpt(long);
	assert.equal([...cut].length <= 160, true);
	assert.ok(cut.endsWith("\u2026"));
	assert.ok(
		!cut.endsWith(" \u2026"),
		"trailing space is stripped before the ellipsis",
	);
});

/*
 * Drift guard against core's OWN source. Read through `git show` so the core
 * checkout's working tree (often on an unrelated branch) does not matter.
 */
const CORE =
	process.env.LOCAL_OPERATOR_CORE_REPO ?? join(os.homedir(), "local-operator");
const coreShow = (ref, path) => {
	const run = spawnSync("git", ["-C", CORE, "show", `${ref}:${path}`], {
		encoding: "utf8",
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0",
			GIT_CONFIG_SYSTEM: "/dev/null",
		},
	});
	return run.status === 0 ? run.stdout : null;
};
const CORE_REFS = ["v0.105.3", "origin/main"];
const coreSkip = existsSync(join(CORE, ".git"))
	? false
	: `no core checkout at ${CORE} (set LOCAL_OPERATOR_CORE_REPO)`;

/** The string literals of core's `_SCHEMA = ( ... )` tuple, in order (comments skipped). */
function pythonSchemaStatements(source) {
	const start = source.indexOf("\n_SCHEMA = (\n");
	assert.ok(start >= 0, "core still declares _SCHEMA");
	const end = source.indexOf("\n)\n", start);
	const body = source.slice(start + "\n_SCHEMA = (\n".length, end);
	const out = [];
	const literal = /"""([\s\S]*?)"""|"((?:[^"\\\n]|\\.)*)"|#[^\n]*/g;
	for (const m of body.matchAll(literal)) {
		if (m[1] !== undefined) out.push(m[1]);
		else if (m[2] !== undefined) out.push(m[2]);
	}
	return out;
}

test(
	"core drift: the DDL is core's _SCHEMA verbatim, and the shared constants match",
	{ skip: coreSkip },
	(t) => {
		let compared = 0;
		for (const ref of CORE_REFS) {
			const store = coreShow(ref, "local_operator/notifications/store.py");
			if (store === null) {
				t.diagnostic(`core ${ref} not available; skipped`);
				continue;
			}
			assert.deepEqual(
				pythonSchemaStatements(store),
				[...NOTIFICATIONS_SCHEMA],
				`_SCHEMA at ${ref}`,
			);
			assert.match(
				store,
				new RegExp(`^SCHEMA_VERSION = ${SCHEMA_VERSION}$`, "m"),
				ref,
			);
			assert.match(store, /^TITLE_MAX = 120$/m, ref);
			assert.match(store, /^BODY_MAX = 4000$/m, ref);
			assert.match(store, /^EXCERPT_MAX = 160$/m, ref);
			assert.match(
				store,
				/joined = "\\x1f"\.join\(\(title, body_md, links_json, priority\)\)/,
				ref,
			);
			const types = coreShow(ref, "local_operator/harness/types.py");
			assert.match(
				types,
				new RegExp(`^ASK_COMMAND_MAX_CHARS = ${ASK_COMMAND_MAX_CHARS}$`, "m"),
				ref,
			);
			assert.match(
				types,
				/_ASK_COMMAND_REFUSED_CATEGORIES = frozenset\(\{"Cc", "Cf", "Zl", "Zp"\}\)/,
				ref,
			);
			const policy = coreShow(ref, "local_operator/asks/policy.py");
			assert.match(policy, /^MAX_TIMEOUT_S = 86400$/m, ref);
			assert.match(policy, /^URGENT_MAX_S = 900$/m, ref);
			const asks = coreShow(ref, "local_operator/asks/store.py");
			assert.match(asks, /^INDEX_SCHEMA = 1$/m, ref);
			assert.match(asks, /candidate = f"a-\{secrets\.token_hex\(2\)\}"/, ref);
			compared++;
		}
		if (compared === 0) t.skip("no core ref readable");
	},
);
