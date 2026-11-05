import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_SAMPLES,
	SCENES,
	SIZES,
	readFrame,
	sceneUrl,
	startSamples,
} from "./session-switch-preview.mjs";

const UNKNOWN = /Unknown preview scenario/;
test("host URLs preserve real ChatPage fixture and exact browsing-context sizes", () => {
	assert.deepEqual(SIZES.narrow, [800, 600]);
	assert.deepEqual(SIZES.wide, [1280, 900]);
	for (const scene of SCENES) {
		const url = new URL(sceneUrl(scene), "http://127.0.0.1:5211/");
		assert.equal(url.pathname, "/session-switch.html");
		assert.equal(url.searchParams.get("sessions"), "3");
		assert.equal(url.searchParams.get("outgoingSteps"), "1");
	}
	assert.throws(() => sceneUrl("arbitrary"), UNKNOWN);
	assert.equal(
		new URL(sceneUrl("echo"), "http://fixture/").searchParams.get("attachment"),
		"echo",
	);
});

test("viewport evidence reads the child window, not the iframe element's nominal size", () => {
	const doc = { querySelector: () => null, activeElement: null };
	const win = {
		innerWidth: 799,
		innerHeight: 600,
		location: {
			pathname: "/session-switch.html",
			href: "http://fixture/session-switch.html",
			hash: "#/chat/abcdef000001",
		},
		getSelection: () => null,
	};
	const frame = {
		width: "800",
		height: "600",
		contentDocument: doc,
		contentWindow: win,
	};
	assert.equal(readFrame(frame, SIZES.narrow).viewport.matches, false);
	win.innerWidth = 800;
	assert.equal(readFrame(frame, SIZES.narrow).viewport.matches, true);
	assert.equal(readFrame(frame, SIZES.narrow).state, "no-user-row");
});

function scheduler() {
	let time = 0;
	let callback;
	return {
		now: () => time,
		request: (fn) => {
			callback = fn;
			return 1;
		},
		cancel: () => {
			callback = null;
		},
		run: (elapsed = 16) => {
			const next = callback;
			callback = null;
			time += elapsed;
			next?.();
		},
		pending: () => !!callback,
	};
}

test("every early observation is retained with hard frame and wall bounds", () => {
	const clock = scheduler();
	let reads = 0;
	let result;
	startSamples(
		() => ({
			state: ++reads === 1 ? "no-user-row" : "content-observed",
			cap: { height: reads === 2 ? 900 : 174 },
		}),
		(run) => {
			result = run;
		},
		clock,
	);
	while (clock.pending()) clock.run();
	assert.equal(reads, MAX_SAMPLES);
	assert.equal(result.done, true);
	assert.equal(result.firstContentIndex, 1);
	assert.equal(
		result.samples[1].cap.height,
		900,
		"early oversize observation must not be overwritten by settled height",
	);
	assert.equal(result.samples.at(-1).cap.height, 174);
	const slow = scheduler();
	let slowReads = 0;
	startSamples(
		() => ({ index: ++slowReads }),
		() => {},
		slow,
	);
	while (slow.pending()) slow.run(1000);
	assert.equal(slowReads, 5);
	const stopped = scheduler();
	const cancel = startSamples(
		() => assert.fail("cancelled reader ran"),
		() => {},
		stopped,
	);
	cancel();
	assert.equal(stopped.pending(), false);
});
