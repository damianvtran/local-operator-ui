#!/usr/bin/env node
/**
 * Harvests the fixture behind `trace-order-while-live.stories.tsx`: the real
 * wire data of a session whose turn is IN FLIGHT, which is the state the
 * operator photographed with a wall of `bash` rows under the running `wait`.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS A SCRIPT RATHER THAN A HAND-MADE JSON.
 * The defect is about ORDER, and order is not something a hand-made fixture can
 * speak to: what the pane shows is the product of the snapshot's durable page,
 * the same snapshot's `frontend.snapshot.live_events` seed, and the shipped
 * reducer's placement rules. So the fixture has to be read out of a real
 * session through the runtime's own code, and the story has to fold it through
 * the production reducer. `scripts/stale-seed-order.json` (the finished-turn
 * half of this same class, PR #293) set that precedent; this script is the
 * live-turn half's reader.
 *
 * WHAT IT READS, AND FROM WHERE.
 *
 *   - The durable page: `read_transcript_page` — the runtime's own reader, the
 *     same function the desktop route calls — run against an ISOLATED COPY of
 *     the session directory under /tmp, `through_id=<frontend.history_cursor>`
 *     and `limit=100`, which is exactly the read
 *     `DesktopSessionBridge.snapshot()` performs. The copy is what makes this
 *     safe to run against a live session: nothing here opens the operator's
 *     config dir for writing, and nothing attaches to, steers or resumes the
 *     run.
 *   - The seed: `live_events` from the snapshot the desktop backend already
 *     serves for that session (`GET /v1/desktop/sessions/<id>`, read-only, the
 *     same frame the app's own window consumes). It CANNOT be derived from the
 *     journal: `FrontendSessionState.checkpoint()` strips `live_events` from
 *     every persisted row, and the list only exists inside a running runtime —
 *     a seed rebuilt from the journal would be a fixture of this script's
 *     invention rather than the wire's, which is the whole point of the file.
 *   - The reported calls: the opening turn's tool calls, read out of the
 *     journal in the copy, with their own measured `duration_s` and their
 *     output's first line. Those are the rows the operator photographed; the
 *     live seed has since evicted them (see `--report-only` below and the
 *     fixture's `derivation.evicted` note), so the fixture carries them as
 *     their own explicit block rather than pretending they are still in the
 *     seed.
 *
 * USAGE. The snapshot is the only input that cannot be taken from the copy, so
 * it is taken from the running backend — read-only, with the desktop token that
 * the app's own backend process holds:
 *
 *     TOK=$(ps eww -p <backend-pid> | tr ' ' '\n' \
 *       | grep '^LOCAL_OPERATOR_DESKTOP_TOKEN=' | cut -d= -f2-)
 *     curl -s -H "Authorization: Bearer $TOK" \
 *       http://127.0.0.1:1111/v1/desktop/sessions/c1c7072b735c > /tmp/snapshot.json
 *     node scripts/harvest-trace-order-fixture.mjs --snapshot=/tmp/snapshot.json
 *
 * `--snapshot-url=` performs that fetch itself when the token is exported in
 * `LOCAL_OPERATOR_DESKTOP_TOKEN`. `--session=`, `--config-dir=`, `--python=` and
 * `--out=` cover everything else, and every flag takes its value after an `=`:
 * `--python=` exists because the runtime's own reader has to be importable, and
 * the interpreter that can import it is not always the `python3` on PATH (the
 * script probes each candidate with a real import rather than assuming).
 *
 * BOTH SPAWNS STATE THE CHILD'S WHOLE PYTHON ENVIRONMENT, and that is not
 * bookkeeping: this script runs on the operator's machine, and on 2026-09-15 a
 * control run in `scripts/` that spread `process.env` into a real interpreter
 * mirrored 19 `.pyc` into his installed app through an ambient
 * `PYTHONPYCACHEPREFIX`, which failed the app's code-seal check. So every
 * interpreter this file starts — the import probe below and the reader under
 * `readPages` — is handed `pythonChildEnv()`, which drops every inherited
 * `PYTHON*` variable and points the cache at this process's own scratch
 * directory. `scripts/python-bytecode-cache.test.mjs` scans `scripts/` and
 * `bin/` for exactly this, so a third spawn added here fails there rather than
 * inheriting quietly.
 *
 * THE TRANSFORMS APPLIED TO WHAT IT READS, all of them, in
 * `narrowPage`/`narrowSeed`: ids, `ts`, entry `type`, roles, tool call ids,
 * tool names, `stop_reason`, `duration_s`, `is_error` and ORDER are untouched.
 * Text blocks have newlines collapsed to single spaces and are cut to 60
 * characters; a `tool_calls` argument whose JSON is longer than 60 characters
 * is dropped, the argument object is kept; `provider_payload` is narrowed to
 * `duration_s`; `usage` is dropped; custom rows are verbatim. The same
 * truncation the stale-seed fixture uses, for the same reason: a fixture that
 * claims to be the journal has to say what it changed. Nothing here depends on
 * the truncated text — the defect is about which ids painted a row and where.
 *
 * WHAT IT REFUSES. If the harvested report block does not have exactly
 * `REPORTED_CALLS` (8) calls, the script fails rather than writing a fixture
 * whose story would be about a different turn than the reported one.
 */

import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";
import { pythonChildEnv } from "./python-child-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const flag = (name) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : null;
};

/** The session the report is about: the operator's "Optimize local session load times". */
const DEFAULT_SESSION = "c1c7072b735c";

/**
 * The opening turn's call count, as the operator's own evidence states it.
 *
 * Asserted rather than hoped for: every claim the story makes is about THESE
 * rows, and a journal whose first turn holds another number of calls is a
 * different session wearing the same id.
 */
const REPORTED_CALLS = 8;

/** The page the desktop snapshot reads: `HistoryPage`'s own default limit. */
const PAGE_LIMIT = 100;

/** Characters a text block or an argument string keeps, per the fixture convention. */
const TEXT_CHARS = 60;

/** One line of text, at most `TEXT_CHARS` long, so a fixture stays readable. */
const oneLine = (text) =>
	String(text ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, TEXT_CHARS);

/**
 * A tool result, with its LINE STRUCTURE kept.
 *
 * A collapsed result would hide the thing these frames are about. The row's
 * object column falls back to the result's first line that is not the harness's
 * own wiring (`tool-row-model.summaryFromResult` skips `exit code: 0` and
 * `--- stdout ---`), so `exit code: 0 --- stdout --- 906 local_operator/...` on one
 * line would paint the preamble the operator never saw. Three lines, each capped,
 * is far past the first non-boilerplate line and keeps the fixture small.
 */
const clipText = (text, lines = 3, chars = 120) =>
	String(text ?? "")
		.split("\n")
		.slice(0, lines)
		.map((line) => line.slice(0, chars))
		.join("\n");

/**
 * The interpreter that can import the runtime, resolved by ASKING rather than
 * by assuming.
 *
 * The reader below is the runtime's own `read_transcript_page`, so the process
 * that runs it has to have `local_operator` importable — and the `python3` on
 * PATH is not always that. On the machine this was written on it is importable
 * only because the checkout happened to be the working directory, which is
 * exactly the kind of accident that turns into "the harvest silently derived
 * nothing" on the next machine. Each candidate is probed with a real import.
 */
function resolvePython(explicit) {
	const candidates = [
		explicit,
		process.env.LOCAL_OPERATOR_PYTHON,
		join(homedir(), "local-operator", ".venv", "bin", "python"),
		"python3",
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			execFileSync(candidate, ["-c", "import local_operator"], {
				stdio: "ignore",
				// The probe's own environment, not this shell's: an inherited
				// `PYTHONPYCACHEPREFIX` is what wrote `.pyc` into the operator's app.
				env: pythonChildEnv(),
			});
			return candidate;
		} catch {
			/* next candidate */
		}
	}
	throw new Error(
		`No interpreter can import local_operator; tried ${candidates.join(", ")}. Pass --python=<path>`,
	);
}

/** The runtime's own reader, driven against the ISOLATED copy. */
const RUNTIME_READER = String.raw`
import json, sys
from pathlib import Path
from local_operator.session.transcript import read_transcript_page

session_dir = Path(sys.argv[1])
cursor = sys.argv[2] or None
limit = int(sys.argv[3])
older_limit = int(sys.argv[4])

def page_of(page):
	return {
		"entries": [json.loads(entry.to_json()) for entry in page.entries],
		"has_more": page.has_more,
		"reconciled": page.reconciled,
	}

page = read_transcript_page(session_dir, through_id=cursor, limit=limit)
out = {"page": page_of(page)}
if older_limit > 0 and page.entries:
	older = read_transcript_page(session_dir, before_id=page.entries[0].id, limit=older_limit)
	out["older"] = page_of(older)
print(json.dumps(out))
`;

/**
 * The session directory, copied out of the operator's config dir into an
 * isolated one under /tmp, so every read below is against a private copy.
 */
function isolateSession(session, configDir) {
	const source = join(configDir, "sessions", session);
	const isolated = realpathSync(
		mkdtempSync(join(tmpdir(), "trace-order-harvest-")),
	);
	const root = join(isolated, "config");
	mkdirSync(join(root, "sessions"), { recursive: true });
	cpSync(source, join(root, "sessions", session), { recursive: true });
	return { isolated, root, dir: join(root, "sessions", session) };
}

/** The snapshot's envelope, or a failure that names what came back instead. */
function snapshotPayload(raw) {
	const payload = raw?.result?.payload;
	if (!payload?.frontend?.snapshot || !payload?.history) {
		throw new Error(
			`The snapshot has no result.payload.{frontend.snapshot,history}: keys ${Object.keys(raw ?? {})}`,
		);
	}
	return payload;
}

/**
 * The durable page and the entries behind it, read by the runtime's own reader
 * against the copy. `older` is sized the way the client's reconcile read sizes
 * itself — `reconcileLimit(missing)`, cap 500 — so the fixture carries what a
 * `load older` would return without the story having to invent a read.
 */
function readPages({ python, dir, cursor, olderLimit }) {
	const stdout = execFileSync(
		python,
		[
			"-c",
			RUNTIME_READER,
			dir,
			cursor ?? "",
			String(PAGE_LIMIT),
			String(olderLimit),
		],
		{
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			// The runtime's own reader, under an environment this script states
			// rather than the one it was started in (see the header).
			env: pythonChildEnv(),
		},
	);
	return JSON.parse(stdout);
}

/** A durable entry, narrowed to what the reducer reads, per the header's rules. */
function narrowEntry(entry) {
	const payload = entry.payload ?? {};
	if (payload.kind === "custom" || entry.type === "custom") return entry;
	const narrowed = {
		id: entry.id,
		ts: entry.ts,
		type: entry.type,
		payload: {
			kind: payload.kind,
			role: payload.role,
			stop_reason: payload.stop_reason ?? null,
			// The pairing key the settled renderer uses; kept verbatim.
			tool_call_id: payload.tool_call_id ?? null,
			tool_name: payload.tool_name ?? null,
			content: (payload.content ?? []).map((block) => ({
				type: block.type,
				text: oneLine(block.text),
			})),
			tool_calls: (payload.tool_calls ?? []).map((call) => ({
				id: call.id,
				name: call.name,
				arguments: shortArguments(call.arguments),
			})),
		},
	};
	return narrowed;
}

/** An argument object, with only its over-long values dropped. */
function shortArguments(args) {
	if (args === null || typeof args !== "object") return args ?? null;
	const out = {};
	for (const [key, value] of Object.entries(args)) {
		const rendered = JSON.stringify(value);
		out[key] =
			rendered !== undefined && rendered.length > TEXT_CHARS ? null : value;
	}
	return out;
}

/** A live seed frame, narrowed: identity, timing and the first line of the result. */
function narrowFrame(frame) {
	const out = {
		type: frame.type,
		tool_call_id: frame.tool_call_id,
		tool_name: frame.tool_name,
	};
	if (typeof frame.duration_s === "number") out.duration_s = frame.duration_s;
	if (frame.is_error !== undefined) out.is_error = frame.is_error;
	if (frame.started_at_epoch !== undefined)
		out.started_at_epoch = frame.started_at_epoch;
	if (frame.args !== undefined) out.args = shortArguments(frame.args);
	if (frame.intent !== undefined) out.intent = frame.intent;
	if (frame.supersedes_tool_call_id !== undefined)
		out.supersedes_tool_call_id = frame.supersedes_tool_call_id;
	if (frame.not_run_reason !== undefined)
		out.not_run_reason = frame.not_run_reason;
	if (frame.result !== undefined) {
		const result = frame.result ?? {};
		out.result = {
			tool_call_id: result.tool_call_id,
			tool_name: result.tool_name,
			is_error: result.is_error,
			content: (result.content ?? []).map((block) => ({
				type: block.type,
				text: clipText(block.text),
			})),
		};
	}
	return out;
}

/** The journal, as rows, from the COPY — never from the operator's config dir. */
function readJournal(dir) {
	return readFileSync(join(dir, "transcript.jsonl"), "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
}

/**
 * The opening turn's tool calls and their own results.
 *
 * The turn is the block between the FIRST user row and the SECOND one — the
 * steering message that interrupted it. Both halves come out of the journal:
 * the calls from the assistant rows' `tool_calls`, the measurement and the
 * output from the tool rows that answer them by `tool_call_id`.
 */
function openingTurn(rows) {
	const userRows = rows
		.map((row, index) => (row.payload?.role === "user" ? index : -1))
		.filter((index) => index >= 0);
	const start = userRows[0] ?? 0;
	const end = userRows[1] ?? rows.length;
	const calls = [];
	for (const row of rows.slice(start + 1, end)) {
		if (row.payload?.role !== "assistant") continue;
		for (const call of row.payload.tool_calls ?? []) {
			const result = rows
				.slice(start + 1, end)
				.find((other) => other.payload?.tool_call_id === call.id);
			const provider = result?.payload?.provider_payload ?? {};
			calls.push({
				call_id: call.id,
				tool_name: call.name,
				intent: call.arguments?.i ?? null,
				command: oneLine(call.arguments?.command),
				// `provider_payload.duration_s` is the durable statement of how long the
				// call took: the same number the live `tool_execution_end` frame carries
				// at its top level, which is why a ghost row's duration is NOT evidence
				// of which door painted it.
				duration_s: provider.duration_s ?? null,
				is_error: result?.payload?.is_error ?? null,
				output_first_line: firstOutputLine(result?.payload?.content),
			});
		}
	}
	return calls;
}

/** The first line a `bash` result says anything with: past the exit-code preamble. */
function firstOutputLine(content) {
	const text = (content ?? []).map((block) => block.text ?? "").join("");
	const body = text.split("--- stdout ---")[1] ?? text;
	const line = body.split("\n").find((part) => part.trim());
	return oneLine(line);
}

/** Every record index a tool call id appears at in the journal, 1-based. */
function callRecords(rows) {
	const map = new Map();
	rows.forEach((row, index) => {
		const callId = row.payload?.tool_call_id;
		if (callId) map.set(callId, index + 1);
		for (const call of row.payload?.tool_calls ?? [])
			map.set(call.id, index + 1);
	});
	return map;
}

/** An `tool_execution_end` frame for a call, as the durable journal states it. */
function endFrame(row) {
	const payload = row.payload ?? {};
	return {
		type: "tool_execution_end",
		tool_call_id: payload.tool_call_id,
		tool_name: payload.tool_name,
		result: {
			tool_call_id: payload.tool_call_id,
			tool_name: payload.tool_name,
			is_error: payload.is_error ?? false,
			content: (payload.content ?? []).map((block) => ({
				type: block.type,
				text: clipText(block.text),
			})),
		},
		duration_s: payload.provider_payload?.duration_s ?? null,
		is_error: payload.is_error ?? false,
	};
}

/** Every call the journal has an answer for by record `n`, oldest first. */
function endsUpto(rows, n) {
	return rows
		.slice(0, n)
		.filter((row) => row.payload?.role === "tool" && row.payload?.tool_call_id)
		.map((row) => row.payload.tool_call_id);
}

/**
 * The call the turn is INSIDE at record `n`: the newest assistant row naming a
 * call no tool row has answered yet, as the `tool_execution_start` the live fold
 * would have kept.
 *
 * `started_at_epoch` is the assistant row's own `ts`, which is when the call was
 * issued and the only time the journal states for it — the live frame's own field
 * is not in the journal, and the durable assistant row is what the runtime dated
 * the call by in the first place.
 */
function inFlightFrame(rows, n) {
	const answered = new Set(endsUpto(rows, n));
	for (let index = n - 1; index >= 0; index -= 1) {
		const row = rows[index];
		if (row.payload?.role !== "assistant") continue;
		for (const call of row.payload.tool_calls ?? []) {
			if (answered.has(call.id)) continue;
			return {
				type: "tool_execution_start",
				tool_call_id: call.id,
				tool_name: call.name,
				args: shortArguments(call.arguments),
				intent: call.arguments?.i ?? null,
				started_at_epoch: row.ts,
			};
		}
	}
	return null;
}

/** The journal prefix's first `n` records, as the runtime's own reader reads it. */
function writePrefix(isolated, rows, n) {
	const dir = join(isolated, "asof", String(n));
	mkdirSync(dir, { recursive: true });
	const lines = rows.slice(0, n).map((row) => JSON.stringify(row));
	writeFileSync(join(dir, "transcript.jsonl"), `${lines.join("\n")}\n`);
	return dir;
}

/**
 * The reported moment, derived rather than guessed.
 *
 * The operator's pane showed nine rows at its tail — the eight opening-turn
 * calls plus the in-flight row — while a harvest taken an hour later shows 59
 * injected rows, because BOTH numbers are the same rule at different times: the
 * page is the newest 100 ENTRIES while the seed keeps the newest 100 ENDS of the
 * whole RUN, so the injected rows are the seed's ends whose call the page cannot
 * name, and that difference grows as the journal outgrows the page.
 *
 * So the reported frame's journal size is not chosen by hand: it is the size at
 * which the rule produces exactly the eight calls the report proves, found by
 * walking the journal forward and comparing the injected set against the opening
 * turn's own calls. The first such record is used, and the whole contiguous run
 * is recorded beside it, so a reader can see the window rather than trust one
 * number.
 */
function reportedMoment(rows, reportCalls) {
	const wanted = new Set(reportCalls.map((call) => call.call_id));
	const matches = [];
	for (let n = 2; n <= rows.length; n += 1) {
		const page = rows.slice(Math.max(0, n - PAGE_LIMIT), n);
		const named = new Set();
		for (const row of page) {
			for (const call of row.payload?.tool_calls ?? []) named.add(call.id);
			if (row.payload?.tool_call_id) named.add(row.payload.tool_call_id);
		}
		const ghosts = endsUpto(rows, n)
			.slice(-LIVE_EVENT_END_ROWS_MAX)
			.filter((callId) => !named.has(callId));
		const injected = new Set(ghosts);
		if (
			injected.size === wanted.size &&
			[...wanted].every((id) => injected.has(id))
		) {
			matches.push(n);
		}
	}
	if (matches.length === 0) {
		throw new Error(
			"No journal size makes the reported eight the whole injected set",
		);
	}
	return { records: [matches[0], matches.at(-1)] };
}

/** The broadcast seed's own cap on retained ends, mirrored from the runtime. */
const LIVE_EVENT_END_ROWS_MAX = 100;

async function main() {
	const session = flag("session") ?? DEFAULT_SESSION;
	const configDir =
		flag("config-dir") ??
		process.env.LOCAL_OPERATOR_CONFIG_DIR ??
		join(homedir(), ".local-operator");
	const python = resolvePython(flag("python"));
	const out =
		flag("out") ?? join(ROOT, "scripts", "fixtures", "trace-order.json");
	const isolated = isolateSession(session, configDir);
	process.stderr.write(`isolated config dir: ${isolated.root}\n`);
	try {
		let raw;
		const snapshotPath = flag("snapshot");
		if (snapshotPath) {
			raw = JSON.parse(readFileSync(snapshotPath, "utf8"));
		} else {
			const url = flag("snapshot-url") ?? "http://127.0.0.1:1111";
			const token = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ?? "";
			if (!token)
				throw new Error(
					"--snapshot-url needs LOCAL_OPERATOR_DESKTOP_TOKEN exported",
				);
			const response = await fetch(`${url}/v1/desktop/sessions/${session}`, {
				headers: { authorization: `Bearer ${token}` },
			});
			raw = await response.json();
			writeFileSync(
				join(isolated.isolated, "snapshot.json"),
				JSON.stringify(raw),
			);
			process.stderr.write(`snapshot captured from ${url}\n`);
		}
		const payload = snapshotPayload(raw);
		const frontend = payload.frontend.snapshot;
		const seed = frontend.live_events ?? [];
		const rows = readJournal(isolated.dir);
		const report = openingTurn(rows);
		if (report.length !== REPORTED_CALLS) {
			throw new Error(
				`The opening turn holds ${report.length} calls, not ${REPORTED_CALLS}: this is not the reported turn`,
			);
		}
		// The client fires one tail read for the calls the seed names and the page
		// cannot label, sized by `reconcileLimit` (`RECONCILE_ENTRIES_PER_CALL` 2,
		// cap 500). Computing it here keeps that number out of the story.
		const pageCalls = new Set();
		for (const entry of payload.history.entries) {
			for (const call of entry.payload?.tool_calls ?? [])
				pageCalls.add(call.id);
			if (entry.payload?.tool_call_id)
				pageCalls.add(entry.payload.tool_call_id);
		}
		const unlabelled = seed
			.filter((frame) => frame.type === "tool_execution_end")
			.map((frame) => frame.tool_call_id)
			.filter((callId) => !pageCalls.has(callId));
		const pages = readPages({
			python,
			dir: isolated.dir,
			cursor: frontend.history_cursor,
			olderLimit:
				Math.min(500, PAGE_LIMIT + 2 * unlabelled.length) - PAGE_LIMIT,
		});
		// The copy has to answer with the SAME page the wire's snapshot carries, or
		// the fixture would be folding two different histories together.
		const copyIds = pages.page.entries.map((entry) => entry.id).join(",");
		const wireIds = payload.history.entries.map((entry) => entry.id).join(",");
		if (copyIds !== wireIds) {
			throw new Error("The copy's page differs from the snapshot's own page");
		}
		const records = callRecords(rows);
		const reach = seed
			.map((frame) => records.get(frame.tool_call_id))
			.filter((index) => index !== undefined);
		// The reported moment, rebuilt from the journal at the size where the rule
		// produces exactly the eight calls the report proves. Its page is read by the
		// runtime's own reader out of a truncated copy of the journal, so it is the
		// page that moment would have served rather than one this script assembled.
		const moment = reportedMoment(rows, report);
		const throughRecord = moment.records[0];
		const prefixRows = rows.slice(0, throughRecord);
		const reportedPages = readPages({
			python,
			dir: writePrefix(isolated.isolated, rows, throughRecord),
			cursor: prefixRows.at(-1)?.id ?? null,
			olderLimit: 0,
		});
		const reportedNamed = new Set();
		for (const entry of reportedPages.page.entries) {
			for (const call of entry.payload?.tool_calls ?? [])
				reportedNamed.add(call.id);
			if (entry.payload?.tool_call_id)
				reportedNamed.add(entry.payload.tool_call_id);
		}
		const reportedSeedIds = endsUpto(rows, throughRecord).slice(
			-LIVE_EVENT_END_ROWS_MAX,
		);
		const reportedGhosts = reportedSeedIds.filter(
			(callId) => !reportedNamed.has(callId),
		);
		const reportedSeed = [
			...reportedSeedIds.map((callId) => {
				const row = prefixRows.find(
					(candidate) => candidate.payload?.tool_call_id === callId,
				);
				return endFrame(row);
			}),
		];
		const inFlight = inFlightFrame(rows, throughRecord);
		if (inFlight) reportedSeed.push(inFlight);
		const fixture = {
			session: {
				id: session,
				title: readTitle(isolated.dir),
				harvested_at: new Date().toISOString(),
				page_limit: PAGE_LIMIT,
			},
			derivation: {
				note: "See scripts/harvest-trace-order-fixture.mjs's header for the commands and every transform.",
				frontend: {
					streaming: frontend.streaming,
					generation: frontend.generation,
					history_cursor: frontend.history_cursor,
				},
				seed_frames: seed.length,
				seed_ends: seed.filter((frame) => frame.type === "tool_execution_end")
					.length,
				page_entries: payload.history.entries.length,
				page_names_calls: pageCalls.size,
				unlabelled_ends: unlabelled.length,
				unlabelled_ids: unlabelled,
				reconcile_entries: Math.min(500, PAGE_LIMIT + 2 * unlabelled.length),
				reach_back_records: reach.length
					? [Math.min(...reach), Math.max(...reach)]
					: null,
				evicted: report
					.filter(
						(call) =>
							!seed.some((frame) => frame.tool_call_id === call.call_id),
					)
					.map((call) => call.call_id),
			},
			page: {
				entries: pages.page.entries.map(narrowEntry),
				has_more: pages.page.has_more,
			},
			older: {
				entries: (pages.older?.entries ?? []).map(narrowEntry),
				has_more: pages.older?.has_more ?? false,
			},
			seed: {
				streaming: frontend.streaming,
				generation: frontend.generation,
				live_events: seed.map(narrowFrame),
			},
			reported: {
				note: "The moment the report was photographed, derived by `reportedMoment` (see the script's header) and read out of a truncated copy of the journal.",
				through_record: throughRecord,
				record_window: moment.records,
				page: {
					entries: reportedPages.page.entries.map(narrowEntry),
					has_more: reportedPages.page.has_more,
				},
				seed: {
					streaming: frontend.streaming,
					generation: frontend.generation,
					live_events: reportedSeed,
				},
				ghosts: reportedGhosts,
				page_names_ghosts: reportedGhosts.filter((callId) =>
					reportedNamed.has(callId),
				),
				in_flight: inFlight,
			},
			report,
		};
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, `${JSON.stringify(fixture, null, "\t")}\n`);
		formatFixture(out);
		process.stdout.write(
			`${out}\n` +
				`  page          ${fixture.derivation.page_entries} entries, names ${fixture.derivation.page_names_calls} calls\n` +
				`  seed          ${fixture.derivation.seed_ends} ends of ${fixture.derivation.seed_frames} frames, ${fixture.derivation.unlabelled_ends} unlabelled\n` +
				`  reach back    journal records ${fixture.derivation.reach_back_records?.join("..") ?? "n/a"}\n` +
				`  reported      record ${throughRecord} (window ${moment.records.join("..")}), ${reportedGhosts.length} injected rows, page names ${reportedGhosts.length - fixture.reported.page_names_ghosts.length}\n` +
				`  report        ${report.length} opening-turn calls, ${fixture.derivation.evicted.length} since evicted from the seed\n`,
		);
	} finally {
		rmSync(isolated.isolated, { recursive: true, force: true });
	}
}

/**
 * Bring the written fixture into the formatter's own shape.
 *
 * `scripts/` is checked by `pnpm lint:scripts` against the base commit, so a
 * fixture this script writes has to be byte-stable under `biome` or the gate
 * fails on the very change that introduces it — and a hand-rolled
 * `JSON.stringify` cannot match the formatter's array compaction. Running the
 * formatter here is what makes re-harvesting a no-op in the diff rather than a
 * reformat somebody has to notice.
 */
function formatFixture(out) {
	const biome = join(ROOT, "node_modules", ".bin", "biome");
	if (!existsSync(biome)) {
		process.stderr.write(
			`no biome at ${biome}; run \`pnpm exec biome check --write ${out}\` before committing\n`,
		);
		return;
	}
	execFileSync(biome, ["check", "--write", out], {
		stdio: ["ignore", "ignore", "inherit"],
	});
}

/** The session's own title, which is how a reader recognises the fixture. */
function readTitle(dir) {
	try {
		const stored = JSON.parse(readFileSync(join(dir, "title.json"), "utf8"));
		return stored.text ?? stored.title ?? null;
	} catch {
		return null;
	}
}

if (isEntryPoint(import.meta.url)) {
	main().catch((error) => {
		process.stderr.write(`${error.stack ?? error}\n`);
		process.exit(1);
	});
}
