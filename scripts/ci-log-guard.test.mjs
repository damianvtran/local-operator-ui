import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/*
 * The log-payload guard is the thing that has to work when a log is unreadable,
 * so it is pinned on the two shapes that actually occurred rather than on a
 * paraphrase of them:
 *
 *  - an 8,264,707-byte stack frame naming a `data:text/javascript;base64,...`
 *    specifier (the line that stalled Desktop Tests shard 2/3 at its ceiling),
 *  - and a green run's two 3,933,710-byte `at probeTarget(...)` frames.
 *
 * The rest of the cases hold the boundaries that keep it from being noise: a
 * long ordinary log line is not a finding, the word "data:" in prose is not a
 * URI, and a quoted source statement is the ~302-file class rather than a
 * diagnostic, so it is exempt. Every finding must name the file and the test,
 * and must never echo the payload back into the log it is complaining about.
 */

const GUARD = join(import.meta.dirname, "ci-log-guard.mjs");

function run(lines, options = {}) {
	const dir = mkdtempSync(join(tmpdir(), "ci-log-guard-"));
	const log = join(dir, "suite.log");
	writeFileSync(log, lines.join("\n"));
	const args = [GUARD, "check", log];
	if (options.maxLineBytes)
		args.push("--max-line-bytes", String(options.maxLineBytes));
	const result = spawnSync(process.execPath, args, { encoding: "utf8" });
	return {
		dir,
		log,
		...result,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

/**
 * Run a generated suite through the REAL TAP reporter and hand back its output.
 *
 * `NODE_TEST_CONTEXT` is dropped deliberately: this file runs inside `node
 * --test`, and node passes that variable down so a child knows it is a test
 * worker. A nested `node --test` that inherits it renders nothing on stdout -
 * measured here as an empty capture while the same command in a plain shell
 * produced TAP - so the fixture would silently test an empty string.
 */
function tapOf(source, name) {
	const dir = mkdtempSync(join(tmpdir(), "ci-log-tap-"));
	const suite = join(dir, name);
	writeFileSync(suite, source);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
	);
	const tap = spawnSync(
		process.execPath,
		["--test", "--test-reporter=tap", suite],
		{ encoding: "utf8", env },
	);
	assert.equal(tap.status, 0, tap.stderr);
	const log = join(dir, "tap.log");
	writeFileSync(log, tap.stdout);
	return { dir, log, stdout: tap.stdout };
}

/** A frame shaped like the incident: a media type, base64, then a module line. */
function payloadFrame(functionName, repetitions) {
	return `#     at ${functionName} (data:text/javascript;base64,${"QUJD".repeat(repetitions)}:50450:21)`;
}

test("an ordinary log, however long, is clean", () => {
	const result = run([
		"# Subtest: a long but readable line",
		`ok 1 - ${"x".repeat(200_000)}`,
		"# tests 1",
		"# pass 1",
		"# fail 0",
	]);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /ci-log-guard: clean/);
	assert.ok(!result.stdout.includes("::error::"));
});

test("the incident's 8 MB data: frame is named, and the payload is not echoed", () => {
	const result = run([
		"# Subtest: a superseded refusal ends the loop instead of spending the ladder",
		"#     at file:///home/runner/work/x/scripts/completion-view-ack.test.mjs:789:23",
		payloadFrame("desktopResult", 400_000),
		"# tests 0",
	]);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /::error::ci-log-guard \[data-uri\]/);
	assert.match(result.stdout, /oversized-line/);
	assert.match(result.stdout, /scripts\/completion-view-ack\.test\.mjs/);
	assert.match(
		result.stdout,
		/a superseded refusal ends the loop instead of spending the ladder/,
	);
	/* The whole point: the finding must fit on a line a reader can read. */
	const longest = Math.max(
		...result.stdout.split("\n").map((line) => line.length),
	);
	assert.ok(
		longest < 800,
		`finding is ${longest} bytes; it repeats the payload`,
	);
});

test("a line over the cap is a finding even when it carries no data: URI", () => {
	const result = run(["ok 1 - fine", "y".repeat(4097), "# pass 1"], {
		maxLineBytes: 4096,
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /\[oversized-line\]/);
	assert.ok(!result.stdout.includes("data-uri"));
	/* The quote is bounded, so a 4 KB line does not become a 4 KB finding. */
	assert.ok(!result.stdout.includes("y".repeat(500)));
});

test("the word `data:` in prose is not a URI", () => {
	const result = run([
		"Metadata: read",
		"# data: the answer arrived after 3 attempts",
		"# tests 1",
	]);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

/*
 * THE EXEMPTION IS ONLY REAL IF IT MATCHES THE FORMAT THIS SUITE PRINTS, and a
 * shard log is TAP: a test's own output arrives `# `-prefixed (and a fetched job
 * log wraps that in the runner's timestamp again). Two rounds of review found
 * that defect twice - first the spec-reporter shape was pinned and TAP missed,
 * then the TAP code frame was pinned and TAP's `error:` scalar missed - so the
 * rule is now the property all of them share: the URI is quoted, and bounded.
 *
 * Every rendering below must stay exempt, and the two real-reporter cases after
 * this table generate theirs from `node --test --test-reporter=tap` rather than
 * writing what the format is believed to be. Removing the property fails all of
 * them, which is what stops the exemption from narrowing again.
 */
const QUOTED_SHAPES_IN_A_LOG = [
	[
		"spec-reporter code frame",
		'  12 |   const mod = await import("data:text/javascript;base64,QUJD");',
	],
	[
		"TAP-prefixed code frame",
		'#   12 | const mod = await import("data:text/javascript;base64,QUJD");',
	],
	[
		"offending-line gutter",
		'# > 12 | const mod = await import("data:text/javascript;base64,QUJD");',
	],
	[
		"runner timestamp plus TAP prefix",
		'2026-10-25T10:00:00.0000000Z #   12 | const mod = await import("data:text/javascript;base64,QUJD");',
	],
	[
		"uncaught source echo",
		'  const mod = await import("data:text/javascript;base64,QUJD");',
	],
	["TAP YAML actual", "  actual: 'data:text/javascript;base64,QUJD'"],
	["assert diff quoting a fixture", "+ 'data:text/javascript;base64,QUJD'"],
	[
		"AssertionError message",
		"AssertionError [ERR_ASSERTION]: 'data:text/javascript;base64,QUJD' !== 'x'",
	],
	[
		"TAP `error:` scalar quoting an assertion message",
		`  error: "refused: 'data:text/javascript;base64,QUJD' was not accepted"`,
	],
	[
		"TAP `error:` block scalar's continuation",
		"    expected 'data:text/javascript;base64,QUJD' to be accepted",
	],
	["a bare quoted value", "  'data:text/javascript;base64,QUJD'"],
];

test("every shape that quotes source or a fixture is exempt", () => {
	for (const [name, line] of QUOTED_SHAPES_IN_A_LOG) {
		const result = run([line]);
		assert.equal(
			result.status,
			0,
			`${name} was treated as a payload: ${result.stdout}`,
		);
	}
});

test("a diagnostic that names the module is still a finding", () => {
	for (const line of [
		"#     at desktopResult (data:text/javascript;base64,QUJD:50450:21)",
		"Error: cannot import 'data:text/javascript;base64,QUJD'",
		"Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'data:text/javascript;base64,QUJD' imported from /x.mjs",
	]) {
		const result = run([line]);
		assert.equal(result.status, 1, `${line}: ${result.stdout}`);
		assert.match(result.stdout, /\[data-uri\]/);
	}
});

test("a quoted citation past the bound is a payload, not a citation", () => {
	/* The exemption is a citation rule, not a size loophole: this is the seam
	 * R2-3 named, closed by the bound rather than documented away. */
	const huge = `'data:text/javascript;base64,${"QUJD".repeat(2048)}'`;
	const result = run([`  error: ${huge}`]);
	assert.equal(result.status, 1, result.stdout);
	assert.match(result.stdout, /\[data-uri\]/);
});

test("the reporter's own output for a quoted assertion message is exempt", () => {
	const tap = tapOf(
		[
			'import assert from "node:assert/strict";',
			'import { test } from "node:test";',
			"",
			'test("a todo case quoting a fixture", { todo: true }, () => {',
			'\tassert.equal("data:text/javascript;base64,QUJDREVGR0g=", "something else");',
			"});",
			"",
		].join("\n"),
		"quoted.test.mjs",
	);
	assert.match(tap.stdout, /# fail 0/, tap.stdout);
	const result = spawnSync(process.execPath, [GUARD, "check", tap.log], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stdout);
	assert.match(result.stdout, /ci-log-guard: clean/);
});

test("the reporter's own output for a frame that names a data: module is a finding", () => {
	const tap = tapOf(
		[
			'import { test } from "node:test";',
			"",
			"const mod = await import(",
			`\t"data:text/javascript,export function boom(){throw new Error('nope')}"`,
			");",
			'test("a thrown fixture", { todo: true }, () => {',
			"\tmod.boom();",
			"});",
			"",
		].join("\n"),
		"frame.test.mjs",
	);
	assert.match(tap.stdout, /\(data:text\/javascript,/, tap.stdout);
	const result = spawnSync(process.execPath, [GUARD, "check", tap.log], {
		encoding: "utf8",
	});
	assert.equal(result.status, 1, result.stdout);
	assert.match(result.stdout, /\[data-uri\]/);
});

test("a missing log is a usage error, not a pass", () => {
	const result = spawnSync(
		process.execPath,
		[GUARD, "check", "/nonexistent/suite.log"],
		{
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /cannot read/);
});

test("every finding is an annotation, so it does not travel through the log", () => {
	const result = run([payloadFrame("probeTargets", 10)]);
	assert.equal(result.status, 1);
	for (const line of result.stdout
		.split("\n")
		.filter((l) => l.includes("ci-log-guard [")))
		assert.match(line, /^::error::/);
});
