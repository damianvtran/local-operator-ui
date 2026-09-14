import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	RUNTIME_DEPENDENCIES,
	checkRuntimeDependencies,
} from "./check-runtime-deps.mjs";

/**
 * The runtime-dependency guard's own cases.
 *
 * Why these exist: the guard is the only thing standing between the packaged
 * app and a production dependency nobody vetted, and its failure mode is silent
 * - a guard that reads the wrong file, or that passes over an empty dependency
 * list, looks exactly like a guard that passes. So both directions are pinned
 * here, plus the repository's own manifest, which is what CI asserts on every
 * pull request.
 *
 * The fixtures are manifests written to a temp directory; the CLI is driven as
 * a subprocess so the exit code is tested too, not just the returned problems.
 */

const guard = new URL("./check-runtime-deps.mjs", import.meta.url).pathname;
const allowlisted = Object.fromEntries(
	RUNTIME_DEPENDENCIES.map((entry) => [entry.name, "1.0.0"]),
);

function fixture(dependencies) {
	const dir = mkdtempSync(join(tmpdir(), "lo-runtime-deps-"));
	const path = join(dir, "package.json");
	writeFileSync(
		path,
		JSON.stringify({ name: "fixture", dependencies }, null, 2),
	);
	return path;
}

function runGuard(manifestPath) {
	const result = spawnSync(
		process.execPath,
		[guard, "--manifest", manifestPath],
		{
			encoding: "utf8",
		},
	);
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

test("passes when every production dependency is on the allowlist", () => {
	const manifestPath = fixture(allowlisted);
	const { declared, problems } = checkRuntimeDependencies({ manifestPath });
	assert.deepEqual(problems, []);
	assert.deepEqual(declared.sort(), Object.keys(allowlisted).sort());

	const cli = runGuard(manifestPath);
	assert.equal(cli.status, 0);
	assert.match(cli.stdout, /all on the runtime allowlist/);
	assert.equal(cli.stderr, "");
});

test("fails on a production dependency nobody vetted, and names it", () => {
	const manifestPath = fixture({ ...allowlisted, mermaid: "^11.6.0" });
	const { problems } = checkRuntimeDependencies({ manifestPath });
	assert.equal(problems.length, 1);
	assert.match(problems[0], /unvetted production dependency: mermaid/);
	assert.match(problems[0], /move it to devDependencies/);

	const cli = runGuard(manifestPath);
	assert.equal(cli.status, 1);
	assert.match(cli.stderr, /check-runtime-deps: FAILED \(1 problem\)/);
	assert.match(cli.stderr, /unvetted production dependency: mermaid/);
});

test("fails on an allowlist entry with no matching dependency", () => {
	// Destructured rather than deleted: biome's noDelete is an error here, and
	// the fixture is clearer about what it removes.
	const { zod: _omitted, ...withoutZod } = allowlisted;
	const manifestPath = fixture(withoutZod);
	const { problems } = checkRuntimeDependencies({ manifestPath });
	assert.equal(problems.length, 1);
	assert.match(problems[0], /stale allowlist entry: zod/);

	const cli = runGuard(manifestPath);
	assert.equal(cli.status, 1);
	assert.match(cli.stderr, /stale allowlist entry: zod/);
});

test("refuses to pass over an empty dependency list", () => {
	// The vacuous pass: if the guard ever reads a manifest with no dependencies,
	// "no unvetted dependencies" is a statement about nothing. Every allowlist
	// entry is stale on top of that, which is the same finding from the other
	// side, so both halves are asserted.
	const manifestPath = fixture({});
	const { problems } = checkRuntimeDependencies({ manifestPath });
	assert.equal(problems.length, 1 + RUNTIME_DEPENDENCIES.length);
	assert.ok(
		problems.some((problem) =>
			/declares no production dependencies/.test(problem),
		),
		"the empty-list finding must be present",
	);
	assert.ok(
		problems.every((problem) =>
			/declares no production dependencies|stale allowlist entry/.test(problem),
		),
		"an empty manifest can only fail as vacuous, or as stale entries",
	);

	const cli = runGuard(manifestPath);
	assert.equal(cli.status, 1);
	assert.match(cli.stderr, /declares no production dependencies/);
});

test("passes on the repository's own manifest", () => {
	const { declared, problems } = checkRuntimeDependencies();
	assert.deepEqual(problems, []);
	assert.ok(
		declared.length > 0,
		"the repository must declare runtime dependencies",
	);
});
