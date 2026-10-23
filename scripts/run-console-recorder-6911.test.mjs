import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRow, main } from "./run-console-recorder-6911.mjs";

const HEAD = "a".repeat(40);
function fixture(mode) {
	return {
		mode,
		pid: 11,
		pgid: 10,
		membersSeen: [
			{ pid: 11, pgid: 10, lstart: "proc:1" },
			{ pid: 12, pgid: 10, lstart: "proc:2" },
		],
		selected: 1,
		reaped: true,
		cleaned: true,
		timedOut: false,
		breached: false,
		blind: false,
		signal: null,
		rc: mode === "suppressed" ? 1 : 0,
		output:
			mode === "suppressed"
				? "recorder must retain both causally separated committed states"
				: "",
		summary: {
			diagnostic: "console-recorder-6911",
			mode,
			head: HEAD,
			node: "v22.23.3",
			pid: 12,
			ppid: 11,
			compiled_sha256: "b".repeat(64),
			createCalls: 1,
			entered: true,
			resolved: true,
			raw: [
				{ text: "Starting a console", at: 2, commitTime: 1.9 },
				{ text: "No console in this session", at: 5, commitTime: 4.9 },
			],
			recorded:
				mode === "suppressed"
					? []
					: ["Starting a console", "No console in this session"],
			phases: [
				{ phase: "create-entered", at: 1 },
				{ phase: "release", at: 3 },
				{ phase: "bridge-promise-fulfilled", at: 4 },
			],
		},
	};
}
test("pure three-mode evidence accepts only the intended original/positive/negative outcomes", () => {
	for (const mode of ["original", "held", "suppressed"])
		assert.ok(checkRow(fixture(mode), HEAD));
	const original = fixture("original");
	original.rc = 1;
	original.output = "the recorder sees commits, saw 1";
	assert.match(checkRow(original, HEAD), /FAIL, N1/);
});
test("pure missing identity, observer, ordering, cleanup and wrong-negative reason fail closed", () => {
	for (const [change, oracle] of [
		[
			(r) => {
				r.summary.head = "c".repeat(40);
			},
			/identity/,
		],
		[
			(r) => {
				r.selected = 0;
			},
			/execution/,
		],
		[
			(r) => {
				r.selected = 2;
			},
			/execution/,
		],
		[
			(r) => {
				r.summary.raw = [];
			},
			/observer/,
		],
		[
			(r) => {
				r.reaped = false;
			},
			/cleanup/,
		],
		[
			(r) => {
				r.timedOut = true;
			},
			/bound/,
		],
		[
			(r) => {
				r.summary.phases[1].at = 8;
			},
			/phase order/,
		],
		[
			(r) => {
				r.summary.raw[1].text = "Starting a console";
			},
			/distinct raw/,
		],
		[
			(r) => {
				r.output = "ERR_MODULE_NOT_FOUND";
			},
			/suppression oracle/,
		],
	]) {
		const row = fixture("suppressed");
		change(row);
		assert.throws(() => checkRow(row, HEAD), oracle);
	}
});

test("pure invalid CLI refuses before filesystem, dependency setup or child dispatch", async () => {
	await assert.rejects(() => main([]), /Expected explicit probe/);
});
