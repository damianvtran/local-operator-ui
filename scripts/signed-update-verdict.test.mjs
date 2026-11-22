import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { signedUpdateVerdict } from "./signed-update-verdict.mjs";

const script = fileURLToPath(
	new URL("./signed-update-verdict.mjs", import.meta.url),
);
const context = { trigger: "workflow_dispatch", runId: "12345" };
const unsanitized = /https?:|file:|\.[a-z]{2,}(?=\s|$)|[/\\]|second line/i;
const row = (surface, verdict, actual = "fixture diagnosis") => ({
	surface,
	verdict,
	actual,
});
const pass = row("Incumbent identity", "PASS");

function fixture(t, matrix) {
	const dir = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(),
			"signed-update-verdict-",
		),
	);
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	if (matrix !== undefined)
		writeFileSync(
			join(dir, "matrix.json"),
			typeof matrix === "string" ? matrix : JSON.stringify(matrix),
		);
	return dir;
}

// Use the same CLI and summary channel as Actions, not just the library return.
function verify(t, matrix, { verdict, codes, reasonCodes = [], detail }) {
	const dir = fixture(t, matrix);
	const expected = signedUpdateVerdict(dir, context);
	assert.deepEqual(expected, {
		verdict,
		codes,
		reasonCodes,
		exitCode: verdict === "PASS" ? 0 : 1,
		message: `Signed update proof: ${verdict} (workflow_dispatch, run 12345) — ${detail}`,
	});
	const summary = join(dir, "summary.md");
	const run = spawnSync(process.execPath, [script, dir], {
		encoding: "utf8",
		env: {
			GITHUB_EVENT_NAME: context.trigger,
			GITHUB_RUN_ID: context.runId,
			GITHUB_STEP_SUMMARY: summary,
		},
	});
	assert.ifError(run.error);
	assert.equal(run.status, expected.exitCode);
	assert.equal(run.stderr, "");
	assert.equal(run.stdout, `${expected.message}\n`);
	assert.equal(readFileSync(summary, "utf8"), `### ${expected.message}\n`);
	assert.doesNotMatch(run.stdout, unsanitized);
}

test("all rows PASS produces a green proof", (t) => {
	verify(t, [pass, row("Swap before candidate launch", "PASS")], {
		verdict: "PASS",
		codes: ["PASS"],
		detail: "all 2 matrix rows passed",
	});
});

test("INCUP_UPDATE_CONTROL remains blocked even with passing rows", (t) => {
	verify(
		t,
		[
			pass,
			row(
				"Exact signed update",
				"BLOCKED",
				"INCUP_UPDATE_CONTROL: file:///private/scratch\nsecond line",
			),
		],
		{
			verdict: "BLOCKED",
			codes: ["PASS", "BLOCKED"],
			reasonCodes: ["INCUP_UPDATE_CONTROL"],
			detail: "INCUP_UPDATE_CONTROL: Exact signed update",
		},
	);
});

test("published metadata absence from run 45071898265 is a red proof", (t) => {
	verify(
		t,
		[
			row(
				"Exact signed update",
				"BLOCKED",
				"The exact incumbent release has no published macOS metadata",
			),
		],
		{
			verdict: "BLOCKED",
			codes: ["BLOCKED"],
			reasonCodes: ["METADATA_RESOLUTION"],
			detail: "METADATA_RESOLUTION: Exact signed update",
		},
	);
});

test("hosted GUI absence is reported without including raw diagnostics", (t) => {
	verify(
		t,
		[
			row(
				"Exact signed update",
				"BLOCKED",
				"The hosted runner lacks a native GUI launchd session; log at /Users/fixture/probe",
			),
		],
		{
			verdict: "BLOCKED",
			codes: ["BLOCKED"],
			reasonCodes: ["GUI_SESSION_ABSENT"],
			detail: "GUI_SESSION_ABSENT: Exact signed update",
		},
	);
});

test("blocked classification does not consult subsequent lines", (t) => {
	verify(
		t,
		[
			row(
				"Exact signed update",
				"BLOCKED",
				"unknown refusal\nINCUP_UPDATE_CONTROL",
			),
		],
		{
			verdict: "BLOCKED",
			codes: ["BLOCKED"],
			reasonCodes: ["UNCLASSIFIED_BLOCK"],
			detail: "UNCLASSIFIED_BLOCK: Exact signed update",
		},
	);
});

test("FAIL outranks BLOCKED and names only sanitized failed surfaces", (t) => {
	verify(
		t,
		[
			pass,
			row("Exact signed update", "BLOCKED"),
			row(
				"Candidate relaunch https://example.test/u /private/tmp/matrix C:\\Users\\fixture fixture.test\nsecond line",
				"FAIL",
				"unpublished detail at https://example.test/secret",
			),
			row("Candidate signature", "FAIL"),
		],
		{
			verdict: "FAIL",
			codes: ["PASS", "BLOCKED", "FAIL"],
			detail: "failed surfaces: Candidate relaunch, Candidate signature",
		},
	);
});

for (const [reason, matrix] of [
	["absent file", undefined],
	["empty file", ""],
	["malformed JSON", '{"path":"/private/tmp/matrix"'],
	["empty matrix", []],
	["non-array matrix", { rows: [pass] }],
	[
		"unrecognized row among PASS rows",
		[pass, row("Candidate signature", "SKIPPED")],
	],
]) {
	test(`${reason} means no proof artifact`, (t) => {
		verify(t, matrix, {
			verdict: "BLOCKED",
			codes: [],
			reasonCodes: ["NO_PROOF_ARTIFACT"],
			detail:
				"NO_PROOF_ARTIFACT: no proof artifact with a valid, nonempty matrix",
		});
	});
}

test("no downloaded directory and malformed run context produce only typed fallbacks", () => {
	const result = signedUpdateVerdict("", {
		trigger: "https://example.test",
		runId: "/private/tmp/run",
	});
	assert.equal(result.exitCode, 1);
	assert.equal(
		result.message,
		"Signed update proof: BLOCKED (unknown trigger, unknown run) — NO_PROOF_ARTIFACT: no proof artifact with a valid, nonempty matrix",
	);
});
