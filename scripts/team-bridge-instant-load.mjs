/**
 * `--scenario=instant-load` for `scripts/team-bridge-bench.mjs`: the acceptance
 * timing scene for the operator's bridge-instant-load target.
 *
 *     node scripts/team-bridge-bench.mjs --scenario=instant-load \
 *         --json "$LOCAL_OPERATOR_SCRATCHPAD/instant.json" \
 *         --shots "$LOCAL_OPERATOR_SCRATCHPAD/instant-shots"
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
 * starts at the pointerdown of a real DOM click sequence on a real control (the
 * nav link / the rail row) and stops at the second rAF after the first frame in
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
			name: "warm switches issued no /messages read (served from the query cache)",
			ok: warm.every((s) => s.requests.messages === 0),
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
	probe.press = (element) => {
		const rect = element.getBoundingClientRect();
		const init = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + Math.min(rect.height / 2, 12), view: window };
		element.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1, pointerId: 1, isPrimary: true, pointerType: "mouse" }));
		element.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
		element.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, pointerId: 1, isPrimary: true, pointerType: "mouse" }));
		element.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
		element.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }));
	};
	probe.navControl = () =>
		document.querySelector('a[href="#/team-bridge"]') ??
		[...document.querySelectorAll("nav a, nav button, aside a, aside button, a, button")].find((node) =>
			/^\\s*team bridge\\s*$/i.test(node.getAttribute("aria-label") || node.textContent || ""));
	probe.run = (spec) => new Promise((resolveRun) => {
		const { mode, conversationId, expectRail, newest, timeoutMs } = spec;
		const target = conversationId ? { suffix: conversationId.slice(-6), newest } : null;
		let element = null;
		let dispatch = "none";
		if (mode === "open") {
			element = probe.navControl();
			dispatch = element ? "nav-click" : "hash";
		} else {
			element = document.querySelector('[data-conversation-id="' + conversationId + '"]');
			dispatch = element ? "rail-click" : "missing-row";
		}
		const frames = [];
		const t0 = performance.now();
		if (element) probe.press(element);
		else if (mode === "open") window.location.hash = "#/team-bridge";
		else return resolveRun({ ok: false, dispatch, reason: "rail row not rendered", frames: 0, loadingFrames: 0, usableMs: null });
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
				resolveRun({ ok: false, dispatch, usableMs: null, reason: "no usable frame within " + timeoutMs + " ms", frames: frames.length, loadingFrames: frames.filter((f) => f.loading).length, last: s });
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
 * `shot(name, {settled})` writes a PNG and returns its path.
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
		const before = stub.seen();
		const result = await evaluate(
			`window.__tbInstant.run(${JSON.stringify({ timeoutMs: 10_000, expectRail: plan.length, newest: newestHex, ...spec })})`,
		);
		// The window's requests include the ones still in flight at "usable", so
		// give the wire one latency's worth of time before reading the counts.
		await sleep(Math.max(...Object.values(latency)) + 50);
		return { ...result, requests: routeCountsBetween(before, stub.seen()) };
	};
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
	return {
		scenario: "instant-load",
		evidence:
			"SYNTHETIC BACKEND: real built renderer + main over the bench stub daemon with fixed per-route latencies; not live-hub end-to-end, not the installed .app",
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
