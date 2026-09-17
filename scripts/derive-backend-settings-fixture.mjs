/*
 * Regenerate the committed registry fixtures from the backend's own registry.
 *
 *     node scripts/derive-backend-settings-fixture.mjs
 *     node scripts/derive-backend-settings-fixture.mjs --check   # assert, write nothing
 *
 * WHY A COMMAND AND NOT A HAND-EDIT. `scripts/fixtures/backend-settings-registry*.json`
 * is the description of the settings registry that this repository's stories,
 * frames and drift test all read, so every number in the PR body is downstream
 * of it. It went stale by three keys and one section because refreshing it was
 * an editing exercise; the fix is one command anybody can run and re-run, plus
 * `--check` so a stale fixture is a non-zero exit rather than a review comment.
 *
 * The configured state is derived by APPLYING the documented writes in
 * `backend-settings-registry.mjs` through the registry's own `write_setting`,
 * so `is_default` is the registry's judgement of each row rather than a flag
 * anybody chose — which is the property the story frames rely on.
 *
 * Written with tab indentation to match the rest of the tree: these files are
 * `biome check`'d like any other source file, and a differently-indented dump
 * fails the lint rather than the review.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readRegistryProjection } from "./backend-settings-registry.mjs";

/** The two committed states, and the fixture each one is written to. */
const STATES = [
	["fresh", "backend-settings-registry"],
	["configured", "backend-settings-registry-configured"],
];

/**
 * The bytes to write, and the reason the CHECK below does not compare them.
 *
 * JSON is written here exactly as `JSON.stringify` emits it. The committed
 * fixture is then typically reformatted once by `biome` (this repository's
 * formatter, which collapses short arrays), so a byte comparison would report a
 * false staleness on a fixture that agrees with the registry down to the last
 * label — and a check that cries wolf is one nobody reads. Staleness is a
 * question about CONTENT, so `--check` compares parsed values and says nothing
 * about layout.
 */
const render = (payload) => `${JSON.stringify(payload, null, "\t")}\n`;

const check = process.argv.includes("--check");

const registry = readRegistryProjection();
if (!registry) {
	if (check) {
		// An absence is not a staleness: a machine with no backend installed
		// cannot answer this question, and a check that failed there would be
		// reporting the environment rather than the fixture. The tier test's
		// registry arm skips with the same words, deliberately.
		console.log(
			"NOT CHECKED: no backend registry is reachable on this machine, so the fixtures were not compared to one.",
		);
		process.exit(0);
	}
	console.error(
		[
			"No backend registry could be reached, so the fixtures cannot be derived.",
			"",
			"Point this at one of:",
			"  LOCAL_OPERATOR_BACKEND_PYTHON=/path/to/.venv/bin/python",
			"  LOCAL_OPERATOR_BACKEND_ROOT=/path/to/local-operator",
			"or install the released runtime as a uv tool (`lop-update` builds it).",
		].join("\n"),
	);
	process.exit(1);
}

let stale = 0;
for (const [state, name] of STATES) {
	const path = join("scripts", "fixtures", `${name}.json`);
	if (check) {
		const current = JSON.parse(readFileSync(path, "utf8"));
		if (!isDeepStrictEqual(current, registry[state])) {
			stale += 1;
			console.error(
				`${path} is stale: it does not match the registry ${registry.interpreter} serves. Re-run without --check to write it.`,
			);
		}
		continue;
	}
	writeFileSync(path, render(registry[state]));
	const payload = registry[state];
	console.log(
		`wrote ${path} — ${payload.settings.length} keys in ${payload.sections.length} sections`,
	);
}

if (check) {
	if (stale === 0) {
		console.log(
			`the committed fixtures describe the registry ${registry.interpreter} serves`,
		);
	}
	process.exit(stale === 0 ? 0 : 1);
}
