import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	INSTANT_LATENCY_DEFAULTS,
	PREFETCH_RECENT,
	instantChecks,
	instantConversationPlan,
	latencyRouteOf,
	newestMessageId,
	parseLatency,
	routeCountsBetween,
	stats,
} from "./team-bridge-instant-load.mjs";

/**
 * The `instant-load` scene's pure parts, without launching Electron.
 *
 * WHY THESE AND NOT A RENDER. The scene's one native launch is budgeted
 * evidence; what CAN be pinned cheaply is everything that decides whether that
 * launch's numbers mean anything: the latency table the stub applies, the
 * fixture's negative-control shape, the statistics, and above all that the
 * integrity gate FAILS when the instrument is blind (a control first visit with
 * no loading frame) - a rig that cannot be seen to fail is not evidence.
 */

test("the latency table defaults to the brief's numbers and refuses typos", () => {
	assert.deepEqual(parseLatency(null), {
		conversations: 200,
		messages: 150,
		directory: 80,
		status: 90,
		unread: 110,
	});
	assert.equal(parseLatency("messages:400").messages, 400);
	assert.equal(parseLatency("messages:400").status, 90);
	assert.deepEqual(parseLatency("unread:5", {}), { unread: 5 });
	assert.throws(() => parseLatency("mesages:400"), /unknown route "mesages"/);
	assert.throws(() => parseLatency("messages:1.5"), /integer/);
	assert.throws(() => parseLatency("messages:-1"), /integer/);
});

test("only the five named reads are delayed", () => {
	const B = "/v1/desktop/team-bridge";
	assert.equal(latencyRouteOf("GET", `${B}/status`), "status");
	assert.equal(latencyRouteOf("GET", `${B}/conversations`), "conversations");
	assert.equal(latencyRouteOf("GET", `${B}/directory`), "directory");
	assert.equal(latencyRouteOf("GET", `${B}/unread`), "unread");
	assert.equal(
		latencyRouteOf("GET", `${B}/conversations/c_x/messages`),
		"messages",
	);
	// Replies, writes, read markers and unrelated routes stay instant.
	assert.equal(
		latencyRouteOf("GET", `${B}/conversations/c_x/messages/m_1/replies`),
		null,
	);
	assert.equal(latencyRouteOf("POST", `${B}/conversations/c_x/messages`), null);
	assert.equal(latencyRouteOf("POST", `${B}/conversations/c_x/read`), null);
	assert.equal(latencyRouteOf("GET", "/v1/capabilities"), null);
	assert.equal(Object.keys(INSTANT_LATENCY_DEFAULTS).length, 5);
});

test("request counts are per-bucket deltas and surface surprises as other", () => {
	const before = [
		["GET /v1/desktop/team-bridge/conversations/c_a/messages?limit=50", 1],
	];
	const after = [
		["GET /v1/desktop/team-bridge/conversations/c_a/messages?limit=50", 3],
		["GET /v1/desktop/team-bridge/status", 1],
		["POST /v1/desktop/team-bridge/conversations/c_a/read", 1],
	];
	assert.deepEqual(routeCountsBetween(before, after), {
		status: 1,
		conversations: 0,
		directory: 0,
		unread: 0,
		messages: 2,
		other: 1,
	});
});

test("the fixture: 16 conversations, channels and agent DMs, a never-prefetched control half", () => {
	const plan = instantConversationPlan();
	assert.equal(plan.length, 16);
	assert.ok(plan.filter((r) => r.kind === "dm").length >= 5);
	assert.ok(plan.filter((r) => r.kind === "channel").length >= 5);
	assert.equal(
		new Set(plan.map((r) => r.id.slice(-6))).size,
		16,
		"message ids need unique suffixes",
	);
	assert.ok(plan.every((r) => r.count === 50));
	// Recency strictly decreasing, so the prefetcher's order is the plan's order.
	for (let i = 1; i < plan.length; i += 1)
		assert.ok(plan[i - 1].lastMessageAt > plan[i].lastMessageAt);
	// Unread rows sit inside the recent window, so the planner warms exactly
	// PREFETCH_RECENT rows and the rest are the negative control.
	assert.ok(
		plan.filter((r) => r.unread).every((r) => r.rank < PREFETCH_RECENT),
	);
	assert.equal(plan.filter((r) => r.prefetched).length, PREFETCH_RECENT);
	assert.equal(newestMessageId("c_instantload000003"), "m_000032_000003");
});

test("stats: median of even/odd sets, nulls dropped, empty is null", () => {
	assert.deepEqual(stats([30, 10, 20]), { n: 3, median: 20, max: 30, min: 10 });
	assert.deepEqual(stats([10, 20, 30, 40, null]), {
		n: 4,
		median: 25,
		max: 40,
		min: 10,
	});
	assert.deepEqual(stats([]), { n: 0, median: null, max: null, min: null });
});

const step = (overrides = {}) => ({
	ok: true,
	usableMs: 40,
	loadingFrames: 0,
	requests: { messages: 0 },
	...overrides,
});
const healthyRun = () => ({
	firstOpen: step({ usableMs: 250, loadingFrames: 6 }),
	warmOpens: Array.from({ length: 10 }, () => step({ usableMs: 60 })),
	switches: [
		{ phase: "first-visit", prefetched: true, ...step() },
		{
			phase: "first-visit",
			prefetched: false,
			...step({ usableMs: 190, loadingFrames: 9, requests: { messages: 1 } }),
		},
		...Array.from({ length: 10 }, () => ({
			phase: "warm",
			prefetched: true,
			...step(),
		})),
	],
});
const failing = (checks) =>
	checks.filter((c) => !c.ok).map((c) => `${c.kind}: ${c.name}`);

test("a healthy run passes every check", () => {
	assert.deepEqual(failing(instantChecks(healthyRun())), []);
});

test("NEGATIVE CONTROL: a probe blind to loading fails integrity, not silently passes", () => {
	const run = healthyRun();
	run.switches[1].loadingFrames = 0;
	assert.deepEqual(failing(instantChecks(run)), [
		"integrity: negative control: the probe saw loading frames on a never-prefetched first visit",
	]);
});

test("a control visit that never read history fails integrity", () => {
	const run = healthyRun();
	run.switches[1].requests.messages = 0;
	assert.match(
		failing(instantChecks(run)).join("\n"),
		/issued a \/messages read/,
	);
});

test("fewer than 10 warm samples, a refetching warm switch, or a slow open each fail", () => {
	const short = healthyRun();
	short.warmOpens.pop();
	assert.match(failing(instantChecks(short)).join("\n"), /at least 10 warm/);

	const refetch = healthyRun();
	refetch.switches.at(-1).requests.messages = 1;
	refetch.switches.at(-1).loadingFrames = 2;
	assert.deepEqual(failing(instantChecks(refetch)), [
		"integrity: warm switches issued no /messages read (served from the query cache)",
		"target: warm switches painted no loading frame",
	]);

	const slow = healthyRun();
	slow.firstOpen.usableMs = 300;
	slow.warmOpens[3].usableMs = 450;
	assert.deepEqual(failing(instantChecks(slow)), [
		"target: first open usable < 300 ms",
		"target: warm open max < 300 ms",
	]);

	const unusable = healthyRun();
	unusable.warmOpens[0] = step({ ok: false, usableMs: null });
	assert.match(
		failing(instantChecks(unusable)).join("\n"),
		/reached a usable frame/,
	);
});

test("the bench refuses a mistyped --latency before any launch", () => {
	const scratch = mkdtempSync(join(tmpdir(), "tb-instant-test-"));
	try {
		const run = spawnSync(
			process.execPath,
			[
				join(process.cwd(), "scripts", "team-bridge-bench.mjs"),
				"--scenario=instant-load",
				"--latency=mesages:1",
				`--scratch=${scratch}`,
			],
			{
				encoding: "utf8",
				env: { ...process.env, LOCAL_OPERATOR_SCRATCHPAD: "" },
			},
		);
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /unknown route "mesages"/);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

test("the control's prefetch window mirrors the app's own constant", async () => {
	// If the app's prefetch policy moves, the control's prefetched/cold split is
	// wrong; fail here, loudly, instead of in a budgeted native run.
	const { readFileSync } = await import("node:fs");
	const source = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/features/team-bridge/team-bridge-prefetch.ts",
		),
		"utf8",
	);
	const match = /export const TEAM_BRIDGE_PREFETCH_RECENT = (\d+);/.exec(
		source,
	);
	assert.ok(match, "TEAM_BRIDGE_PREFETCH_RECENT not found");
	assert.equal(Number(match[1]), PREFETCH_RECENT);
});
