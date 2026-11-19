/**
 * The dev driver's `--attach` parser, fail-closed at the argument boundary.
 *
 * WHY THIS IS A TEST. The parser is the only thing standing between an operator's
 * launch and a scene that stages a file nobody named: it decides which arguments
 * are paths, refuses the relative ones, and reports a missing operand instead of
 * letting a run look like a rig bug in the composer. It imports nothing from
 * Electron precisely so this file can exercise the shipped module in process
 * (agent review round 1, m3).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `export { readAttachArguments } from "./src/main/dev-driver-attach";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.node.json",
	logLevel: "silent",
});
const { readAttachArguments } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#attach-parser`
);

test("both spellings stage the same paths in argument order", () => {
	const read = readAttachArguments([
		"--attach=/tmp/one.pdf",
		"--theme",
		"localOperatorDark",
		"--attach",
		"/tmp/two.txt",
	]);
	assert.deepEqual(read.paths, ["/tmp/one.pdf", "/tmp/two.txt"]);
	assert.deepEqual(read.problems, []);
});

test("a relative path is refused by name, never silently skipped", () => {
	const read = readAttachArguments(["--attach", "notes.pdf"]);
	assert.deepEqual(read.paths, []);
	assert.equal(read.problems.length, 1);
	assert.match(
		read.problems[0],
		/needs an absolute path|takes an absolute path/,
	);
	assert.match(read.problems[0], /notes\.pdf/);
});

test("a missing operand is a problem even when the next token is a flag", () => {
	const read = readAttachArguments(["--attach", "--scene", "attach"]);
	assert.deepEqual(read.paths, []);
	assert.equal(read.problems.length, 1);
	assert.match(read.problems[0], /needs an absolute path/);
});

test("an empty value is a problem, not an empty queue that looks like a rig bug", () => {
	const read = readAttachArguments(["--attach="]);
	assert.deepEqual(read.paths, []);
	assert.equal(read.problems.length, 1);
	assert.match(read.problems[0], /needs an absolute path/);
});

test("unrelated flags and their operands are left alone", () => {
	const read = readAttachArguments([
		"--scene",
		"attach",
		"--backend",
		"http://127.0.0.1:8080",
		"--attach",
		"/tmp/report.pdf",
	]);
	assert.deepEqual(read.paths, ["/tmp/report.pdf"]);
	assert.deepEqual(read.problems, []);
});
