import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/**
 * The repository manifest must not declare a key twice.
 *
 * Why a scanner rather than `JSON.parse`: a duplicate key is not an error to JSON
 * - the last one silently wins - so `JSON.parse`, `require()` and every consumer
 * of this file see a perfectly valid object, and `pnpm lint` does not read
 * `package.json` at all (`lint` covers `src bin scripts/*.test.mjs`). The #170
 * merge resolution introduced exactly that shape: two byte-identical
 * `check-themes` entries, one of them on a tab-indented line, which nothing in CI
 * could see and which that resolution's own leaf audit missed because the audit
 * compared VALUES rather than the file (review round 2, N5). An identical
 * duplicate is also what loses a value silently the first time somebody edits
 * only one of the two.
 *
 * A string is a key exactly when the next non-whitespace character is `:`, which
 * JSON guarantees - no JSON value's string is followed by a colon - so the
 * scanner needs one piece of state beyond a depth counter: WHICH object it is
 * inside. Two sibling objects hold their own keys at the same depth, and a
 * depth-keyed set would call `{"a": {"x": 1}, "b": {"x": 2}}` a duplicate.
 */
function duplicatedKey(source) {
	const objects = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index];
		if (character === "{") {
			objects.push(new Set());
			index += 1;
			continue;
		}
		if (character === "}") {
			objects.pop();
			index += 1;
			continue;
		}
		if (character !== '"') {
			index += 1;
			continue;
		}
		let cursor = index + 1;
		let value = "";
		while (cursor < source.length && source[cursor] !== '"') {
			if (source[cursor] === "\\") {
				const escaped = source[cursor + 1];
				if (escaped === "u") {
					value += String.fromCharCode(
						Number.parseInt(source.slice(cursor + 2, cursor + 6), 16),
					);
					cursor += 6;
					continue;
				}
				value += escaped ?? "";
				cursor += 2;
				continue;
			}
			value += source[cursor];
			cursor += 1;
		}
		let after = cursor + 1;
		while (after < source.length && /\s/.test(source[after])) after += 1;
		if (source[after] === ":" && objects.length > 0) {
			const scope = objects[objects.length - 1];
			if (scope.has(value)) return value;
			scope.add(value);
		}
		index = cursor + 1;
	}
	return null;
}

test("the duplicate-key scanner fires on a duplicate, and not on siblings that share a name", () => {
	// The scanner IS the guard for the assertion below, so both of its directions
	// are pinned first: a detector that can never fire would pass the next test
	// for free, which is the vacuous-pass shape this file exists to refuse.
	assert.equal(duplicatedKey('{"a": 1, "a": 2}'), "a");
	assert.equal(
		duplicatedKey('{"scripts": {"a": "1"}, "x": {"a": "1"}}'),
		null,
		"sibling objects may hold the same key",
	);
	assert.equal(
		duplicatedKey('{"a": {"a": 1}}'),
		null,
		"a nested key is a different key",
	);
	assert.equal(
		duplicatedKey('{"a\\u0062": 1, "ab": 2}'),
		"ab",
		"escapes are decoded, or a duplicate could hide behind one",
	);
	assert.equal(
		duplicatedKey('{"l": [{"k": 1}, {"k": 1}]}'),
		null,
		"array elements are separate objects",
	);
	assert.equal(
		duplicatedKey('{"i": 1, "s": "a:b", "t": "}"}'),
		null,
		"a colon or a brace inside a string is content",
	);
});

test("the repository's own manifest declares no key twice", () => {
	const source = readFileSync(
		new URL("../package.json", import.meta.url),
		"utf8",
	);
	assert.equal(
		duplicatedKey(source),
		null,
		"package.json declares a key twice; JSON.parse keeps the last one silently and nothing else here can see it",
	);
	// And the check is not vacuous: the same scanner, run over the same bytes with
	// one key duplicated, finds it.
	const tampered = source.replace('  "name":', '  "name": null,\n  "name":');
	assert.equal(duplicatedKey(tampered), "name");
});

/**
 * The evidence tree's committed JSON must not declare a key twice either.
 *
 * WHY THE SCANNER IS POINTED HERE, not only at `package.json`: the evidence
 * manifest is the repository's other hand-merged JSON, so it is where the #170
 * shape actually recurs - two branches each add a record, a fold unions them,
 * and BOTH copies survive. The window's own fold of `origin/main` =
 * `f39e683024` shipped three such pairs (`sendWakeCardRestampNote`,
 * `runClosureVocabularyRestampNote`, `transcriptPerflushRestampNote`), and the
 * reason it reached a review round instead of a check is that none of these can
 * see it: `JSON.parse` keeps the last value, `require` resolves either one,
 * `check-fold-keys.mjs` compares key SETS through `JSON.parse` (a duplicate
 * collapses there), and a strict-parse assertion passes on a file with a
 * duplicate where it fails on a file with a syntax error. The raw text is the
 * only place the defect exists, so it needs the raw-text scanner (agent review
 * round 11, R11-1, whose recommendation this test implements).
 *
 * The walk covers `docs/evidence` rather than the manifest alone because that
 * is the tree the evidence system owns - every `.json` under it is committed
 * evidence - and the wider net costs nothing measurable: measured over the tree
 * at the folding head, the manifest was the only file with a duplicate, so this
 * test is a strict no-op today and catches the next one wherever in the tree it
 * lands.
 */
test("the evidence tree's committed JSON declares no key twice", () => {
	// The trailing slash matters: without it `new URL(file, evidence)` replaces
	// the last segment and resolves the tree's own paths against `docs/`.
	const evidence = new URL("../docs/evidence/", import.meta.url);
	const jsonFiles = readdirSync(evidence, { recursive: true })
		.filter((entry) => entry.endsWith(".json"))
		.sort();
	assert.ok(
		jsonFiles.length > 0,
		"the evidence tree must ship JSON for this check to mean anything",
	);
	const offenders = jsonFiles
		.map((file) => ({
			file,
			key: duplicatedKey(readFileSync(new URL(file, evidence), "utf8")),
		}))
		.filter(({ key }) => key !== null);
	assert.deepEqual(
		offenders,
		[],
		"a committed evidence JSON declares a key twice; JSON.parse keeps the last one silently and every key-SET gate is blind to it",
	);
});
