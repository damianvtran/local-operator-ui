/**
 * The fold-open registry: the reader's explicit open/close, held across the
 * identity churn that remounts a fold.
 *
 * WHY THIS FILE EXISTS (operator report, 2026-09-27): "Expanded states of
 * action groups should survive being off screen and updates to the
 * conversation ... they shouldn't be closed/contracted simply by state updates
 * if they've been explicitly opened." A fold's React key is the first row of
 * its run, and the transcript mounts only the newest 60 rows - so an incoming
 * row drops the window's oldest row, and when that edge walks through a run the
 * fold's key changes, React mounts a fresh instance, and instance-local state
 * is gone. The walk is MEASURED on the rig (`scripts/scroll-shift-evidence.mjs`,
 * fold rounds: `[t1..t4]` -> `[t2..t4]` with `expanded true -> false` in the
 * trace); this file pins the arithmetic that makes the registry immune to it:
 * lookup by exact first id, fallback by any shared id, migration on write, and
 * pruning only against a live-record set the caller supplies.
 *
 * WHAT THIS CANNOT SAY. That the transcript wires the registry to the fold's
 * `open`/`onOpenChange` - `trace-fold-behaviour.test.mjs` mounts the shipped
 * component for that - or that the fold's body actually paints and unpaints
 * with the state; `Disclosure`'s own suite and the rig's frames carry that.
 *
 * Bundled the way the rest of this suite bundles shipped TypeScript
 * (`scripts/trace-fold-model.test.mjs` states the reason the memory bundle
 * exists).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/fold-open";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { foldOpenOf, withFoldOpen } = await import(moduleUrl);

/** The caller's live-record set: every id the conversation still holds. */
const keep = (...ids) => new Set(ids);

test("a fold with no entry is closed - the shipped default", () => {
	assert.equal(foldOpenOf([], ["t1", "t2", "t3"]), false);
});

test("an explicit open survives the window edge walking through the run", () => {
	const live = keep("t1", "t2", "t3", "t4", "p1");
	const opened = withFoldOpen([], ["t1", "t2", "t3", "t4"], true, live);
	assert.equal(opened.length, 1);

	// The render window's edge drops the run's first row: [t1..t4] -> [t2..t4].
	// The instance remounts, and the lookup must still answer `true`.
	assert.equal(foldOpenOf(opened, ["t2", "t3", "t4"]), true);
	// A second incoming row drops another: [t3, t4].
	assert.equal(foldOpenOf(opened, ["t3", "t4"]), true);
	// And the id set can grow back the other way (a widen): [t1..t4].
	assert.equal(foldOpenOf(opened, ["t1", "t2", "t3", "t4"]), true);
});

test("a write migrates the entry to the current id set instead of duplicating", () => {
	const live = keep("t1", "t2", "t3", "t4");
	const opened = withFoldOpen([], ["t1", "t2", "t3", "t4"], true, live);
	// The reader closes it while the window has eaten the first row.
	const closed = withFoldOpen(opened, ["t2", "t3", "t4"], false, live);
	assert.equal(closed.length, 1, "one fold, one entry");
	assert.equal(foldOpenOf(closed, ["t2", "t3", "t4"]), false);
	assert.equal(
		foldOpenOf(closed, ["t1", "t2", "t3", "t4"]),
		false,
		"the migrated entry answers for the full set too",
	);
});

test("both directions: a closed fold is not re-opened by churn either", () => {
	const live = keep("a1", "a2", "a3");
	// The reader pressed once to arrive at closed (the default), then the edge
	// walks.
	const closed = withFoldOpen([], ["a1", "a2", "a3"], false, live);
	assert.equal(foldOpenOf(closed, ["a1", "a2", "a3"]), false);
	assert.equal(foldOpenOf(closed, ["a2", "a3"]), false);
});

test("two runs in one conversation keep separate state", () => {
	const live = keep("a1", "a2", "a3", "b1", "b2", "b3");
	let entries = withFoldOpen([], ["a1", "a2", "a3"], true, live);
	entries = withFoldOpen(entries, ["b1", "b2", "b3"], false, live);
	assert.equal(entries.length, 2);
	assert.equal(foldOpenOf(entries, ["a1", "a2", "a3"]), true);
	assert.equal(foldOpenOf(entries, ["b1", "b2", "b3"]), false);
	// Neither run's churn touches the other's entry.
	entries = withFoldOpen(entries, ["a2", "a3"], true, live);
	assert.equal(entries.length, 2);
	assert.equal(foldOpenOf(entries, ["a2", "a3"]), true);
	assert.equal(foldOpenOf(entries, ["b1", "b2", "b3"]), false);
});

test("entries for rows the conversation no longer holds are pruned", () => {
	const opened = withFoldOpen(
		[],
		["x1", "x2", "x3"],
		true,
		keep("x1", "x2", "x3"),
	);
	assert.equal(opened.length, 1);
	// The conversation reseeds: x's rows are gone, y's arrive. The next write
	// carries the new live set, and the dead entry falls away with it.
	const next = withFoldOpen(
		opened,
		["y1", "y2", "y3"],
		true,
		keep("y1", "y2", "y3"),
	);
	assert.equal(next.length, 1);
	assert.equal(foldOpenOf(next, ["x1", "x2", "x3"]), false);
	assert.equal(foldOpenOf(next, ["y1", "y2", "y3"]), true);
});

test("a fold is kept while any of its rows is still live, window or not", () => {
	/*
	 * The off-screen case the report names. The fold's rows have left the RENDER
	 * WINDOW but not the conversation, so the caller's live set is the
	 * conversation's full record set, and `any shared id` is the pruning
	 * predicate too - a stricter one ("all ids live") would drop this entry the
	 * moment the window's edge walked past it, which is the reported bug one
	 * scroll later.
	 */
	const everything = keep("d1", "d2", "d3", "d4", "d5", "d6");
	const opened = withFoldOpen([], ["d1", "d2", "d3"], true, everything);
	// A later write from another fold, same live set: the entry survives.
	const entries = withFoldOpen(opened, ["d4", "d5", "d6"], false, everything);
	assert.equal(entries.length, 2);
	assert.equal(foldOpenOf(entries, ["d1", "d2", "d3"]), true);
	// And when the conversation itself drops those rows, the next write prunes it.
	const afterReseed = withFoldOpen(
		entries,
		["d4", "d5", "d6"],
		false,
		keep("d4", "d5", "d6"),
	);
	assert.equal(afterReseed.length, 1);
	assert.equal(foldOpenOf(afterReseed, ["d1", "d2", "d3"]), false);
	assert.equal(foldOpenOf(afterReseed, ["d4", "d5", "d6"]), false);
});
