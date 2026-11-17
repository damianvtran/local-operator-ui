/**
 * The signed-update harness's BLOCKED-unsigned decision (QA finding Q3 on #1948).
 *
 * `verify-signed-update.mjs` declared a candidate unsigned whenever it reached
 * the signature step, even when every signature row PASSED: the call was not
 * guarded, so a fully signed candidate stopped with "carries no valid release
 * signature... ()" and the exact-update swap was unreachable on any host.
 *
 * The script runs at import, so it cannot be imported here; the partition it
 * relies on is exported from `verify-macos-artifacts.mjs` and tested directly,
 * and the call site's guard is pinned by reading the script's source. Builtins
 * only on purpose: this needs no `pnpm install` to run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { partitionCandidateChecks } from "./verify-macos-artifacts.mjs";

// A representative subset of the script's SIGNATURE_CHECK_IDS; the partition
// takes the set as a parameter, so the real membership is the script's concern.
const SIGNATURE_IDS = new Set(["app-codesign", "app-spctl", "dmg-stapler"]);
const DECLARATION = /\bfunction\s+blockedUnsignedCandidate\b/;
const GUARD = /if \(brokenSignatures\.length > 0\)/;
const row = (id, passed, output = passed ? "ok" : `${id} rejected`) => ({
	id,
	passed,
	output,
});

test("a candidate whose signature rows all pass is not BLOCKED", () => {
	const { assembly, brokenSignatures } = partitionCandidateChecks(
		[
			row("app-codesign", true),
			row("app-spctl", true),
			row("dmg-stapler", true),
			row("app-spawn", true),
		],
		SIGNATURE_IDS,
	);
	assert.deepEqual(brokenSignatures, []);
	assert.deepEqual(
		assembly.map((r) => r.id),
		["app-spawn"],
	);
});

test("one failing signature row is BLOCKED and named", () => {
	const { brokenSignatures } = partitionCandidateChecks(
		[
			row("app-codesign", true),
			row("app-spctl", false),
			row("dmg-stapler", true),
		],
		SIGNATURE_IDS,
	);
	assert.deepEqual(
		brokenSignatures.map((r) => [r.id, r.output]),
		[["app-spctl", "app-spctl rejected"]],
	);
});

test("a failing assembly row is the candidate's, never a signature verdict", () => {
	// `app-spawn` failing is the 0.29.6 class: it must reach the assembly assert
	// (a real FAIL), not be softened into BLOCKED.
	const { assembly, brokenSignatures } = partitionCandidateChecks(
		[row("app-codesign", true), row("app-spawn", false)],
		SIGNATURE_IDS,
	);
	assert.deepEqual(brokenSignatures, []);
	assert.equal(assembly.find((r) => r.id === "app-spawn")?.passed, false);
});

test("verify-signed-update.mjs calls blockedUnsignedCandidate only when a signature row failed", () => {
	const source = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), "verify-signed-update.mjs"),
		"utf8",
	);
	// Every call (not the declaration) must sit directly under the length guard.
	const calls = [...source.matchAll(/^.*\bblockedUnsignedCandidate\(.*$/gm)]
		.map((match) => match[0])
		.filter((line) => !DECLARATION.test(line));
	assert.ok(calls.length > 0, "no blockedUnsignedCandidate call found");
	const lines = source.split("\n");
	for (const call of calls) {
		const index = lines.indexOf(call);
		assert.match(lines[index - 1], GUARD, `unguarded call: ${call.trim()}`);
	}
});
