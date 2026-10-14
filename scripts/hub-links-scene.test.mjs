/**
 * The hub-links driver scene, executable — and the wire literals it is argued from.
 *
 *     node --test scripts/hub-links-scene.test.mjs
 *
 * WHY THIS FILE EXISTS. The scene `hub-links` in `scripts/renderer-driver.mjs`
 * cannot run in CI (it boots Electron against a stub daemon), so the cheap gate
 * in front of it is a SOURCE pin: it asserts the scene is registered, that it is
 * backend-gated (a scene that photographed a disconnected app would pass while
 * proving nothing), and that the fixtures the scene and its stub depend on still
 * carry the FROZEN wire literals — a rename there would leave the scene green
 * against a shape core no longer serves.
 *
 * WHAT IT CANNOT SEE, stated rather than implied: it cannot see a frame, a press
 * or a refusal. That is the scene's job (`node scripts/renderer-driver.mjs
 * --scene hub-links --backend ...`), which needs a built app and a live daemon.
 * This file is the source half, runnable without either.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DRIVER = "scripts/renderer-driver.mjs";
const STUB = "docs/evidence/hub-links/harness/stub-daemon.mjs";
const TYPES = "src/renderer/src/shared/api/local-operator/hub-links.ts";

test("the hub-links scene is registered and backend-gated", () => {
	const driver = readFileSync(DRIVER, "utf8");
	// The scene exists and is dispatched.
	assert.match(driver, /async function sceneHubLinks\(/);
	assert.match(driver, /SCENE === "hub-links"\) await sceneHubLinks\(/);
	// It is listed in the CLI's own scene list, so `--help` and the guard agree.
	assert.match(
		driver,
		/--scene <[^>]*\|hub-links\|none>/,
		"the scene name is missing from the CLI scene list",
	);
	// Both backend guards, for the reason the other backend scenes carry them.
	assert.match(
		driver,
		/SCENE === "hub-links" && BACKEND === null/,
		"the scene must refuse to run without --backend",
	);
	assert.match(
		driver,
		/SCENE === "hub-links" && BACKEND_RECORDS === null/,
		"the scene must refuse to run without --backend-records",
	);
});

test("the resolve-arm wire literals are the FROZEN ones, never the retired shorthand", () => {
	const types = readFileSync(TYPES, "utf8");
	const code = types.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	// The renamed key and the real recorded-by literals (core service.py writes
	// "adopt-unknown" on the resolve arm; the equal-text path writes "adopt").
	assert.match(code, /baseline_state: "adopt" \| "adopt-unknown";/);
	// The receipt's earlier shorthand is emitted by no path.
	assert.doesNotMatch(code, /"adopted"/);
	// The key is `baseline_state`, not the pre-rename `baseline`.
	assert.doesNotMatch(code, /baseline: "/);
});

test("the stub fixture answers the frozen inventory shape and its resolve arm", () => {
	const stub = readFileSync(STUB, "utf8");
	// The inventory op's route, and the capability the panel gates on.
	assert.match(stub, /\/v1\/desktop\/hub\/links/);
	assert.match(stub, /hub_links: 1/);
	// One row per state the panel draws: a healthy public agent, an org team and
	// a skill, plus a legacy unknown-origin diagnostic row.
	assert.match(stub, /kind: "skill"/);
	assert.match(stub, /visibility: "org"/);
	// The resolve arm records the real literal under the renamed key.
	assert.match(stub, /baseline_state: "adopt-unknown"/);
	assert.doesNotMatch(stub, /"adopted"/);
});
