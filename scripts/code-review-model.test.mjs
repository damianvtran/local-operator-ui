import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE CODE REVIEW PANE'S DERIVATIONS, over the REAL wire shapes (agent review
 * round 1, F3).
 *
 * Every payload below is the shape PR1b (#2112, `02d35709cc`) actually answers
 * with, copied from the source that produces it:
 *
 * - CI rows: `code_requests/adapters/gitlab.py` `ci()` returns
 *   `{status, passed: None, failed: None, pending: None, total: None, url,
 *   raw_status}` for a pipeline with state - the four counters are ALWAYS null
 *   on GitLab; `adapters/github.py` `ci()` keeps counters it counted.
 * - Lanes: `code_requests/rounds.py` `LaneState.to_payload()` - `round` is
 *   OMITTED when the parser could not place one, `state_copy` is the backend's
 *   derived sentence, `verdict_class` the parser's class.
 * - Rows: `service.view_row()` + `server/routes/desktop_code_requests.py`
 *   `_row_payload()` - `link_only_hint` is the per-forge remedy sentence,
 *   `reason` the verbatim cause, `summary.comments` a number or null,
 *   `cooling` a host-to-epoch map, `scan_state` `ready`|`refreshing`|`missing`.
 *
 * These are the tests whose absence let F1 (`null/null passed`) and F2 (`Round
 * undefined`) ship: the model is pure, so an absence of coverage is the whole
 * reason they were invisible to a green suite.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { ciClause, laneStateClause, roundSegments, laneLines, commentClause, linkOnlyRemedy, toolOutputNote, forgeSigil, identityLabel, rowAriaLabel, attentionCause, needsAttention, rowHasPendingCi, chipClause, coolingClauses, groupRows, laneSegmentTone, refreshCaption, rowNotice } from "./src/renderer/src/features/code-review/code-review-model";',
			'export { intervalFor, SCAN_POLL_MS, codeRequestsEnabled, appliedAfterFrame, chipState } from "./src/renderer/src/features/code-review/hooks/use-code-requests";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		// The renderer's own path aliases, restated because esbuild reads the ROOT
		// tsconfig by default and the renderer's mapping lives in `tsconfig.app.json`.
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
		"@assets": join(process.cwd(), "src/renderer/src/assets"),
	},
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	ciClause,
	laneStateClause,
	roundSegments,
	laneLines,
	commentClause,
	linkOnlyRemedy,
	toolOutputNote,
	forgeSigil,
	identityLabel,
	rowAriaLabel,
	attentionCause,
	needsAttention,
	rowHasPendingCi,
	rowNotice,
	chipClause,
	coolingClauses,
	groupRows,
	refreshCaption,
	intervalFor,
	SCAN_POLL_MS,
	codeRequestsEnabled,
	appliedAfterFrame,
	chipState,
} = mod;

/*
 * Hoisted from the `assert.match` call sites: a regex literal inside a test
 * callback reads as newly compiled per run and trips `useTopLevelRegex`
 * (agent review round 2, m3). One name per assertion role.
 */
const ROW_ARIA_FULL =
	/^damianvtran\/local-operator #1904: feat: a thing, open, Round 2 · remediation posted · awaiting re-review, opens in your browser$/;
const COOLING_GITHUB_LINE = /^GitHub rate-limited until /;

/* ------------------------------------------------------------------ shapes */

const gitlabCi = (status) => ({
	status,
	passed: null,
	failed: null,
	pending: null,
	total: null,
	url: "https://gitlab.com/minervaai/minerva-skills/-/pipelines/2924686797",
	raw_status: status,
});

const githubCi = (over = {}) => ({
	status: "success",
	passed: 23,
	failed: 0,
	pending: 0,
	total: 23,
	url: null,
	...over,
});

/** `LaneState.to_payload()` with a round; the value-fields appear only when set. */
const lane = (over = {}) => ({
	lane: "agent",
	state: "clean",
	state_copy: "clean, fresh",
	freshness: "fresh",
	verdict_class: "clean",
	...over,
});

const row = (over = {}) => ({
	key: "gh:1904",
	url: "https://github.com/damianvtran/local-operator/pull/1904",
	forge: "github",
	host: "github.com",
	project: "damianvtran/local-operator",
	number: 1904,
	relation: "opened",
	relations: ["opened"],
	acted: [],
	mention: { sources: ["tool_create"], count: 1, first_at: 1, last_at: 2 },
	link_only: false,
	first_at: 1,
	last_at: 2,
	...over,
});

const list = (rows, over = {}) => ({
	session_id: "a1b2c3d4e5f6",
	revision: 7,
	rows,
	tool_output_only_count: 0,
	tool_output_truncated: false,
	cooling: {},
	scan_state: "ready",
	updated_at: 1791554400,
	...over,
});

/* ---------------------------------------------------------------- CI clause */

test("GitLab's null counts read as status words, never `null/null passed`", () => {
	assert.deepEqual(ciClause(gitlabCi("success")), {
		text: "CI passed",
		tone: "plain",
	});
	assert.deepEqual(ciClause(gitlabCi("failure")), {
		text: "CI failing",
		tone: "danger",
	});
	assert.deepEqual(ciClause(gitlabCi("pending")), {
		text: "CI pending",
		tone: "muted",
	});
});

test("a failure with counts keeps the count and outranks the status word", () => {
	assert.deepEqual(
		ciClause(githubCi({ status: "failure", passed: 22, failed: 2, total: 24 })),
		{ text: "2 failing", tone: "danger" },
	);
	assert.deepEqual(
		ciClause(githubCi({ status: "pending", failed: 1, passed: 0, total: 4 })),
		{ text: "1 failing", tone: "danger" },
	);
});

test("numeric success reads N/N passed, and a pending count reads CI running", () => {
	assert.deepEqual(ciClause(githubCi()), {
		text: "23/23 passed",
		tone: "plain",
	});
	assert.deepEqual(
		ciClause(
			githubCi({
				status: "pending",
				passed: 0,
				failed: 0,
				pending: 3,
				total: 3,
			}),
		),
		{ text: "CI running", tone: "muted" },
	);
});

test("no checks and missing CI are distinct absences", () => {
	assert.deepEqual(
		ciClause(githubCi({ status: "none", total: 0, passed: 0 })),
		{
			text: "No checks yet",
			tone: "muted",
		},
	);
	assert.equal(ciClause(null), null, "a missing ci record renders no clause");
	assert.equal(ciClause(undefined), null);
});

/* ------------------------------------------------------------------- lanes */

test("an absent round prints the state without a number, never `Round undefined`", () => {
	assert.equal(laneStateClause(lane()), "clean", "no round -> no number");
	assert.equal(laneStateClause(lane({ round: 1 })), "Round 1 · clean");
	assert.equal(
		laneStateClause(lane({ round: 2, state: "remediation_posted" })),
		"Round 2 · remediation posted · awaiting re-review",
	);
	assert.equal(
		laneStateClause(lane({ state: "awaiting_review", round: null })),
		"No agent review yet",
	);
});

test("no known round paints no segments; earlier rounds are neutral; a stale clean is muted", () => {
	assert.deepEqual(roundSegments(lane()), [], "round absent -> no segments");
	assert.deepEqual(
		roundSegments(lane({ round: 2 })).map((s) => s.tone),
		["muted", "success"],
	);
	assert.deepEqual(
		roundSegments(
			lane({ round: 2, freshness: "stale", reviewed_head: "a3ffd2b6" }),
		).map((s) => s.tone),
		["muted", "muted"],
		"a stale clean must not paint success",
	);
	assert.deepEqual(
		roundSegments(lane({ round: 1, state: "findings_open" })).map(
			(s) => s.tone,
		),
		["warning"],
	);
});

test("the lane line joins the clause with the stale caption and keeps lane order", () => {
	const lines = laneLines(
		row({
			summary: {
				state: "open",
				draft: false,
				title: "t",
				head_sha: "9d29452c11",
				updated_at: 1,
			},
			lanes: [
				lane({ round: 2, freshness: "stale", reviewed_head: "3f2a91b7" }),
				lane({ lane: "qa", round: 1 }),
			],
		}),
	);
	assert.equal(lines.length, 2);
	assert.equal(lines[0].name, "Code");
	assert.equal(
		lines[0].clause,
		"Round 2 · clean · stale — reviewed 3f2a91b, head 9d29452",
	);
});

/* ------------------------------------------------------- rows and captions */

test("link_only_hint is rendered verbatim, per forge; the fallback is plain", () => {
	assert.equal(
		linkOnlyRemedy(
			row({
				link_only: true,
				link_only_hint:
					"Link only — sign in with the gh CLI to track this one.",
			}),
		),
		"Link only — sign in with the gh CLI to track this one.",
	);
	assert.equal(
		linkOnlyRemedy(
			row({
				forge: "gitea",
				link_only: true,
				link_only_hint: "Link only — this host isn't tracked yet.",
			}),
		),
		"Link only — this host isn't tracked yet.",
	);
	assert.equal(
		linkOnlyRemedy(
			row({
				forge: "gitlab",
				link_only: true,
				link_only_hint:
					"Link only — sign in with the glab CLI to track this one.",
			}),
		),
		"Link only — sign in with the glab CLI to track this one.",
	);
	assert.equal(linkOnlyRemedy(row({ link_only: true })), "Link only");
});

test("comments: null renders no clause, a number renders the count", () => {
	assert.equal(commentClause(null), null);
	assert.equal(commentClause(undefined), null);
	assert.equal(commentClause(6), "6 comments");
	assert.equal(commentClause(1), "1 comment");
});

test("a truncated tool-output count carries a +", () => {
	assert.equal(toolOutputNote(2, false), "2 more seen in tool output");
	assert.equal(toolOutputNote(700, true), "700+ more seen in tool output");
});

test("the attention cause names what is actually wrong", () => {
	const checksFailing = row({
		summary: {
			state: "open",
			draft: false,
			title: "t",
			head_sha: "a",
			updated_at: 1,
			ci: gitlabCi("failure"),
		},
		lanes: [lane({ round: 1 })],
	});
	assert.equal(attentionCause([checksFailing]), "checks failing");
	const findingsOpen = row({
		summary: {
			state: "open",
			draft: false,
			title: "t",
			head_sha: "a",
			updated_at: 1,
			ci: githubCi(),
		},
		lanes: [lane({ round: 1, state: "findings_open" })],
	});
	assert.equal(attentionCause([findingsOpen]), "findings open");
	assert.equal(
		attentionCause([
			row({
				...findingsOpen,
				summary: { ...findingsOpen.summary, ci: gitlabCi("failure") },
			}),
		]),
		"findings open · checks failing",
	);
	assert.equal(
		attentionCause([
			row({ summary: { ...findingsOpen.summary, ci: githubCi() } }),
		]),
		null,
	);
	assert.equal(
		attentionCause([row({ ...findingsOpen, relation: "mentioned" })]),
		null,
		"a mentioned row is not this session's work",
	);
	assert.equal(needsAttention([checksFailing]), true);
});

test("a row with a pending CI is the poll rule's second term", () => {
	assert.equal(
		rowHasPendingCi(
			row({
				summary: {
					state: "open",
					draft: false,
					title: "t",
					head_sha: "a",
					updated_at: 1,
					ci: githubCi({
						status: "pending",
						passed: 0,
						failed: 0,
						pending: 2,
						total: 2,
					}),
				},
			}),
		),
		true,
	);
	assert.equal(
		rowHasPendingCi(
			row({
				summary: {
					state: "open",
					draft: false,
					title: "t",
					head_sha: "a",
					updated_at: 1,
					ci: githubCi(),
				},
			}),
		),
		false,
	);
	assert.equal(rowHasPendingCi(row()), false, "no summary -> not pending");
});

test("the chip shows only with a host and a visible row; count is rows.length", () => {
	const rows = [
		row({ key: "gh:1", number: 1 }),
		row({ key: "gl:57", number: 57, forge: "gitlab", relation: "mentioned" }),
		row({ key: "gh:2", number: 2, relation: "mentioned" }),
	];
	const state = chipState(true, rows);
	assert.equal(state.show, true);
	assert.equal(
		state.count,
		3,
		"every visible row counts, collapsed ones never arrive",
	);
	assert.equal(state.opened, 1);
	assert.equal(state.mentioned, 2);
	assert.equal(
		state.label,
		"Open code review — 3 code requests, 1 opened · 2 mentioned",
	);
	assert.equal(
		chipState(true, rows, true).label,
		"Code review is showing — 3 code requests, 1 opened · 2 mentioned",
		"a showing pane flips the lead (UX round 2, U18)",
	);
	assert.equal(chipState(false, rows).show, false, "no slot -> no door");
	assert.equal(chipState(true, []).show, false, "zero rows -> no chip");
	assert.equal(chipClause(1), "1 code request");
});

test("GitLab identities use !N and the aria name says where the press goes", () => {
	assert.equal(forgeSigil(row()), "#");
	assert.equal(forgeSigil(row({ forge: "gitlab" })), "!");
	assert.equal(
		identityLabel(
			row({ forge: "gitlab", project: "minervaai/minerva-skills", number: 57 }),
		),
		"minervaai/minerva-skills !57",
	);
	const label = rowAriaLabel(
		row({
			summary: {
				state: "open",
				draft: false,
				title: "feat: a thing",
				head_sha: "a",
				updated_at: 1,
				ci: githubCi(),
			},
			lanes: [lane({ round: 2, state: "remediation_posted" })],
		}),
	);
	assert.match(label, ROW_ARIA_FULL);
});

test("groupRows survives a null mention.last_at (the F2 NaN class)", () => {
	const sorted = groupRows([
		row({
			key: "a",
			mention: { sources: ["user"], count: 1, first_at: null, last_at: null },
		}),
		row({
			key: "b",
			mention: { sources: ["user"], count: 1, first_at: 1, last_at: 10 },
		}),
	]);
	assert.deepEqual(
		sorted.opened.map((r) => r.key),
		["b", "a"],
	);
});

/* -------------------------------------------------------------- the rules */

test("the refetch rule: 60 s only for a visible pane on a running turn or pending CI", () => {
	const idle = list([
		row({
			summary: {
				state: "open",
				draft: false,
				title: "t",
				head_sha: "a",
				updated_at: 1,
				ci: githubCi(),
			},
		}),
	]);
	assert.equal(
		intervalFor(idle, { visible: false, sessionLive: false }),
		false,
		"no pane, no timer",
	);
	assert.equal(
		intervalFor(idle, { visible: true, sessionLive: false }),
		false,
		"idle + settled CI costs nothing",
	);
	assert.equal(intervalFor(idle, { visible: true, sessionLive: true }), 60_000);
	const pending = list([
		row({
			summary: {
				state: "open",
				draft: false,
				title: "t",
				head_sha: "a",
				updated_at: 1,
				ci: githubCi({
					status: "pending",
					passed: 0,
					failed: 0,
					pending: 1,
					total: 1,
				}),
			},
		}),
	]);
	assert.equal(
		intervalFor(pending, { visible: true, sessionLive: false }),
		60_000,
	);
	assert.equal(
		intervalFor(pending, { visible: false, sessionLive: false }),
		false,
		"the chip never polls",
	);
});

test("a scan that has not settled polls at the scan cadence regardless of rows", () => {
	const scanning = list([], { scan_state: "refreshing" });
	assert.equal(
		intervalFor(scanning, { visible: true, sessionLive: false }),
		SCAN_POLL_MS,
	);
	assert.equal(
		intervalFor(scanning, { visible: false, sessionLive: false }),
		false,
	);
	assert.equal(
		intervalFor(list([], { scan_state: "ready" }), {
			visible: true,
			sessionLive: false,
		}),
		false,
		"a settled empty list is a fact, not a reason to poll",
	);
	assert.equal(
		intervalFor(list([], { scan_state: "missing" }), {
			visible: true,
			sessionLive: false,
		}),
		false,
	);
});

test("enablement: session AND capability AND the caller's gate AND a real client", () => {
	const yes = {
		sessionId: "s1",
		capable: true,
		pollEnabled: true,
		provided: true,
	};
	assert.equal(codeRequestsEnabled(yes), true);
	assert.equal(codeRequestsEnabled({ ...yes, sessionId: null }), false);
	assert.equal(
		codeRequestsEnabled({ ...yes, capable: false }),
		false,
		"capability off is fail-closed",
	);
	assert.equal(
		codeRequestsEnabled({ ...yes, pollEnabled: false }),
		false,
		"the host's own gate wins",
	);
	assert.equal(
		codeRequestsEnabled({ ...yes, provided: false }),
		false,
		"no provider -> no fetch",
	);
});

test("feed frames: this session invalidates, another session is ignored, a duplicate is free", () => {
	const frame = { sessionId: "s1", revision: 7 };
	assert.deepEqual(
		appliedAfterFrame(null, frame, "s1"),
		frame,
		"first frame applies",
	);
	assert.deepEqual(
		appliedAfterFrame(frame, { sessionId: "s1", revision: 7 }, "s1"),
		frame,
		"duplicate returns the same object",
	);
	assert.deepEqual(
		appliedAfterFrame(frame, { sessionId: "s2", revision: 9 }, "s1"),
		frame,
		"another session's frame does not replace the applied one",
	);
	assert.deepEqual(
		appliedAfterFrame(frame, { sessionId: "s1", revision: 8 }, "s1"),
		{
			sessionId: "s1",
			revision: 8,
		},
	);
	assert.equal(appliedAfterFrame(null, null, "s1"), null);
	assert.equal(
		appliedAfterFrame(null, frame, null),
		null,
		"no session -> nothing to invalidate",
	);
});

test("cooling clauses name the host and the instant, minute-quiet", () => {
	const lines = coolingClauses(
		{ "github.com": 1791554400 },
		1791554400_000 - 60_000,
	);
	assert.equal(lines.length, 1);
	assert.match(lines[0], COOLING_GITHUB_LINE);
});

test("a row's refresh failure surfaces the backend's own sentence (U5)", () => {
	assert.equal(
		refreshCaption(row()),
		null,
		"a cleanly-read row carries no caption",
	);
	assert.equal(
		refreshCaption(
			row({
				refresh_error:
					"credential rejected — sign in again with gh/glab, then refresh.",
			}),
		),
		"Couldn't refresh: credential rejected — sign in again with gh/glab, then refresh.",
	);
});

test("the row notice follows the backend's reason over the sign-in remedy (Q-11)", () => {
	const cooling =
		"cooling — this host is rate-limited until 2026-10-10T00:45:41Z; nothing was fetched yet";
	assert.equal(
		rowNotice(
			row({
				link_only: true,
				reason: cooling,
				link_only_hint:
					"Link only — sign in with the gh CLI to track this one.",
				cooling_until: 1791612341,
			}),
		),
		cooling,
		"a cold row on a cooling host states the cooling, not a sign-in it cannot take",
	);
	assert.equal(
		rowNotice(
			row({
				link_only: true,
				link_only_hint: "Link only — this host isn't tracked yet.",
			}),
		),
		"Link only — this host isn't tracked yet.",
		"with no reason, the per-forge remedy sentence stands",
	);
	assert.equal(
		rowNotice(
			row({
				refresh_error:
					"credential rejected — sign in again with gh/glab, then refresh.",
				reason: cooling,
			}),
		),
		"Couldn't refresh: credential rejected — sign in again with gh/glab, then refresh.",
		"a tracked row's failed attempt outranks a bare reason",
	);
	assert.equal(
		rowNotice(row({ reason: "backing off — this ref failed twice in a row" })),
		"backing off — this ref failed twice in a row",
		"a bare reason still speaks for a tracked row",
	);
	assert.equal(rowNotice(row()), null, "a cleanly-read row carries no notice");
});
