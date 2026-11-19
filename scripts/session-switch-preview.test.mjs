import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	MAX_SAMPLES,
	SCENES,
	SIZES,
	evidenceBlob,
	evidenceSummary,
	readFrame,
	sceneUrl,
	scrollHistory,
	startSamples,
} from "./session-switch-preview.mjs";

test("direct missing-case URLs select real cold admission, locales and same-owner target", () => {
	const params = (scene) =>
		new URL(sceneUrl(scene), "http://fixture/").searchParams;
	assert.equal(params("cold-long").get("boot"), "sidebar");
	assert.equal(params("cold-short").get("userLines"), null);
	assert.equal(params("ur-long").get("locale"), "ur");
	assert.equal(params("fr-long").get("locale"), "fr");
	assert.equal(params("reopen").get("outgoingSteps"), "90");
	assert.equal(params("reopen").get("domWindow"), "on");
	assert.equal(
		params("long").get("domWindow"),
		null,
		"retained scenes keep their prior defaults",
	);
	assert.equal(
		params("seal").get("userLines"),
		"0",
		"short request leaves the real seal trigger initially visible",
	);
	const entry = readFileSync(
		new URL("./session-switch.html", import.meta.url),
		"utf8",
	);
	assert.ok(
		entry.indexOf("localStorage.clear()") <
			entry.indexOf('localStorage.setItem("canonicalTranscriptDomWindow"'),
	);
	assert.ok(
		entry.indexOf('localStorage.setItem("canonicalTranscriptDomWindow"') <
			entry.indexOf('<script type="module"'),
	);
	for (const example of ["quote", "seal", "image"])
		assert.equal(params(example).get("userExample"), example);
});

const UNKNOWN = /Unknown preview scenario/;
test("host URLs preserve real ChatPage fixture and exact browsing-context sizes", () => {
	assert.deepEqual(SIZES.narrow, [800, 600]);
	assert.deepEqual(SIZES.wide, [1280, 900]);
	for (const scene of SCENES) {
		const url = new URL(sceneUrl(scene), "http://127.0.0.1:5211/");
		assert.equal(url.pathname, "/session-switch.html");
		assert.equal(url.searchParams.get("sessions"), "3");
		assert.equal(
			url.searchParams.get("outgoingSteps"),
			scene === "reopen" ? "90" : "1",
		);
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

test("authorized history controls only call native scrollTo on the production container", () => {
	for (const direction of ["column-reverse", "column"]) {
		const calls = [];
		const region = Object.freeze({
			scrollHeight: 2500,
			clientHeight: 500,
			scrollTop: -10,
			scrollTo: (options) => calls.push(options),
		});
		const doc = {
			querySelector: (selector) => {
				assert.equal(selector, "[data-lo-transcript-scroll]");
				return region;
			},
			defaultView: {
				getComputedStyle: (element) => {
					assert.equal(element, region);
					return { flexDirection: direction };
				},
			},
		};
		scrollHistory(doc, "start");
		scrollHistory(doc, "end");
		assert.deepEqual(
			calls,
			direction === "column-reverse"
				? [
						{ top: -2000, behavior: "instant" },
						{ top: 0, behavior: "instant" },
					]
				: [
						{ top: 0, behavior: "instant" },
						{ top: 2500, behavior: "instant" },
					],
		);
		assert.equal(
			region.scrollTop,
			-10,
			"helper must not assign scrollTop or other state directly",
		);
	}
	const html = readFileSync(
		new URL("./session-switch-preview.html", import.meta.url),
		"utf8",
	);
	assert.ok(html.includes('id="history-start"'));
	assert.ok(html.includes('id="history-end"'));
});

test("observer records scroll and stable container identity even while exact target is absent", () => {
	const region = { scrollTop: -2000, clientHeight: 500, scrollHeight: 2500 };
	const makeRow = () => ({
		querySelector: () => null,
		getAttribute: () => "abcdef000001-e87",
		getBoundingClientRect: () => ({ x: 0, y: 0, width: 600, height: 174 }),
		parentElement: null,
	});
	let row = makeRow();
	const doc = {
		activeElement: null,
		querySelector: (selector) =>
			selector === "[data-lo-transcript-scroll]"
				? region
				: selector.includes("data-record-kind")
					? row
					: null,
	};
	const frame = {
		contentDocument: doc,
		contentWindow: {
			innerWidth: 800,
			innerHeight: 600,
			location: {
				pathname: "/session-switch.html",
				href: "http://fixture/session-switch.html",
				hash: "#/chat/abcdef000001",
			},
			getComputedStyle: () => ({ flexDirection: "column-reverse" }),
			getSelection: () => null,
		},
	};
	const before = readFrame(frame, SIZES.narrow, "abcdef000001-e87");
	row = null;
	const absent = readFrame(frame, SIZES.narrow, "abcdef000001-e87");
	row = makeRow();
	const restored = readFrame(frame, SIZES.narrow, "abcdef000001-e87");
	assert.equal(absent.state, "target-not-mounted");
	assert.equal(absent.targetDomIdentity, null);
	assert.notEqual(before.targetDomIdentity, restored.targetDomIdentity);
	assert.equal(
		before.transcriptScroll.containerDomIdentity,
		absent.transcriptScroll.containerDomIdentity,
	);
	assert.deepEqual(before.transcriptScroll, restored.transcriptScroll);
	assert.equal(absent.transcriptScroll.scrollTop, -2000);
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

test("compact AX summary stays bounded while click-download bytes retain every early sample", async () => {
	const samples = Array.from({ length: MAX_SAMPLES }, (_, index) => ({
		state: "content-observed",
		elapsedMs: index * 16,
		cap: { height: index === 0 ? 900 : 174 },
		maxHeight: "174px",
		viewport: { width: 800, height: 600, matches: true },
		recordId: "synthetic-user",
		session: "#/chat/abcdef000001",
		focused: { tag: "BUTTON", text: "Show more", disclosure: true },
		scrolls: [{ top: 12, height: 600, scrollHeight: 900 }],
	}));
	const runs = Array.from({ length: 6 }, () => ({
		scenario: "long",
		expectedViewport: [800, 600],
		samples,
		done: true,
		stableFrames: 12,
	}));
	const summary = evidenceSummary("frozen-source-sha", runs);
	assert.ok(summary.length <= 2200);
	assert.equal(summary.split("\n").length, 11);
	for (const expected of [
		"frozen-source-sha",
		"Runs: 6",
		"900/174px",
		"174/174px",
		'"matches":true',
		"synthetic-user",
		"abcdef000001",
		"stable frames=12",
	]) {
		assert.ok(summary.includes(expected), expected);
	}
	const blob = evidenceBlob("frozen-source-sha", runs);
	assert.equal(blob.type, "application/json");
	const full = JSON.parse(await blob.text());
	assert.deepEqual(full, { source: "frozen-source-sha", runs });
	assert.equal(full.runs[0].samples[0].cap.height, 900);
	assert.equal(full.runs[5].samples.length, MAX_SAMPLES);
	assert.ok((await blob.text()).length > summary.length * 10);
	const html = readFileSync(
		new URL("./session-switch-preview.html", import.meta.url),
		"utf8",
	);
	assert.ok(html.includes('<select id="scene">'));
	assert.ok(html.includes('id="download-evidence"'));
	assert.ok(
		!html.includes("<details"),
		"hiding raw JSON in details does not bound its AX tree",
	);
});
