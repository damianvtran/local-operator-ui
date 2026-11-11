/**
 * The `diff-history` driver scene, the parts runnable without Electron.
 *
 *     node --test scripts/diff-history-scene.test.mjs
 *
 * The scene itself boots the built app against a live daemon, so CI cannot run
 * it. This pins what can be checked without one: its argument refusal, that it
 * is opt-in by name only, that it drives the app through the existing verbs
 * and nothing else, and that a fixture with no pageable diff FAILS instead of
 * passing vacuously. It cannot see a frame or a press; that is the scene's job.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	COLLAPSED_FOLD,
	WORK_READ,
	diffHistorySceneRefusal,
	headerOpened,
	parseRange,
	sceneDiffHistory,
} from "./diff-history-scene.mjs";

const ok = { backend: "http://127.0.0.1:1", backendRecords: "/r.json" };

test("diff-history refuses a run that could not prove anything", () => {
	assert.match(
		diffHistorySceneRefusal({ ...ok, backend: null, session: "fc00000000a1" }),
		/needs --backend/,
	);
	assert.match(
		diffHistorySceneRefusal({
			...ok,
			backendRecords: null,
			session: "fc00000000a1",
		}),
		/needs --backend-records/,
	);
	for (const session of [
		null,
		"sess-parent",
		"FC00000000A1",
		"fc00000000a",
		"../x",
	])
		assert.match(
			diffHistorySceneRefusal({ ...ok, session }),
			/12 lowercase hex/,
		);
	assert.equal(
		diffHistorySceneRefusal({ ...ok, session: "fc00000000a1" }),
		null,
	);
});

test("diff-history is registered, guarded, and opt-in by name only", () => {
	const driver = readFileSync("scripts/renderer-driver.mjs", "utf8");
	const cliScenes = /--scene <([^>]+)>/.exec(driver)?.[1].split("|") ?? [];
	assert.ok(cliScenes.includes("diff-history"));
	assert.match(
		driver,
		/SCENE === "diff-history"\)\n\t+await sceneDiffHistory\(/,
	);
	assert.match(
		driver,
		/if \(SCENE === "diff-history"\) \{\n\t+const refusal = diffHistorySceneRefusal\(/,
	);
	assert.match(driver, /const SCENE = argValue\("--scene", "states"\);/);
});

test("the connection probe picks lsof's absolute path per platform", () => {
	const driver = readFileSync("scripts/renderer-driver.mjs", "utf8");
	// Linux installs lsof at /usr/bin; macOS keeps /usr/sbin. Both absolute,
	// and the args that scope the probe to one pid are unchanged.
	assert.match(
		driver,
		/spawn\(\n\t+process\.platform === "linux" \? "\/usr\/bin\/lsof" : "\/usr\/sbin\/lsof",\n\t+\["-a", "-p", String\(pid\), "-i", "-n", "-P"\],/,
	);
	assert.doesNotMatch(driver, /spawn\(\n\t+"\/usr\/sbin\/lsof",/);
});

test("the range label parses, grouped or not", () => {
	assert.deepEqual(parseRange("Rows 201–263 of 263"), {
		first: 201,
		last: 263,
		total: 263,
	});
	assert.deepEqual(parseRange("Rows 1–200 of 1,234"), {
		first: 1,
		last: 200,
		total: 1234,
	});
	assert.equal(parseRange(""), null);
});

test("a fixture with no View full diff control FAILS, records its frame, through existing verbs only", async () => {
	const verbs = [];
	const checks = [];
	const frames = [];
	const notes = [];
	const evaluated = [];
	await sceneDiffHistory({
		cdp: {
			evaluate: async (expr) => {
				evaluated.push(expr);
				return { open: false, viewFull: 0 };
			},
		},
		verb: async (_cdp, name, payload) => {
			verbs.push([name, payload]);
			return name === "queries"
				? [
						{ key: '["ok"]', status: "success", hasData: true },
						{ key: '["diff"]', status: "error", hasData: false },
					]
				: { ok: true };
		},
		capture: async (_cdp, name) => frames.push(name),
		check: (label, passed) => checks.push([label, passed]),
		note: (label, detail) => notes.push([label, detail]),
		waitForCondition: async () => ({ ok: false, last: null }),
		factsOf: async () => ({ windowMode: "headless" }),
		session: "fc00000000a1",
	});
	assert.deepEqual(
		verbs.map(([name]) => name),
		["hello", "navigate", "queries"],
	);
	assert.deepEqual(verbs[1], ["navigate", "/chat/fc00000000a1"]);
	assert.ok(
		checks.length > 0 && checks.every(([, passed]) => passed === false),
	);
	// The failure leaves evidence: the collapsed starting frame and the failure
	// frame, and no pager step ran.
	assert.deepEqual(frames, [
		"diff-history-open-initial",
		"diff-history-no-offer",
	]);
	const queryNote = notes.find(([l]) => l === "diff-history no-offer queries");
	assert.deepEqual(JSON.parse(queryNote[1]), {
		count: 2,
		notSuccess: [{ key: '["diff"]', status: "error", hasData: false }],
	});
	assert.ok(notes.some(([l]) => l === "diff-history no-offer dom"));
	// Read-only: no input values, markup dumps or DOM writes in what it evaluates.
	for (const expr of evaluated)
		assert.doesNotMatch(
			expr,
			/\.value\b|innerHTML|outerHTML|setAttribute|\.click\(|dispatchEvent|\.remove\(|localStorage|cookie/,
		);
});

test("a collapsed outer turn summary, then its inner work fold and Edited row, are opened by press before View full diff is awaited", async () => {
	// A tiny model of the native transcript: the collapsed "3 actions" bar is the
	// OUTER TurnSummary; opening it reveals an inner TraceFold that is still
	// closed, so the global collapsed-fold count does NOT drop after the outer
	// press. Inside the fold: a Wrote row and an Edited row holding the control.
	const turn = {
		kind: "turn",
		root: '[data-lo-canonical-transcript] [data-turn-summary][data-record-id="t1"]',
		header: "button[aria-expanded]",
		selector:
			'[data-lo-canonical-transcript] [data-turn-summary][data-record-id="t1"] button[aria-expanded="false"]',
	};
	const fold = {
		kind: "fold",
		root: '[data-lo-canonical-transcript] [data-fold-ids="r1 r\\:2"]',
		header: "button[aria-expanded]:has([data-fold-summary])",
		selector:
			'[data-lo-canonical-transcript] [data-fold-ids="r1 r\\:2"] button[aria-expanded="false"]:has([data-fold-summary])',
	};
	const edited =
		'[data-lo-canonical-transcript] [data-record-id="r\\:2"] button[aria-expanded="false"]:has([data-trace-verb])';
	const wrote =
		'[data-lo-canonical-transcript] [data-record-id="r1"] button[aria-expanded="false"]:has([data-trace-verb])';
	const ui = { turnOpen: false, foldOpen: false, editedOpen: false };
	const events = [];
	const frames = [];
	const checks = [];
	const collapsedSeen = [];
	await sceneDiffHistory({
		cdp: {
			evaluate: async (expr) => {
				if (expr === WORK_READ) {
					// Closed outer: one collapsed fold elsewhere stays; open outer: the
					// revealed inner fold is closed too, so the count is unchanged.
					const collapsedFolds = ui.foldOpen ? 0 : 1;
					collapsedSeen.push(collapsedFolds);
					const disclosures = [];
					if (!ui.turnOpen) disclosures.push(turn);
					else if (!ui.foldOpen) disclosures.push(fold);
					return {
						transcript: true,
						viewFull: ui.editedOpen ? 1 : 0,
						folds: 1,
						collapsedFolds,
						disclosures,
						ambiguous: 0,
						tools:
							ui.foldOpen && !ui.editedOpen
								? [
										{ verb: "Edited", selector: edited },
										{ verb: "Wrote", selector: wrote },
									]
								: [],
					};
				}
				return { open: false, viewFull: ui.editedOpen ? 1 : 0 };
			},
		},
		verb: async (_cdp, name, payload) => {
			events.push(["verb", name, payload?.selector ?? payload]);
			if (name === "press" && payload.selector === turn.selector)
				ui.turnOpen = true;
			if (name === "press" && payload.selector === fold.selector)
				ui.foldOpen = ui.turnOpen; // a hidden inner fold takes no press
			if (name === "press" && payload.selector === edited) ui.editedOpen = true;
			return name === "queries" ? [] : { ok: true };
		},
		capture: async (_cdp, name) => frames.push(name),
		check: (label, passed) => checks.push([label, passed]),
		note: () => {},
		// Settles answer from the model; the pager never opens, so the run ends
		// early on "full diff opens" FAIL, after the preview frame.
		waitForCondition: async (_cdp, expr) => {
			events.push(["wait", expr]);
			if (
				expr ===
				'Boolean(document.querySelector("[data-lo-canonical-transcript]"))'
			)
				return { ok: true };
			if (expr === headerOpened(turn)) return { ok: ui.turnOpen };
			if (expr === headerOpened(fold)) return { ok: ui.foldOpen };
			if (expr.includes('aria-expanded=\\"true\\"'))
				return { ok: ui.editedOpen };
			if (expr === `Boolean(document.querySelector("[data-diff-view-full]"))`)
				return { ok: ui.editedOpen };
			return { ok: false, last: null };
		},
		factsOf: async () => ({}),
		session: "fc00000000a1",
	});
	const presses = events
		.filter(([k, n]) => k === "verb" && n === "press")
		.map(([, , s]) => s);
	// Outer bar first, then the fold it revealed, then the Edited row (red and
	// green) rather than Wrote; each exactly once, since the control appeared.
	assert.deepEqual(presses.slice(0, 3), [turn.selector, fold.selector, edited]);
	assert.ok(!presses.includes(wrote));
	assert.ok(!presses.includes(COLLAPSED_FOLD));
	// The outer press worked although the global count did not move...
	assert.deepEqual(collapsedSeen.slice(0, 2), [1, 1]);
	// ...because progress is each pressed header's OWN state, in press order.
	const waits = events.filter(([k]) => k === "wait").map(([, e]) => e);
	const turnWait = waits.indexOf(headerOpened(turn));
	const foldWait = waits.indexOf(headerOpened(fold));
	assert.ok(turnWait >= 0 && foldWait > turnWait);
	assert.ok(!waits.some((e) => e.includes(".length <")));
	assert.match(headerOpened(turn), /closest\(.*\) === r/);
	assert.ok(headerOpened(turn).includes(JSON.stringify(turn.root)));
	assert.ok(
		checks.some(([l, p]) => l === "open: turn summary 1 opens" && p) &&
			checks.some(([l, p]) => l === "open: work fold 2 opens" && p),
	);
	// Every press selector opens a CLOSED control inside the transcript.
	for (const s of presses) {
		if (s === "[data-diff-view-full]") continue;
		assert.match(
			s,
			/^\[data-lo-canonical-transcript\] .*aria-expanded="false"/,
		);
	}
	const firstViewFullWait = events.findIndex(
		([k, e]) =>
			k === "wait" &&
			e === `Boolean(document.querySelector("[data-diff-view-full]"))`,
	);
	const lastDisclosure = events.findIndex(
		([k, n, s]) => k === "verb" && n === "press" && s === edited,
	);
	assert.ok(lastDisclosure >= 0 && lastDisclosure < firstViewFullWait);
	assert.equal(frames[0], "diff-history-open-initial");
	assert.ok(frames.includes("diff-history-preview"));
	assert.ok(
		checks.some(
			([l, p]) =>
				l === "the seeded session offers a View full diff control" && p,
		),
	);
});

test("an already-open fold is never pressed, no rows means no presses, and an ambiguous header fails closed", async () => {
	const presses = [];
	await sceneDiffHistory({
		cdp: {
			evaluate: async (expr) =>
				expr === WORK_READ
					? {
							transcript: true,
							viewFull: 0,
							folds: 1,
							collapsedFolds: 0,
							tools: [],
						}
					: { open: false, viewFull: 0 },
		},
		verb: async (_cdp, name, payload) => {
			if (name === "press") presses.push(payload);
			return name === "queries" ? [] : { ok: true };
		},
		capture: async () => {},
		check: () => {},
		note: () => {},
		waitForCondition: async () => ({ ok: false, last: null }),
		factsOf: async () => ({}),
		session: "fc00000000a1",
	});
	assert.deepEqual(presses, []);
	// A collapsed header that cannot be addressed uniquely is never guessed at:
	// no press, and a recorded FAIL naming the read.
	const checks = [];
	await sceneDiffHistory({
		cdp: {
			evaluate: async (expr) =>
				expr === WORK_READ
					? {
							transcript: true,
							viewFull: 0,
							folds: 2,
							collapsedFolds: 2,
							disclosures: [],
							ambiguous: 1,
							tools: [],
						}
					: { open: false, viewFull: 0 },
		},
		verb: async (_cdp, name, payload) => {
			if (name === "press") presses.push(payload);
			return name === "queries" ? [] : { ok: true };
		},
		capture: async () => {},
		check: (label, passed) => checks.push([label, passed]),
		note: () => {},
		waitForCondition: async (_cdp, expr) => ({
			ok: expr.startsWith(
				'Boolean(document.querySelector("[data-lo-canonical-transcript]"))',
			),
			last: null,
		}),
		factsOf: async () => ({}),
		session: "fc00000000a1",
	});
	assert.deepEqual(presses, []);
	assert.ok(
		checks.some(
			([l, p]) =>
				l === "open: every collapsed work header is uniquely addressable" &&
				p === false,
		),
	);
});

test("the work read is scoped, read-only and only addresses closed Edited/Wrote rows", () => {
	assert.match(
		COLLAPSED_FOLD,
		/^\[data-lo-canonical-transcript\] \[data-fold-ids\] button\[aria-expanded="false"\]:has\(\[data-fold-summary\]\)$/,
	);
	assert.match(WORK_READ, /verb !== "Edited" && verb !== "Wrote"/);
	// Outer TurnSummary headers are offered before TraceFolds, each only as its
	// root's own header, uniquely addressed by the root's stable stamp.
	assert.ok(
		WORK_READ.indexOf('offer("turn"') >= 0 &&
			WORK_READ.indexOf('offer("turn"') < WORK_READ.indexOf('offer("fold"'),
	);
	assert.match(WORK_READ, /x\.closest\(owner\) === el/);
	assert.match(WORK_READ, /"data-record-id" : "data-run-ids"/);
	assert.match(
		WORK_READ,
		/querySelectorAll\(rootSel\)\.length === 1 && document\.querySelector\(selector\) === b/,
	);
	assert.match(WORK_READ, /document\.querySelector\(selector\) === button/);
	assert.doesNotMatch(
		WORK_READ,
		/\.value\b|innerHTML|outerHTML|setAttribute|\.click\(|dispatchEvent|\.remove\(|localStorage|cookie/,
	);
});
