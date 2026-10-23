import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkRow,
	main,
	cleanupOwned,
	handledTask,
} from "./run-console-recorder-6911.mjs";

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

test("cleanup always reaps and waits after stop or observation rejection", async () => {
	for (const fault of [
		"stop",
		"sampling",
		"tripKill",
		"timerKill",
		"hardKill",
	]) {
		const calls = [],
			errors = [];
		const tasks = ["sampling", "tripKill", "timerKill", "hardKill"].map(
			(label) =>
				handledTask(
					() => {
						if (label === fault) throw new Error(label);
						return true;
					},
					errors,
					label,
				),
		);
		const result = await cleanupOwned(
			{
				stop: () => {
					calls.push("stop");
					if (fault === "stop") throw new Error("stop");
				},
				tasks: () => tasks,
				reap: () => {
					calls.push("reap");
					return true;
				},
				settled: () => {
					calls.push("settled");
					return true;
				},
				waited: () => {
					calls.push("wait");
					return true;
				},
				remove: () => {
					calls.push("remove");
				},
			},
			errors,
			100,
		);
		assert.deepEqual(calls, ["stop", "reap", "settled", "wait", "remove"]);
		assert.equal(result.settled, true);
		assert.equal(
			result.clean,
			false,
			"retained observation error cannot wear a PASS",
		);
		assert.ok(result.errors.length);
	}
});

test("unknown ownership, memory blindness and failed final wait retain owned files", async () => {
	for (const fault of [
		"unknown-PG",
		"memory-blind",
		"final-wait",
		"final-reap",
	]) {
		const calls = [],
			errors = [];
		const result = await cleanupOwned(
			{
				stop: () => calls.push("stop"),
				tasks: () => [],
				reap: () => {
					calls.push("reap");
					if (fault === "final-reap") throw new Error("reap");
					return true;
				},
				settled: () => {
					calls.push("settled");
					if (fault === "unknown-PG") throw new Error("unknown");
					return fault === "final-wait";
				},
				waited: () => {
					calls.push("wait");
					if (fault === "final-wait") throw new Error("wait");
					return true;
				},
				remove: () => calls.push("remove"),
			},
			errors,
			100,
		);
		assert.ok(calls.includes("reap") && calls.includes("wait"));
		assert.equal(result.settled, false);
		assert.equal(result.removed, false);
		assert.equal(result.clean, false);
		assert.ok(
			!calls.includes("remove"),
			"no unlink before physical settlement",
		);
	}
});

test("spawn-with-no-child and final deletion errors are honest, never a clean probe", async () => {
	const order = [],
		errors = ["spawn:Error"];
	const result = await cleanupOwned(
		{
			stop() {},
			tasks: () => [],
			reap: () => {
				order.push("reap-no-child");
				return true;
			},
			settled: () => true,
			waited: () => {
				order.push("wait-no-child");
				return true;
			},
			remove: () => {
				order.push("remove");
				throw new Error("delete");
			},
		},
		errors,
		100,
	);
	assert.deepEqual(order, ["reap-no-child", "wait-no-child", "remove"]);
	assert.equal(result.settled, true);
	assert.equal(result.removed, false);
	assert.equal(result.clean, false);
	assert.ok(result.errors.some((e) => e.startsWith("remove-owned:")));
});
