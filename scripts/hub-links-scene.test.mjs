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
const HOOKS = "src/renderer/src/shared/api/local-operator/hub-link-hooks.ts";
const ACTIONS =
	"src/renderer/src/shared/api/local-operator/hub-link-actions.ts";
const PANEL = "src/renderer/src/features/agents/components/hub-links-panel.tsx";
const VIEW = "src/renderer/src/features/agents/hub-link-view.ts";

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

test("the hub-links panel imports every hook it calls", () => {
	const panel = readFileSync(PANEL, "utf8");
	// A bare `useHubLinks(enabled)` with no import is a runtime ReferenceError the
	// scene surfaced as a crashed route (ErrorBoundary) — and the linter cannot
	// see an unresolved identifier, so this is the cheap source guard in front of
	// the typecheck CI runs.
	assert.match(
		panel,
		/import \{\s*useHubLinks\s*\} from "@shared\/api\/local-operator\/hub-link-hooks";/,
	);
});

test("the resolve arm is typed to the frozen agent|team Kind", () => {
	const actions = readFileSync(ACTIONS, "utf8");
	const code = actions
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "");
	// Core's HubApply.kind is Kind = Literal["agent", "team"]; typing the resolve
	// input as the wider HubLinkKind let "skill" reach hub.apply, which the wire
	// refuses (and which the renderer typecheck catches only because the contract
	// op narrows it). Pin the narrowed input here.
	assert.match(
		code,
		/export type HubSourceResolutionInput = \{[\s\S]*?kind: "agent" \| "team";/,
	);
});

test("the policy write consumes the PATCH's {link_id, policy} snapshot, never a full HubLink", () => {
	const hooks = readFileSync(HOOKS, "utf8");
	const code = hooks.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	// Core's PATCH answers {link_id, policy} (desktop_hub.py patch_link).
	assert.match(code, /HubPolicyWriteResult = \{/);
	assert.match(code, /link_id: string;/);
	assert.match(
		code,
		/policy: \{ subscribe: boolean; auto_push: boolean; revision: string \};/,
	);
	// Never the assumed {link: HubLink} shape.
	assert.doesNotMatch(code, /desktopResult<\{ link: HubLink \}>/);
	// The row's POLICY is patched in place (spread previous row), never replaced
	// wholesale from a response that carries only policy.
	assert.match(
		code,
		/row\.link_id === link_id \? \{ \.\.\.row, policy \} : row/,
	);
});

test("the stub emits only real wire direction states", () => {
	// DESIGN D1 / QA Q1: the stub used "healthy"/"never"/"pending", none of which
	// core emits (service.py _direction_status answers idle|failed|merging|available).
	// A stub on a fictional vocabulary would let the scene pass against states the
	// real backend never sends. Pin every `state:` literal the stub emits to the
	// renderer's own known-state set.
	const stub = readFileSync(STUB, "utf8");
	const view = readFileSync(VIEW, "utf8");
	const knownBlock = /const KNOWN_STATES = new Set\(\[([\s\S]*?)\]\)/.exec(
		view,
	);
	assert.ok(
		knownBlock,
		"hub-link-view.ts no longer exposes a KNOWN_STATES set",
	);
	const known = new Set(
		[...knownBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
	);
	// busy states ride named sets; fold their literals in so the pin covers them.
	for (const m of view.matchAll(/new Set\(\[([^\]]*)\]\)/g)) {
		for (const lit of m[1].matchAll(/"([^"]+)"/g)) known.add(lit[1]);
	}
	// A bare `state:` only — `baseline_state` is a different field (the provenance
	// literal), so the lookbehind excludes any prefixed `*_state`.
	const emitted = [...stub.matchAll(/(?<![\w])state:\s*"([^"]+)"/g)].map(
		(m) => m[1],
	);
	assert.ok(emitted.length > 0, "the stub emits no direction states to check");
	for (const state of emitted) {
		assert.ok(
			known.has(state),
			`the stub emits state "${state}", which hub-link-view.ts does not know`,
		);
	}
});

test('baseline known-ness follows the provenance literal, not a "known" sentinel', () => {
	// CODE MAJOR-1: core writes recorded_by (pull/publish/merge-*/adopt/
	// adopt-unknown); the old `=== "known"` read EVERY real row as unknown. The
	// helper is the single source, and a real wire row must read as known.
	const types = readFileSync(TYPES, "utf8");
	assert.match(types, /export function baselineIsKnown\(/);
	assert.match(types, /return recordedBy !== "adopt-unknown";/);
	const code = types.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	// The type must be the provenance domain, never the retired sentinel union.
	assert.match(code, /baseline_state: HubRecordedBy;/);
	assert.doesNotMatch(code, /baseline_state: "known" \| "unknown"/);
});
