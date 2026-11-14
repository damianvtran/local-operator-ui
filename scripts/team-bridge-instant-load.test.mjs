import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
	INSTANT_INPUT_LABEL,
	INSTANT_LATENCY_DEFAULTS,
	INSTANT_PROBE,
	PREFETCH_RECENT,
	buildPreflight,
	instantChecks,
	instantConversationPlan,
	instantShotDir,
	instantSummaryLines,
	latencyRouteOf,
	makeInstantShot,
	newestMessageId,
	parseLatency,
	routeCountsBetween,
	splitReads,
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
	dispatch: "rail-click",
	usableMs: 40,
	loadingFrames: 0,
	requests: { messages: 0 },
	blockingReads: { messages: 0 },
	backgroundReads: { messages: 0 },
	...overrides,
});
const open = (overrides = {}) => step({ dispatch: "nav-click", ...overrides });
const healthyRun = () => ({
	firstOpen: open({ usableMs: 250, loadingFrames: 6 }),
	warmOpens: Array.from({ length: 10 }, () => open({ usableMs: 60 })),
	switches: [
		{ phase: "first-visit", prefetched: true, ...step() },
		{
			phase: "first-visit",
			prefetched: false,
			...step({
				usableMs: 190,
				loadingFrames: 9,
				requests: { messages: 1 },
				blockingReads: { messages: 1 },
			}),
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
	refetch.switches.at(-1).blockingReads.messages = 1;
	refetch.switches.at(-1).loadingFrames = 2;
	assert.deepEqual(failing(instantChecks(refetch)), [
		"integrity: warm switches waited on no /messages read (painted from the query cache; background revalidations allowed)",
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

test("R1-1: an open that was not a nav-click, or a switch that was not a rail-click, fails integrity", () => {
	const hashed = healthyRun();
	hashed.warmOpens[4].dispatch = "hash";
	assert.deepEqual(failing(instantChecks(hashed)), [
		"integrity: every open was a nav-click on the sidebar row and every switch a rail-click",
	]);
	const missing = healthyRun();
	missing.firstOpen = open({ dispatch: "missing-nav-row" });
	assert.match(failing(instantChecks(missing)).join("\n"), /nav-click/);
	const noRow = healthyRun();
	noRow.switches[0].dispatch = "missing-row";
	assert.match(failing(instantChecks(noRow)).join("\n"), /rail-click/);
});

test("R1-2: a background revalidation on a warm switch is recorded, not counted as a wait", () => {
	assert.deepEqual(
		splitReads({
			issued: { messages: 1, unread: 2 },
			answeredByUsable: { messages: 0, unread: 1 },
		}),
		{
			requests: { messages: 1, unread: 2 },
			blockingReads: { messages: 0, unread: 1 },
			backgroundReads: { messages: 1, unread: 1 },
		},
	);
	const run = healthyRun();
	Object.assign(run.switches.at(-1), {
		requests: { messages: 1 },
		blockingReads: { messages: 0 },
		backgroundReads: { messages: 1 },
	});
	assert.deepEqual(failing(instantChecks(run)), []);
	// Missing accounting fails closed rather than passing.
	const blind = healthyRun();
	blind.switches.at(-1).blockingReads = undefined;
	assert.match(failing(instantChecks(blind)).join("\n"), /waited on no/);
});

/**
 * A minimal DOM for the in-page probe, enough to run its open path in a vm:
 * the sidebar row (optionally folded under More) and recorded dispatches.
 */
function fakePage({ rowVisible, moreExpanded = false }) {
	const events = [];
	const state = { rowVisible, hash: "#/" };
	const element = (name, attrs = {}) => ({
		name,
		getAttribute: (key) => attrs[key] ?? null,
		getBoundingClientRect: () => ({ x: 10, y: 10, width: 100, height: 24 }),
		contains: (other) => other === null,
		dispatchEvent: (event) => events.push(`${name}:${event.type}`),
	});
	const row = element("team-bridge-row");
	const more = element("more", {
		"aria-expanded": moreExpanded ? "true" : "false",
	});
	more.dispatchEvent = (event) => {
		events.push(`more:${event.type}`);
		if (event.type === "click") state.rowVisible = true;
	};
	const document = {
		querySelector: (selector) => {
			if (selector.includes('data-sidebar-row="team-bridge"'))
				return state.rowVisible ? row : null;
			if (selector === "[data-sidebar-more]") return more;
			return null;
		},
		querySelectorAll: () => [],
		elementFromPoint: () => row,
	};
	class Ev {
		constructor(type) {
			this.type = type;
		}
	}
	const window = {
		location: {
			get hash() {
				return state.hash;
			},
			set hash(value) {
				state.hash = value;
			},
		},
	};
	const context = {
		window,
		document,
		PointerEvent: Ev,
		MouseEvent: Ev,
		performance: { now: () => 0 },
		requestAnimationFrame: (fn) => setImmediate(fn),
	};
	runInNewContext(INSTANT_PROBE, context);
	return { probe: window.__tbInstant, events, state };
}

test("R1-1: the probe never falls back to a hash navigation when the sidebar row is missing", async () => {
	const page = fakePage({ rowVisible: false });
	const result = await page.probe.run({
		mode: "open",
		expectRail: 16,
		newest: "000032",
		timeoutMs: 50,
	});
	assert.equal(result.ok, false);
	assert.equal(result.dispatch, "missing-nav-row");
	assert.equal(page.state.hash, "#/", "no hash fallback");
	assert.deepEqual(page.events, []);
});

test("R1-1: revealNav opens More (setup), then the open presses the real sidebar row", async () => {
	const page = fakePage({ rowVisible: false });
	// The probe's objects come from the vm realm; compare their JSON shape.
	assert.deepEqual(JSON.parse(JSON.stringify(await page.probe.revealNav())), {
		ok: true,
		via: "more-fold",
	});
	assert.ok(page.events.includes("more:click"));
	page.events.length = 0;
	const result = await page.probe.run({
		mode: "open",
		expectRail: 16,
		newest: "000032",
		timeoutMs: -1,
	});
	assert.equal(result.dispatch, "nav-click");
	assert.equal(result.hit, true);
	assert.deepEqual(page.events, [
		"team-bridge-row:pointerdown",
		"team-bridge-row:mousedown",
		"team-bridge-row:pointerup",
		"team-bridge-row:mouseup",
		"team-bridge-row:click",
	]);
	assert.equal(page.state.hash, "#/");
	// An already-expanded More is not toggled shut by a second reveal.
	const open = fakePage({ rowVisible: false, moreExpanded: true });
	await open.probe.revealNav();
	assert.ok(!open.events.includes("more:click"));
});

test("R1-5: the summary prints the scene's numbers, never undefined", () => {
	const lines = instantSummaryLines({
		scenario: "instant-load",
		targetMs: 300,
		evidence: "SYNTHETIC BACKEND",
		input: INSTANT_INPUT_LABEL,
		host: { loadavg: [3.21, 2, 1], cpus: 14 },
		firstOpen: { dispatch: "nav-click", loadingFrames: 4 },
		summary: {
			firstOpenMs: 212.4,
			dispatch: {
				opens: { "nav-click": 11 },
				switches: { "rail-click": 26 },
				missedHitTest: 0,
			},
			warmSwitchBackgroundRefetches: 2,
			warmOpen: { n: 10, median: 60, max: 80, min: 50 },
			warmSwitch: { n: 12, median: 30, max: 45, min: 20 },
			firstVisitPrefetched: { n: 7, median: 35, max: 40, min: 30 },
			firstVisitNeverPrefetched_control: {
				n: 7,
				median: 190,
				max: 220,
				min: 170,
			},
		},
		shots: {
			controlLoading: {
				path: "/x/run-1/06.png",
				loading: { before: true, after: true },
			},
		},
	});
	const text = lines.join("\n");
	assert.doesNotMatch(text, /undefined/);
	assert.match(text, /first open: 212.4ms \(dispatch=nav-click/);
	assert.match(text, /warm switch: n=12 median=30ms max=45ms/);
	assert.match(text, /background refetches=2/);
	assert.match(text, /synthetic in-page DOM dispatch/);
	assert.match(text, /"nav-click":11/);
	assert.match(text, /06\.png \(loading at capture: yes\/yes\)/);
	assert.match(text, /loadavg=3\.2\/2\.0\/1\.0 cpus=14/);
});

test("R1-4: every shot records whether loading was on screen, in a run-unique dir", async () => {
	const a = instantShotDir("/base", new Date("2026-11-12T10:00:00.000Z"), 7);
	const b = instantShotDir("/base", new Date("2026-11-12T10:00:00.001Z"), 7);
	assert.equal(a, "/base/run-2026-11-12T10-00-00-000Z-7");
	assert.notEqual(a, b);
	const written = [];
	const reads = [true, false];
	let settles = 0;
	const shot = makeInstantShot({
		dir: a,
		settle: async () => {
			settles += 1;
		},
		capture: async () => "png",
		loadingNow: async () => reads.shift(),
		write: (path, png) => written.push([path, png]),
	});
	assert.deepEqual(
		await shot("06-control-loading-unsettled", { settled: false }),
		{
			path: `${a}/06-control-loading-unsettled.png`,
			settled: false,
			loading: { before: true, after: false },
		},
	);
	assert.equal(settles, 0, "an unsettled shot does not wait for settle");
	assert.deepEqual(written, [[`${a}/06-control-loading-unsettled.png`, "png"]]);
});

test("QA B1: the preflight names a missing build variable or dependency as SETUP, without values", () => {
	const root = mkdtempSync(join(tmpdir(), "tb-preflight-"));
	try {
		cpSync(
			join(process.cwd(), "electron.vite.config.js"),
			join(root, "electron.vite.config.js"),
		);
		cpSync(
			join(process.cwd(), "scripts", "vite-plugins"),
			join(root, "scripts", "vite-plugins"),
			{ recursive: true },
		);
		const env = {
			VITE_GOOGLE_CLIENT_ID: "SENTINEL-VALUE-7f3a",
			VITE_GOOGLE_CLIENT_SECRET: "SENTINEL-VALUE-7f3a",
			VITE_MICROSOFT_CLIENT_ID: "SENTINEL-VALUE-7f3a",
			VITE_MICROSOFT_TENANT_ID: "",
		};
		const bare = buildPreflight({ root, env });
		assert.equal(bare.ok, false);
		assert.deepEqual(bare.requiredEnv.toSorted(), Object.keys(env).toSorted());
		const failed = bare.checks.filter((c) => !c.ok).map((c) => c.name);
		assert.ok(failed.some((n) => /dependency tree present/.test(n)));
		assert.ok(failed.some((n) => /lock matches/.test(n)));
		assert.ok(failed.some((n) => /VITE_MICROSOFT_TENANT_ID/.test(n)));
		assert.ok(!failed.some((n) => /VITE_GOOGLE_CLIENT_ID/.test(n)));
		assert.doesNotMatch(
			JSON.stringify(bare),
			/SENTINEL-VALUE/,
			"values never surface",
		);

		mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
		mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true });
		mkdirSync(join(root, "node_modules", "electron", "dist"), {
			recursive: true,
		});
		writeFileSync(join(root, "node_modules", ".bin", "electron-vite"), "");
		writeFileSync(join(root, "pnpm-lock.yaml"), "lock: a\n");
		writeFileSync(
			join(root, "node_modules", ".pnpm", "lock.yaml"),
			"lock: b\n",
		);
		env.VITE_MICROSOFT_TENANT_ID = "SENTINEL-VALUE-7f3a";
		const mismatched = buildPreflight({ root, env });
		assert.deepEqual(
			mismatched.checks.filter((c) => !c.ok).map((c) => c.name),
			["installed dependency lock matches pnpm-lock.yaml"],
		);
		writeFileSync(
			join(root, "node_modules", ".pnpm", "lock.yaml"),
			"lock: a\n",
		);
		assert.equal(buildPreflight({ root, env }).ok, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
