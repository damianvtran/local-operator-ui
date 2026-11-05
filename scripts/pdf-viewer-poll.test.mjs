import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const bundled = await build({
	entryPoints: [
		"src/renderer/src/features/chat/components/canvas/pdf-viewer-poll.ts",
	],
	bundle: true,
	format: "esm",
	write: false,
});
const { watchPdfViewer } = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("polls never overlap and stop on parsed readiness", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let complete;
	let calls = 0;
	const statuses = [];
	const cancel = watchPdfViewer(
		() => {
			calls++;
			return new Promise((resolve) => {
				complete = resolve;
			});
		},
		(s) => statuses.push(s),
	);
	t.mock.timers.tick(1000);
	assert.equal(calls, 1);
	complete("loading");
	await flush();
	t.mock.timers.tick(250);
	assert.equal(calls, 2);
	complete("ready");
	await flush();
	t.mock.timers.tick(60_000);
	assert.deepEqual(statuses, ["ready"]);
	assert.equal(calls, 2);
	cancel();
});

test("hung IPC ends visibly at deadline and cannot resurrect the preview", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let complete;
	let calls = 0;
	const statuses = [];
	watchPdfViewer(
		() => {
			calls++;
			return new Promise((resolve) => {
				complete = resolve;
			});
		},
		(s) => statuses.push(s),
	);
	t.mock.timers.tick(30_000);
	assert.deepEqual(statuses, ["failed"]);
	assert.equal(calls, 1);
	complete("ready");
	await flush();
	assert.deepEqual(statuses, ["failed"]);
});

test("closed/superseded tabs discard late status and cancel all timers", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let complete;
	const statuses = [];
	const cancel = watchPdfViewer(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
		(s) => statuses.push(s),
	);
	cancel();
	complete("ready");
	await flush();
	t.mock.timers.tick(60_000);
	assert.deepEqual(statuses, []);
});

test("transient host rejection may recover; parse failure is terminal", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let calls = 0;
	const statuses = [];
	watchPdfViewer(
		async () => {
			if (++calls === 1) throw new Error("host transitioning");
			return "failed";
		},
		(s) => statuses.push(s),
	);
	await flush();
	t.mock.timers.tick(250);
	await flush();
	assert.deepEqual(statuses, ["failed"]);
	t.mock.timers.tick(60_000);
	assert.equal(calls, 2);
});
