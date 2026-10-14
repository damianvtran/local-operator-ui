import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the shipped pure module in memory: no install, generated repo files or
// browser substitutes. Assertions cover the chronological column, not the
// reversed outer flex axis; confusing those axes is the primary regression.
const DUPLICATE_ERROR_RE = /duplicate/i;
const result = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-dom-window"; export * from "./src/renderer/src/features/chat/canonical/transcript-view-state"; export * from "./src/renderer/src/features/chat/canonical/transcript-scroll-layout";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	platform: "node",
	format: "esm",
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("prefix heights retain fractions and invalidate incompatible measurements", () => {
	assert.equal(
		typeof model.buildHeightIndex,
		"function",
		"height-index contract must exist",
	);
	const entries = [
		{ key: "a", signature: "1", estimate: 40.5 },
		{ key: "b", signature: "2", estimate: 120 },
		{ key: "c", signature: "3", estimate: 60 },
	];
	const cache = new Map([
		["a", { signature: "1", width: 600, height: 41.25 }],
		["b", { signature: "old", width: 600, height: 900 }],
		["c", { signature: "3", width: 500, height: 800 }],
	]);
	assert.deepEqual(
		model.buildHeightIndex(entries, cache, 600),
		[0, 41.25, 161.25, 221.25],
	);
	assert.deepEqual(model.buildHeightIndex([], cache, 600), [0]);
	assert.throws(
		() => model.buildHeightIndex([entries[0], entries[0]], cache, 600),
		DUPLICATE_ERROR_RE,
	);
});

test("range intervals and disjoint leases conserve total extent without mounting the span", () => {
	assert.equal(
		typeof model.windowSegments,
		"function",
		"range contract must exist",
	);
	const prefix = [0, 40, 160, 220, 420, 500];
	const pieces = model.windowSegments(prefix, 200, 380, 0, [0]);
	assert.deepEqual(pieces, [
		{ kind: "entry", index: 0 },
		{ kind: "spacer", start: 1, end: 2, height: 120 },
		{ kind: "entry", index: 2 },
		{ kind: "entry", index: 3 },
		{ kind: "spacer", start: 4, end: 5, height: 80 },
	]);
	const extent = pieces.reduce(
		(sum, piece) =>
			sum +
			(piece.kind === "spacer"
				? piece.height
				: prefix[piece.index + 1] - prefix[piece.index]),
		0,
	);
	assert.equal(extent, 500);
	assert.deepEqual(model.windowSegments([0], 0, 200, 200, []), []);
	assert.deepEqual(model.windowSegments([0, 2000], 600, 800, 0, []), [
		{ kind: "entry", index: 0 },
	]);
	assert.deepEqual(model.windowSegments([0, 20, 40], 20, 40, 0, []), [
		{ kind: "spacer", start: 0, end: 1, height: 20 },
		{ kind: "entry", index: 1 },
	]);
});

test("trusted layout correction catches equal extent redistribution and shrink, not stale input", () => {
	assert.equal(
		typeof model.layoutTransactionDrift,
		"function",
		"trusted-layout correction must exist",
	);
	const before = { id: "held", viewportOffset: -12, extent: 500 };
	assert.equal(
		model.layoutTransactionDrift(
			before,
			{ ...before, viewportOffset: 18 },
			4,
			4,
		),
		30,
	);
	assert.equal(
		model.layoutTransactionDrift(
			before,
			{ ...before, viewportOffset: -42, extent: 470 },
			4,
			4,
		),
		-30,
	);
	assert.equal(
		model.layoutTransactionDrift(
			before,
			{ ...before, viewportOffset: 18 },
			4,
			5,
		),
		null,
	);
	assert.equal(
		model.layoutTransactionDrift(before, { ...before, id: "other" }, 4, 4),
		null,
	);
});

test("candidate owner atomically replaces two rows with one aggregate, never three inline rows", () => {
	assert.equal(
		typeof model.candidateSlots,
		"function",
		"candidate slot contract must exist",
	);
	const row = (key, gap = "trace") => ({
		key,
		firstId: key,
		candidate: true,
		boundary: gap === "turn",
		representation: "inline",
	});
	const before = model.candidateSlots([row("a", "turn"), row("b")]);
	const after = model.candidateSlots([
		{
			key: "a",
			firstId: "a",
			candidate: false,
			boundary: true,
			representation: "aggregate",
		},
	]);
	assert.equal(before.length, 1);
	assert.equal(before[0].key, after[0].key);
	assert.deepEqual(before[0].indices, [0, 1]);
	assert.deepEqual(after[0].indices, [0]);
	assert.equal(after[0].representation, "aggregate");
	assert.equal(model.candidateSlots([row("a"), row("b", "turn")]).length, 2);
});

test("one coordinator preserves held identity through equal-extent commits and motion, but reader input wins", () => {
	let input = 4;
	let y = 12;
	let scroll = -100;
	let follows = false;
	let connected = true;
	const held = { id: "held", viewportOffset: 12, extent: 500 };
	const layout = model.createScrollLayoutCoordinator({
		held: () => held,
		sample: () => {
			throw new Error("must not pick a competing anchor");
		},
		measure: (id) =>
			connected && id === "held" ? { ...held, viewportOffset: y } : null,
		inputRevision: () => input,
		following: () => follows,
		write: (drift) => {
			scroll = drift === "tail" ? 0 : scroll + drift;
			y = 12;
		},
	});
	layout.begin();
	assert.equal(layout.heldId(), "held");
	const release = layout.retainMotion();
	y += 30;
	assert.equal(layout.commit(), true);
	assert.equal(scroll, -70);
	assert.equal(layout.heldId(), "held");
	y -= 22;
	layout.commit();
	assert.equal(scroll, -92);
	release();
	layout.commit();
	layout.begin();
	input += 1;
	y += 100;
	layout.commit();
	assert.equal(scroll, -92);
	follows = true;
	layout.begin();
	layout.commit();
	assert.equal(scroll, 0);
	follows = false;
	layout.begin();
	connected = false;
	assert.equal(
		layout.commit(),
		false,
		"missing anchor must diagnose/fall back, not silently pass",
	);
});

test("a transaction's original held identity remains leased when a same-input pager scroll refresh picks a new row", () => {
	let held = { id: "original", viewportOffset: 0, extent: 500 };
	const layout = model.createScrollLayoutCoordinator({
		held: () => held,
		sample: () => held,
		measure: () => held,
		inputRevision: () => 1,
		following: () => false,
		write() {},
	});
	layout.begin();
	held = { ...held, id: "refreshed" };
	assert.equal(
		layout.heldId(),
		"original",
		"the node commit() will measure must remain mounted",
	);
});

test("a row hidden by structural consolidation retargets to the surviving first-slot anchor without changing input", () => {
	let held = { id: "child", viewportOffset: 0, extent: 500 };
	let delta = 0;
	const layout = model.createScrollLayoutCoordinator({
		held: () => held,
		sample: () => held,
		measure: (id) => ({
			id,
			viewportOffset: id === "parent" ? -200 : 0,
			extent: 500,
		}),
		inputRevision: () => 9,
		following: () => false,
		replaceHeld: (sample) => {
			held = sample;
		},
		write: (value) => {
			delta = value;
		},
	});
	layout.begin();
	assert.equal(
		typeof layout.retarget,
		"function",
		"structural replacement needs an explicit anchor mapping",
	);
	layout.retarget("child", "parent");
	assert.equal(layout.heldId(), "parent");
	assert.equal(held.id, "parent");
	assert.equal(
		held.viewportOffset,
		0,
		"an offscreen first slot replaces the reader's disappearing point",
	);
	layout.commit();
	assert.equal(delta, -200);
});

test("formation defers only an inline owner the reader is interacting with, without changing the model threshold", () => {
	assert.equal(typeof model.deferAggregateFormation, "function");
	assert.equal(model.deferAggregateFormation("inline", true), true);
	assert.equal(model.deferAggregateFormation("inline", false), false);
	assert.equal(model.deferAggregateFormation("fold", true), false);
});

test("cold text estimates scale with wrapping and per-kind calibration freezes until regime changes", () => {
	assert.equal(typeof model.estimateEntryHeight, "function");
	assert.equal(typeof model.seedEntryEstimates, "function");
	assert.ok(
		model.estimateEntryHeight("assistant", "x".repeat(9000), 12, 810) >
			model.estimateEntryHeight("assistant", "Short answer", 12, 810) * 10,
	);
	const entries = ["a", "b", "c", "cold"].map((key) => ({
		key,
		signature: "1",
		estimateKind: "answer",
		estimate: 96,
	}));
	const measured = new Map([
		...[40, 41, 1000].map((height, index) => [
			entries[index].key,
			{ signature: "1", width: 600, height, kind: "answer" },
		]),
	]);
	const frozen = new Map();
	assert.equal(
		model.seedEntryEstimates(entries, measured, frozen, 600)[3].estimate,
		41,
	);
	measured.set("c", { signature: "1", width: 600, height: 80, kind: "answer" });
	measured.set("b", { signature: "1", width: 600, height: 79, kind: "answer" });
	assert.equal(
		model.seedEntryEstimates(entries, measured, frozen, 600)[3].estimate,
		41,
		"new samples must not resize omitted history",
	);
	assert.equal(
		model.seedEntryEstimates(entries, measured, frozen, 500)[3].estimate,
		96,
	);
});

test("font invalidation demotes omitted measurements without collapsing the formation prefix", () => {
	const entries = ["history", "context", "formation"].map((key) => ({
		key,
		signature: "inline",
		estimate: 70.4,
		estimateKind: "text",
	}));
	const measured = new Map(
		entries.map((entry, index) => [
			entry.key,
			{
				signature: entry.signature,
				width: 810,
				height: index === 0 ? 74.3984375 : 54,
				kind: "text",
			},
		]),
	);
	const frozen = new Map();
	model.seedEntryEstimates(entries, measured, frozen, 810);
	const before = model.buildHeightIndex(entries, measured, 810);
	// A font notification can arrive after history unmounts and a fold forms.
	// History must lose exact status, but not its last known scalar extent.
	model.invalidateEntryMeasurements(measured, frozen);
	assert.equal(measured.size, 0);
	const folded = entries.map((entry) =>
		entry.key === "formation" ? { ...entry, signature: "fold" } : entry,
	);
	measured.set("context", { signature: "inline", width: 810, height: 54 });
	measured.set("formation", {
		signature: "fold",
		width: 810,
		height: 33.4453125,
	});
	const after = model.buildHeightIndex(
		model.seedEntryEstimates(folded, measured, frozen, 810),
		measured,
		810,
	);
	assert.equal(after[1], before[1]);
	assert.equal(after[2], before[2]);
	assert.equal(after[3] - after[2], 33.4453125);
	assert.equal(
		model.seedEntryEstimates(folded, new Map(), frozen, 600)[0].estimate,
		70.4,
		"width changes reject old scalar estimates",
	);
	assert.equal(
		model.seedEntryEstimates(
			[{ ...entries[0], signature: "edited" }],
			new Map(),
			frozen,
			810,
		)[0].estimate,
		70.4,
		"edited content rejects old scalar estimates",
	);
});

test("session view state preserves reader expansion across subscriber unmount and prunes only deleted records", () => {
	assert.equal(
		typeof model.TranscriptViewState,
		"function",
		"persistent view-state contract must exist",
	);
	const state = new model.TranscriptViewState();
	let calls = 0;
	const unmount = state.subscribe("user:1", () => {
		calls += 1;
	});
	state.write("user:1", true);
	assert.equal(calls, 1);
	unmount();
	state.prune(new Set(["user:1"]));
	assert.equal(state.read("user:1"), true);
	state.write("user:1", true);
	assert.equal(calls, 1);
	state.prune(new Set());
	assert.equal(state.read("user:1"), false);
});
