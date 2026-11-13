/**
 * `--scenario=instant-load` for `scripts/team-bridge-bench.mjs`: the acceptance
 * timing scene for the operator's bridge-instant-load target.
 *
 * RUN RECIPE (from the checkout root; one build, one launch). The build refuses
 * to load its config unless four variables are non-empty
 * (`scripts/vite-plugins/replace-backend-config.ts`, derived by
 * `scripts/check-build-env.mjs`). The values below are INERT placeholders: no
 * credential is created or read, no `.env` is needed, no sign-in is claimed.
 * The preflight runs first so a missing dependency tree or variable fails as
 * SETUP, never as a build error that reads like an app result (QA round 1, B1).
 *
 *     export VITE_GOOGLE_CLIENT_ID=evidence-build-only-not-a-credential \
 *            VITE_GOOGLE_CLIENT_SECRET=evidence-build-only-not-a-credential \
 *            VITE_MICROSOFT_CLIENT_ID=evidence-build-only-not-a-credential \
 *            VITE_MICROSOFT_TENANT_ID=evidence-build-only-not-a-credential
 *     node scripts/team-bridge-instant-load.mjs --preflight --root "$PWD" &&
 *         node_modules/.bin/electron-vite build &&
 *         node scripts/team-bridge-bench.mjs --scenario=instant-load --root "$PWD" \
 *             --json "$LOCAL_OPERATOR_SCRATCHPAD/instant.json" \
 *             --shots "$LOCAL_OPERATOR_SCRATCHPAD/instant-shots"
 *
 * `--shots` is a BASE directory: each run writes into its own
 * `run-<timestamp>-<pid>/` below it, so frames from an earlier or aborted run
 * can never pass for this run's (R1-4). Nothing is deleted.
 *
 * THE TARGET IT MEASURES (operator, verbatim in the project brief): "opening Team
 * Bridge + channels/agent DMs/sidebar <300ms, conversation switches feel
 * instant". Three fixes shipped toward it (UI #1869 prefetch; core #3810/#3863);
 * this scene is what turns "should be faster now" into a number on the built app.
 *
 * WHY HERE AND NOT IN `renderer-driver.mjs`. The bench already owns the one
 * Team Bridge stub daemon in this repository (synthetic fixtures for every read
 * route, record discovery, claim exchange, headless `--window-mode=headless`
 * launch, exact-pid reaping). A renderer-driver scene would need a second Team
 * Bridge stub, i.e. two rigs that drift. The scene is its own module for the same
 * reason the driver's scenes are: the bench file is already large, and the pure
 * pieces here (latency table, fixture plan, statistics, the integrity gate) are
 * unit-tested without launching Electron (`team-bridge-instant-load.test.mjs`).
 *
 * WHAT A RESULT FROM THIS SCENE MAY CLAIM. SYNTHETIC BACKEND: the page, React
 * tree, router, query cache, markdown renderer and IPC hop are the real built app;
 * the WIRE is the bench stub with fixed per-route latencies standing in for the
 * hub (`INSTANT_LATENCY_DEFAULTS`). It is never live-hub end-to-end evidence and
 * says so in its own report (`evidence`). It also measures whatever `out/` the
 * `--root` checkout holds: a renderer source build, not the installed `.app`.
 *
 * WHAT "USABLE" MEANS, and why it is not "the click handler returned". The clock
 * starts at the pointerdown of a SYNTHETIC in-page DOM click sequence
 * (`dispatchEvent`, untrusted events; see INSTANT_INPUT_LABEL) on the real
 * control - the sidebar's `[data-sidebar-row="team-bridge"]` button, with the
 * More fold opened beforehand outside the window, and the rail row - and stops at the second rAF after the first frame in
 * which ALL of these hold (sampled every animation frame by an in-page probe):
 *   - open:   the rail lists every fixture conversation, no skeleton/loading
 *             placeholder is on screen, and the timeline holds rows of exactly ONE
 *             conversation including that conversation's newest message;
 *   - switch: no skeleton is on screen and the timeline holds the TARGET
 *             conversation's newest message and no row of any other conversation.
 * The fixture's message ids encode the conversation (`m_<seq hex>_<id last 6>`),
 * so "correct rendered messages" is an identity check, not a row count.
 *
 * THE NEGATIVE CONTROL IS BUILT INTO THE FIXTURE, in the same launch (one native
 * launch is the budget). The prefetcher (`team-bridge-prefetch.ts`) warms unread
 * rows first, then the 8 most recent. The fixture marks only the 4 most recent
 * unread, so ranks 8..15 by recency are NEVER planned: their first visit must
 * show loading frames and issue a `/messages` read. If the probe reports zero
 * loading frames there, the probe cannot see loading and every "0 loading frames"
 * elsewhere is worthless - the run fails its integrity gate rather than passing.
 * Rank 15 is reserved for a deliberately un-settled screenshot of that loading
 * state and is excluded from the statistics.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { defaultVitePlugins, requiredBuildEnv } from "./check-build-env.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/**
 * What the measured window does and does not include (R1-3, QA N1), carried in
 * every report so a number is never quoted as end-to-end input latency.
 */
export const INSTANT_INPUT_LABEL =
	"synthetic in-page DOM dispatch (untrusted PointerEvent/MouseEvent via dispatchEvent on the real control); excludes the OS/compositor input pipeline and browser hit-testing";

/** Per-route stub latency (ms) the operator's brief fixed for this scene. */
export const INSTANT_LATENCY_DEFAULTS = Object.freeze({
	conversations: 200,
	messages: 150,
	directory: 80,
	status: 90,
	unread: 110,
});

/** The bar the operator set, applied to opens and to warm switches. */
export const INSTANT_TARGET_MS = 300;
/** Advisory only: what "feels instant" usually means for a switch. */
export const INSTANT_FEEL_MS = 100;
export const INSTANT_CONVERSATIONS = 16;
export const INSTANT_MESSAGES = 50;
/** Mirrors `TEAM_BRIDGE_PREFETCH_RECENT`; the control depends on it (see header). */
export const PREFETCH_RECENT = 8;
const UNREAD_RANKS = 4;

/**
 * Parse `--latency=conversations:200,messages:150`. Unknown keys and non-integer
 * values are refused: a typo that silently ran at 0 ms would be a fast lie.
 */
export function parseLatency(spec, defaults = INSTANT_LATENCY_DEFAULTS) {
	const table = { ...defaults };
	if (spec === null || spec === undefined || spec === "") return table;
	for (const part of String(spec).split(",")) {
		const [key, raw] = part.split(":");
		if (!(key in INSTANT_LATENCY_DEFAULTS))
			throw new Error(
				`--latency: unknown route "${key}"; known: ${Object.keys(INSTANT_LATENCY_DEFAULTS).join(", ")}`,
			);
		const value = Number(raw);
		if (!Number.isInteger(value) || value < 0 || value > 60_000)
			throw new Error(`--latency: ${key} needs an integer 0..60000 ms`);
		table[key] = value;
	}
	return table;
}

const BRIDGE = "/v1/desktop/team-bridge";
const MESSAGES_ROUTE =
	/^\/v1\/desktop\/team-bridge\/conversations\/[^/]+\/messages$/;

/**
 * Which latency bucket a stub request belongs to, or null (no delay). Only the
 * reads the brief named; writes, replies, reads markers and avatars stay instant
 * so they cannot inflate the measured window by accident.
 */
export function latencyRouteOf(method, path) {
	if (method !== "GET") return null;
	if (path === `${BRIDGE}/status`) return "status";
	if (path === `${BRIDGE}/conversations`) return "conversations";
	if (path === `${BRIDGE}/directory`) return "directory";
	if (path === `${BRIDGE}/unread`) return "unread";
	if (MESSAGES_ROUTE.test(path)) return "messages";
	return null;
}

/**
 * Requests per latency bucket between two `stub.seen()` snapshots
 * (`[["GET /path?query", count], ...]`). Keys outside the buckets count as
 * `other`, so a surprise request shows up instead of vanishing.
 */
export function routeCountsBetween(before, after) {
	const prior = new Map(before);
	const counts = {
		status: 0,
		conversations: 0,
		directory: 0,
		unread: 0,
		messages: 0,
		other: 0,
	};
	for (const [key, value] of after) {
		const delta = value - (prior.get(key) ?? 0);
		if (delta <= 0) continue;
		const [method, target] = key.split(" ");
		const path = (target ?? "").split("?")[0];
		const bucket = latencyRouteOf(method, path) ?? "other";
		counts[bucket] += delta;
	}
	return counts;
}

/**
 * Split a step's reads into BLOCKING and BACKGROUND (agent review round 1, R1-2).
 *
 * WHY. A cached conversation past its 30 s `staleTime` paints from the query
 * cache instantly AND starts a refetch on mount. Counting every `/messages` read
 * as "not served from cache" would fail a run on a machine that is merely slow
 * to reach the warm pass, while the user saw no wait at all. What the user waits
 * on is a read whose RESPONSE was needed for the usable frame, so:
 *   - `blockingReads`: answered by the stub before the scene saw "usable";
 *   - `backgroundReads`: issued in the window but still in flight at "usable"
 *     (a revalidation the page did not wait for).
 * "Answered by usable" is read when the probe's promise returns, i.e. two rAFs
 * plus one CDP hop after the detecting frame, so a refetch answered in that
 * slack is counted as blocking. The error only ever leans toward failing.
 * `requests` stays the total issued (the negative control needs any read).
 */
export function splitReads({ issued, answeredByUsable }) {
	const blockingReads = {};
	const backgroundReads = {};
	for (const [bucket, count] of Object.entries(issued)) {
		const blocking = Math.min(count, answeredByUsable[bucket] ?? 0);
		blockingReads[bucket] = blocking;
		backgroundReads[bucket] = count - blocking;
	}
	return { requests: issued, blockingReads, backgroundReads };
}

/**
 * The 16-conversation plan, NEWEST FIRST: 10 channels and 6 agent DMs
 * interleaved, 50 markdown messages each, unread only on the 4 most recent (the
 * header's negative control). Ids end in a unique 6-char suffix because message
 * ids carry it.
 */
export function instantConversationPlan() {
	const plan = [];
	for (let rank = 0; rank < INSTANT_CONVERSATIONS; rank += 1) {
		const isDm = rank % 3 === 1 || rank === 14;
		const nn = String(rank + 1).padStart(2, "0");
		plan.push({
			id: `c_instantload0000${nn}`,
			rank,
			kind: isDm ? "dm" : "channel",
			name: isDm ? `Agent DM ${nn}` : `Instant channel ${nn}`,
			count: INSTANT_MESSAGES,
			unread: rank < UNREAD_RANKS,
			prefetched: rank < Math.max(UNREAD_RANKS, PREFETCH_RECENT),
			// Strictly decreasing, so recency order is unambiguous.
			lastMessageAt: new Date(
				Date.UTC(2026, 10, 1) - rank * 3_600_000,
			).toISOString(),
		});
	}
	return plan;
}

/** The newest message id the fixture serves for a conversation. */
export function newestMessageId(conversationId, count = INSTANT_MESSAGES) {
	return `m_${count.toString(16).padStart(6, "0")}_${conversationId.slice(-6)}`;
}

/** n / median / max / min of measured ms (nulls are failures, not samples). */
export function stats(values) {
	const measured = values.filter((value) => typeof value === "number");
	if (measured.length === 0)
		return { n: 0, median: null, max: null, min: null };
	const sorted = [...measured].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	const round = (value) => Math.round(value * 10) / 10;
	return {
		n: measured.length,
		median: round(median),
		max: round(sorted.at(-1)),
		min: round(sorted[0]),
	};
}

/**
 * The checks a run is judged by. `integrity` checks say whether the instrument
 * measured what it claims; `target` checks are the operator's bar. Both gate the
 * exit code through the bench's `applyGate`, but the kinds stay labelled so a
 * reader can tell "the app is slow" from "the rig is blind".
 */
export function instantChecks({ firstOpen, warmOpens, switches }) {
	const firstVisits = switches.filter((s) => s.phase === "first-visit");
	const control = firstVisits.filter((s) => !s.prefetched);
	const warm = switches.filter((s) => s.phase === "warm");
	const warmOpenStats = stats(warmOpens.map((o) => o.usableMs));
	const warmSwitchStats = stats(warm.map((s) => s.usableMs));
	const all = [firstOpen, ...warmOpens, ...switches];
	return [
		{
			kind: "integrity",
			name: "every open and switch reached a usable frame",
			ok: all.every((step) => step?.ok === true),
		},
		{
			/* R1-1: the headline number is a CLICK on the real sidebar row and rail
			   row. Any other dispatch (a missing row) means the rig measured
			   something else, so it is integrity, not a slow app. */
			kind: "integrity",
			name: "every open was a nav-click on the sidebar row and every switch a rail-click",
			ok:
				[firstOpen, ...warmOpens].every((s) => s?.dispatch === "nav-click") &&
				switches.every((s) => s?.dispatch === "rail-click"),
		},
		{
			kind: "integrity",
			name: "at least 10 warm opens and 10 warm switches were measured",
			ok: warmOpenStats.n >= 10 && warmSwitchStats.n >= 10,
		},
		{
			kind: "integrity",
			name: "negative control: every never-prefetched first visit issued a /messages read",
			ok: control.length > 0 && control.every((s) => s.requests.messages >= 1),
		},
		{
			kind: "integrity",
			name: "negative control: the probe saw loading frames on a never-prefetched first visit",
			ok: control.some((s) => s.loadingFrames > 0),
		},
		{
			kind: "integrity",
			name: "warm switches waited on no /messages read (painted from the query cache; background revalidations allowed)",
			ok: warm.every((s) => s.blockingReads?.messages === 0),
		},
		{
			kind: "target",
			name: `first open usable < ${INSTANT_TARGET_MS} ms`,
			ok:
				typeof firstOpen?.usableMs === "number" &&
				firstOpen.usableMs < INSTANT_TARGET_MS,
		},
		{
			kind: "target",
			name: `warm open max < ${INSTANT_TARGET_MS} ms`,
			ok: warmOpenStats.max !== null && warmOpenStats.max < INSTANT_TARGET_MS,
		},
		{
			kind: "target",
			name: `warm switch max < ${INSTANT_TARGET_MS} ms`,
			ok:
				warmSwitchStats.max !== null && warmSwitchStats.max < INSTANT_TARGET_MS,
		},
		{
			kind: "target",
			name: "warm switches painted no loading frame",
			ok: warm.length > 0 && warm.every((s) => s.loadingFrames === 0),
		},
	];
}

/**
 * The in-page probe. Installed once per page load; every measurement is one
 * `__tbInstant.run(...)` call so the click and the frame sampling share a clock
 * and no CDP round trip sits inside the measured window.
 */
export const INSTANT_PROBE = `(() => {
	const probe = {};
	window.__tbInstant = probe;
	const suffixOf = (id) => (id || "").split("_")[2] || "";
	/* Loading = a skeleton placeholder inside one of the bridge's <output> loading
	   regions (RailLoading, TeamBridgeMessageSkeleton) or the eligibility gate's
	   status spinner. Background refreshes (aria-busy) are deliberately NOT loading:
	   they keep the previous rows on screen. */
	probe.loadingNow = () =>
		!!document.querySelector('output[aria-label] [data-glass-placeholder], [data-glass-region="canvas"] [role="status"]');
	probe.read = (target) => {
		const rail = new Set([...document.querySelectorAll("[data-conversation-id]")].map((n) => n.getAttribute("data-conversation-id")));
		const ids = [...document.querySelectorAll("[data-message-id]")].map((n) => n.getAttribute("data-message-id") || "");
		const suffixes = new Set(ids.map(suffixOf));
		return {
			railRows: rail.size,
			messageRows: ids.length,
			suffixes: [...suffixes],
			loading: probe.loadingNow(),
			newest: target ? ids.includes(target.newest) : false,
			foreign: target ? ids.filter((id) => suffixOf(id) !== target.suffix).length : 0,
		};
	};
	/* SYNTHETIC IN-PAGE DISPATCH (agent review round 1, R1-3; QA N1): untrusted
	   PointerEvent/MouseEvent objects via dispatchEvent. They run the control's
	   real React handlers, but skip the OS/compositor input pipeline and the
	   browser's own hit-test, so a measured window excludes input latency. The
	   return value records whether the press point would have hit the control
	   (elementFromPoint), so a covered or off-screen control is visible in the
	   report rather than "clicked" silently. */
	probe.press = (element) => {
		const rect = element.getBoundingClientRect();
		const x = rect.x + rect.width / 2;
		const y = rect.y + Math.min(rect.height / 2, 12);
		const topmost = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
		const hit = !!topmost && (topmost === element || element.contains(topmost));
		const init = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + Math.min(rect.height / 2, 12), view: window };
		element.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1, pointerId: 1, isPrimary: true, pointerType: "mouse" }));
		element.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
		element.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, pointerId: 1, isPrimary: true, pointerType: "mouse" }));
		element.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
		element.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }));
		return { hit };
	};
	/* THE REAL SIDEBAR ROW, and nothing else (agent review round 1, R1-1). The
	   row is a <button> inside <li data-sidebar-row="team-bridge"> that calls
	   navigate(); its sibling ellipsis (data-sidebar-row-menu) opens a menu, so it
	   is excluded. There is deliberately NO label/href heuristic and NO hash
	   fallback: the old lookup matched nothing in the app (the row is not an <a>,
	   its text carries the unread badge) and every open silently became a hash
	   assignment reported beside a "click". A missing row now fails the step. */
	probe.navControl = () =>
		document.querySelector('[data-sidebar-row="team-bridge"] button:not([data-sidebar-row-menu])');
	/* Team Bridge defaults into the sidebar's More fold, whose rows exist in the
	   DOM only while More is revealed. Pressing More is setup, so the scene calls
	   this OUTSIDE the timed window and waits two frames for the fold to render;
	   the press persists the fold open, so later opens find the row directly. */
	probe.revealNav = () => new Promise((resolveReveal) => {
		if (probe.navControl()) return resolveReveal({ ok: true, via: "already-visible" });
		const more = document.querySelector("[data-sidebar-more]");
		if (!more) return resolveReveal({ ok: false, via: "no-more-control" });
		if (more.getAttribute("aria-expanded") !== "true") probe.press(more);
		requestAnimationFrame(() => requestAnimationFrame(() =>
			resolveReveal({ ok: !!probe.navControl(), via: "more-fold" })));
	});
	probe.run = (spec) => new Promise((resolveRun) => {
		const { mode, conversationId, expectRail, newest, timeoutMs } = spec;
		const target = conversationId ? { suffix: conversationId.slice(-6), newest } : null;
		let element = null;
		let dispatch = "none";
		if (mode === "open") {
			element = probe.navControl();
			dispatch = element ? "nav-click" : "missing-nav-row";
		} else {
			element = document.querySelector('[data-conversation-id="' + conversationId + '"]');
			dispatch = element ? "rail-click" : "missing-row";
		}
		if (!element)
			return resolveRun({ ok: false, dispatch, reason: mode === "open" ? "Team Bridge sidebar row not rendered" : "rail row not rendered", frames: 0, loadingFrames: 0, usableMs: null });
		const frames = [];
		const t0 = performance.now();
		const { hit } = probe.press(element);
		const usable = (s) => {
			if (s.loading) return false;
			if (mode === "open") {
				if (s.railRows < expectRail || s.suffixes.length !== 1 || s.messageRows === 0) return false;
				const suffix = s.suffixes[0];
				return document.querySelector('[data-message-id$="_' + suffix + '"][data-message-id^="m_' + newest + '_"]') !== null;
			}
			return s.newest && s.foreign === 0;
		};
		const tick = () => {
			const s = probe.read(target);
			const t = performance.now() - t0;
			frames.push({ t: Math.round(t), loading: s.loading, rows: s.messageRows, rail: s.railRows });
			if (usable(s)) {
				requestAnimationFrame(() => requestAnimationFrame(() => {
					resolveRun({
						ok: true,
						dispatch,
						hit,
						/* The detecting frame's own time (R1-7): usableMs adds the two
						   rAFs that prove the frame was presented, so the margin shows. */
						detectedMs: Math.round(t * 10) / 10,
						usableMs: Math.round((performance.now() - t0) * 10) / 10,
						frames: frames.length,
						loadingFrames: frames.filter((f) => f.loading).length,
						firstContentMs: frames.find((f) => f.rows > 0)?.t ?? null,
						selected: s.suffixes[0] ?? null,
						railRows: s.railRows,
						messageRows: s.messageRows,
					});
				}));
				return;
			}
			if (t > timeoutMs) {
				resolveRun({ ok: false, dispatch, hit, usableMs: null, reason: "no usable frame within " + timeoutMs + " ms", frames: frames.length, loadingFrames: frames.filter((f) => f.loading).length, last: s });
				return;
			}
			requestAnimationFrame(tick);
		};
		/* The first sample is taken in the frame AFTER dispatch: a sample taken
		   synchronously would read the pre-click DOM and could pass a switch to a
		   conversation that is already on screen. */
		requestAnimationFrame(tick);
	});
	return { ok: true };
})()`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Wait until the stub has seen no new request for `quietMs` (prefetch drained). */
async function waitQuiet(stub, quietMs = 1_000, timeoutMs = 15_000) {
	const started = Date.now();
	let last = JSON.stringify(stub.seen());
	let since = Date.now();
	while (Date.now() - started < timeoutMs) {
		await sleep(100);
		const now = JSON.stringify(stub.seen());
		if (now !== last) {
			last = now;
			since = Date.now();
		} else if (Date.now() - since >= quietMs) return true;
	}
	return false;
}

/**
 * Drive the scene. `evaluate` is the bench's CDP evaluate (awaitPromise),
 * `shot(name, {settled})` writes a PNG and returns its record
 * (`makeInstantShot`: path, settled, loading before/after capture).
 */
export async function runInstantLoad({
	evaluate,
	stub,
	shot,
	plan,
	latency,
	warmOpens: warmOpenCount = 10,
	warmSwitches: warmSwitchCount = 12,
}) {
	const newestHex = INSTANT_MESSAGES.toString(16).padStart(6, "0");
	const measureStep = async (spec) => {
		/*
		 * Setup OUTSIDE the timed window (R1-1): an open needs the real sidebar
		 * row on screen, which may mean pressing More first. If it cannot be
		 * revealed the step still runs and fails as `missing-nav-row`; there is no
		 * hash fallback that could be mistaken for a click.
		 */
		const reveal =
			spec.mode === "open"
				? await evaluate("window.__tbInstant.revealNav()")
				: null;
		const before = stub.seen();
		const answeredBefore = stub.answered();
		const result = await evaluate(
			`window.__tbInstant.run(${JSON.stringify({ timeoutMs: 10_000, expectRail: plan.length, newest: newestHex, ...spec })})`,
		);
		const answeredAtUsable = stub.answered();
		// The window's requests include the ones still in flight at "usable", so
		// give the wire one latency's worth of time before reading the counts.
		await sleep(Math.max(...Object.values(latency)) + 50);
		return {
			...result,
			...(reveal ? { reveal } : {}),
			...splitReads({
				issued: routeCountsBetween(before, stub.seen()),
				answeredByUsable: routeCountsBetween(answeredBefore, answeredAtUsable),
			}),
		};
	};
	// Leaving is setup, not measurement: a hash assignment is fine HERE because
	// nothing is timed until the next open presses the real sidebar row.
	const leave = async () => {
		await evaluate(`(() => { window.location.hash = "#/"; return true; })()`);
		await sleep(400);
		await evaluate(INSTANT_PROBE);
	};
	const shots = {};

	await evaluate(INSTANT_PROBE);
	await leave();
	const firstOpen = await measureStep({ mode: "open" });
	shots.firstOpen = await shot("01-first-open-usable", { settled: true });
	await waitQuiet(stub);

	const warmOpens = [];
	for (let index = 0; index < warmOpenCount; index += 1) {
		await leave();
		await sleep(300);
		warmOpens.push(await measureStep({ mode: "open" }));
	}
	shots.warmOpen = await shot("02-warm-open-usable", { settled: true });
	await waitQuiet(stub);

	const switches = [];
	const reserved = plan.at(-1);
	// The conversation the first open auto-selected is already on screen; a
	// "switch" to it would measure nothing.
	const visitOrder = plan.filter(
		(row) => row !== reserved && row.id.slice(-6) !== firstOpen.selected,
	);
	for (const row of visitOrder) {
		const step = await measureStep({
			mode: "switch",
			conversationId: row.id,
			newest: newestMessageId(row.id),
		});
		switches.push({
			phase: "first-visit",
			conversation: row.id,
			kind: row.kind,
			rank: row.rank,
			prefetched: row.prefetched,
			...step,
		});
		if (row.rank === PREFETCH_RECENT)
			shots.controlSettled = await shot("04-control-first-visit-settled", {
				settled: true,
			});
		await sleep(250);
	}
	shots.prefetchedSwitch = await shot("03-after-first-visit-pass", {
		settled: true,
	});
	await waitQuiet(stub);

	const visited = visitOrder;
	for (let index = 0; index < warmSwitchCount; index += 1) {
		const row = visited[(index * 5 + 3) % visited.length];
		const step = await measureStep({
			mode: "switch",
			conversationId: row.id,
			newest: newestMessageId(row.id),
		});
		switches.push({
			phase: "warm",
			conversation: row.id,
			kind: row.kind,
			rank: row.rank,
			prefetched: row.prefetched,
			...step,
		});
		await sleep(250);
	}
	shots.warmSwitch = await shot("05-warm-switch-usable", { settled: true });

	// The reserved never-prefetched row: an UN-settled frame right after the
	// click, to photograph the loading state the control detects. Excluded from
	// the statistics because the screenshot sits inside its window.
	await evaluate(
		`(() => { const n = document.querySelector('[data-conversation-id="${reserved.id}"]'); if (n) window.__tbInstant.press(n); return !!n; })()`,
	);
	shots.controlLoading = await shot("06-control-loading-unsettled", {
		settled: false,
	});

	const checks = instantChecks({ firstOpen, warmOpens, switches });
	const firstVisits = switches.filter((s) => s.phase === "first-visit");
	const warm = switches.filter((s) => s.phase === "warm");
	return {
		scenario: "instant-load",
		evidence:
			"SYNTHETIC BACKEND: real built renderer + main over the bench stub daemon with fixed per-route latencies; not live-hub end-to-end, not the installed .app",
		input: INSTANT_INPUT_LABEL,
		// QA N2: a miss under heavy contention reads differently from one on an
		// idle machine, so the run carries the load it was taken under.
		host: { loadavg: loadavg(), cpus: cpus().length },
		latencyMs: latency,
		fixture: {
			conversations: plan.length,
			channels: plan.filter((r) => r.kind === "channel").length,
			agentDms: plan.filter((r) => r.kind === "dm").length,
			messagesEach: INSTANT_MESSAGES,
		},
		targetMs: INSTANT_TARGET_MS,
		summary: {
			firstOpenMs: firstOpen.usableMs,
			dispatch: {
				opens: countBy([firstOpen, ...warmOpens].map((s) => s.dispatch)),
				switches: countBy(switches.map((s) => s.dispatch)),
				missedHitTest: [firstOpen, ...warmOpens, ...switches].filter(
					(s) => s.hit === false,
				).length,
			},
			warmSwitchBackgroundRefetches: warm.reduce(
				(sum, s) => sum + (s.backgroundReads?.messages ?? 0),
				0,
			),
			warmOpen: stats(warmOpens.map((o) => o.usableMs)),
			firstVisitPrefetched: stats(
				firstVisits.filter((s) => s.prefetched).map((s) => s.usableMs),
			),
			firstVisitNeverPrefetched_control: stats(
				firstVisits.filter((s) => !s.prefetched).map((s) => s.usableMs),
			),
			warmSwitch: stats(
				switches.filter((s) => s.phase === "warm").map((s) => s.usableMs),
			),
			loadingFrames: {
				firstOpen: firstOpen.loadingFrames,
				warmOpens: warmOpens.map((o) => o.loadingFrames),
				firstVisitPrefetched: firstVisits
					.filter((s) => s.prefetched)
					.map((s) => s.loadingFrames),
				control: firstVisits
					.filter((s) => !s.prefetched)
					.map((s) => s.loadingFrames),
				warmSwitches: switches
					.filter((s) => s.phase === "warm")
					.map((s) => s.loadingFrames),
			},
		},
		firstOpen,
		warmOpens,
		switches,
		shots,
		checks,
	};
}

/** `{value: count}` for a list of labels (dispatch kinds in the summary). */
export function countBy(values) {
	const counts = {};
	for (const value of values) {
		const key = String(value ?? "none");
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

/**
 * A run-unique directory under the `--shots` base (R1-4). Fixed file names in a
 * persistent directory let an aborted run leave the previous run's frames in
 * place looking current; a per-run subdirectory makes that impossible without
 * deleting anything the operator put there.
 */
export function instantShotDir(base, now = new Date(), pid = process.pid) {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	return join(resolve(base), `run-${stamp}-${pid}`);
}

/**
 * The scene's screenshot writer, with its dependencies injected so the record
 * it returns is unit-tested (R1-4). Every shot carries its OWN evidence: whether
 * the probe saw a loading placeholder immediately before and after the capture.
 * A frame labelled "loading" whose record says `loading.before === false` is a
 * mislabel the reader can see, instead of a PNG that merely has the right name.
 */
export function makeInstantShot({ dir, settle, capture, loadingNow, write }) {
	return async (name, { settled }) => {
		if (settled) await settle();
		const before = await loadingNow();
		const png = await capture();
		const after = await loadingNow();
		const path = join(dir, `${name}.png`);
		write(path, png);
		return {
			path,
			settled,
			loading: { before: before === true, after: after === true },
		};
	};
}

const ms = (value) => (typeof value === "number" ? `${value}ms` : "?");
const statLine = (s) =>
	s && s.n > 0
		? `n=${s.n} median=${ms(s.median)} max=${ms(s.max)} min=${ms(s.min)}`
		: "n=0 (no samples)";

/**
 * The stderr summary for this scenario (R1-5). The bench's generic line reads
 * `firstRow`/`settled`/`rows`, which this scene does not produce, so it printed
 * `rows=undefined` and none of the numbers a reader would quote.
 */
export function instantSummaryLines(result) {
	const s = result.summary ?? {};
	const shots = Object.entries(result.shots ?? {});
	const lines = [
		`  instant-load · target <${result.targetMs ?? INSTANT_TARGET_MS}ms · ${result.evidence ?? ""}`,
		`    input: ${result.input ?? INSTANT_INPUT_LABEL}`,
		`    first open: ${ms(s.firstOpenMs)} (dispatch=${result.firstOpen?.dispatch ?? "?"}, loading frames=${result.firstOpen?.loadingFrames ?? "?"})`,
		`    warm open:   ${statLine(s.warmOpen)}`,
		`    warm switch: ${statLine(s.warmSwitch)} · background refetches=${s.warmSwitchBackgroundRefetches ?? "?"}`,
		`    first visit prefetched: ${statLine(s.firstVisitPrefetched)}`,
		`    first visit never-prefetched (control): ${statLine(s.firstVisitNeverPrefetched_control)}`,
		`    dispatch: opens ${JSON.stringify(s.dispatch?.opens ?? {})} switches ${JSON.stringify(s.dispatch?.switches ?? {})} missed-hit-test=${s.dispatch?.missedHitTest ?? "?"}`,
	];
	if (result.host)
		lines.push(
			`    host: loadavg=${result.host.loadavg.map((v) => v.toFixed(1)).join("/")} cpus=${result.host.cpus}`,
		);
	for (const [label, shot] of shots)
		lines.push(
			`    shot ${label}: ${shot.path} (loading at capture: ${shot.loading?.before ? "yes" : "no"}/${shot.loading?.after ? "yes" : "no"})`,
		);
	return lines;
}

/**
 * Setup preflight, run BEFORE the build (QA round 1, B1). The build's config
 * loader throws on a missing variable before compiling anything, and that
 * failure used to be the first thing a lane saw - indistinguishable at a glance
 * from "the app under test is broken". This names each prerequisite and fails
 * closed. Variable NAMES are derived from the plugins (`check-build-env.mjs`),
 * never copied; their VALUES are never printed or read from a `.env`.
 */
export function buildPreflight({ root, env = process.env }) {
	const at = (...parts) => join(root, ...parts);
	const sha = (path) =>
		createHash("sha256").update(readFileSync(path)).digest("hex");
	const checks = [];
	const electronVite = at("node_modules", ".bin", "electron-vite");
	checks.push({
		name: "dependency tree present (node_modules/.bin/electron-vite)",
		ok: existsSync(electronVite),
	});
	checks.push({
		name: "Electron binary installed (node_modules/electron/dist)",
		ok: existsSync(at("node_modules", "electron", "dist")),
	});
	/* A tree linked from another worktree must match THIS lockfile, or the build
	   measures a different dependency set (pnpm writes the lockfile it installed
	   to node_modules/.pnpm/lock.yaml). */
	const installed = at("node_modules", ".pnpm", "lock.yaml");
	const wanted = at("pnpm-lock.yaml");
	checks.push({
		name: "installed dependency lock matches pnpm-lock.yaml",
		ok:
			existsSync(installed) && existsSync(wanted)
				? sha(installed) === sha(wanted)
				: false,
	});
	let names = [];
	try {
		names = requiredBuildEnv(
			defaultVitePlugins(
				at("electron.vite.config.js"),
				at("scripts", "vite-plugins"),
			),
		);
	} catch (error) {
		checks.push({
			name: `required build variables derivable (${error.message})`,
			ok: false,
		});
	}
	for (const name of names)
		checks.push({
			name: `build variable ${name} is set (an inert placeholder is enough)`,
			ok: typeof env[name] === "string" && env[name].trim() !== "",
		});
	return { ok: checks.every((c) => c.ok), checks, requiredEnv: names };
}

if (isEntryPoint(import.meta.url)) {
	const argv = process.argv.slice(2);
	if (!argv.includes("--preflight")) {
		process.stderr.write(
			"usage: node scripts/team-bridge-instant-load.mjs --preflight [--root DIR]\n(the scene itself runs through scripts/team-bridge-bench.mjs --scenario=instant-load)\n",
		);
		process.exit(2);
	}
	const rootIndex = argv.indexOf("--root");
	const root = resolve(rootIndex >= 0 ? argv[rootIndex + 1] : process.cwd());
	const result = buildPreflight({ root });
	for (const check of result.checks)
		process.stderr.write(`${check.ok ? "ok  " : "FAIL"} ${check.name}\n`);
	process.stderr.write(
		result.ok
			? `preflight ok: ${root}\n`
			: `preflight FAILED (setup, not an app result): ${root}\n`,
	);
	process.exit(result.ok ? 0 : 1);
}
