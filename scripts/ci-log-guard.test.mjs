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

test("a quoted source statement is exempt; a diagnostic about the module is not", () => {
	const source = run([
		'  12 |   const mod = await import("data:text/javascript;base64,QUJD");',
	]);
	assert.equal(source.status, 0, source.stdout + source.stderr);

	const diagnostic = run([
		"Error: cannot import 'data:text/javascript;base64,QUJD'",
	]);
	assert.equal(diagnostic.status, 1, diagnostic.stdout + diagnostic.stderr);
	assert.match(diagnostic.stdout, /\[data-uri\]/);
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
