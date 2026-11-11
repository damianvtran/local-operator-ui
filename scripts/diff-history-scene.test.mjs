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
	diffHistorySceneRefusal,
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
	// The failure leaves evidence, and only the failure frame: no pager step ran.
	assert.deepEqual(frames, ["diff-history-no-offer"]);
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
