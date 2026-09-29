import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SHARED BACKWARD LOADER — the walk to a row, its budgets, and the
 * outline's turn identity.
 *
 * This is the policy three callers used to carry copies of (the reader's
 * paging, the align fetch, the jump's `ensureReachable`), so the cases here are
 * the ones a copy drifts on: a budget spent in pages AND rows, a walk that
 * must stop when history ends rather than spin, the margin fetch a centred
 * landing needs (QA Q-2), one in-flight fetch shared by concurrent callers,
 * and the OUTLINE case the collapse lane's diagnosis named (credited): a turn
 * first seen with its head cut off keeps its identity when the opening user
 * row arrives, so an expansion keyed on that identity survives the head.
 *
 * `window` is not in node; the module only touches it inside functions, so the
 * fake below is installed before any walk runs and never at import time.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-loader";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
});
const loader = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

globalThis.window = {
	requestAnimationFrame: (callback) => {
		setTimeout(callback, 0);
		return 0;
	},
};

/** A user row. */
const user = (id, text = "hello") => ({
	record: { kind: "user", id, ts: 1, text, images: [] },
	gap: "first",
	closesTurn: false,
});

/** An answer row. */
const answer = (id, text = "done") => ({
	record: { kind: "assistant", id, ts: 2, text, streaming: false },
	gap: "turn",
	closesTurn: true,
});

/**
 * A pager over a fake model: `rows` is the distance-from-tail count the model
 * holds, `loadOlder` prepends `perPage` more (until `historyEnd`), and the
 * target is reachable once its distance is within `mounted`.
 */
const pager = ({
	perPage = 100,
	tail = 0,
	historyEnd = Number.POSITIVE_INFINITY,
	headroom = true,
	windowAt = 0,
} = {}) => {
	const calls = { loads: 0, mounts: [] };
	const state = { held: tail, window: windowAt };
	/*
	 * `walkFor(distance)` closes over the row, mirroring the real callers: the
	 * row is `distance` from the tail, held once `held` reaches it, reachable
	 * once the render window is wide enough.
	 */
	return {
		calls,
		walkFor: (distance) => ({
			reachable: () => state.held >= distance && distance <= state.window,
			rowDistance: () => (state.held >= distance ? distance : null),
			mount: (width) => {
				calls.mounts.push(width);
				state.window = width;
			},
			loadOlder: async () => {
				calls.loads += 1;
				if (state.held >= historyEnd) return false;
				state.held = Math.min(state.held + perPage, historyEnd);
				return true;
			},
			/*
			 * `headroom: false` means the store ends AT the target until a
			 * page arrives: the QA Q-2 shape, where the landing would clamp
			 * at the content's top.
			 */
			...(headroom === false ? { hasHeadroom: () => state.held > tail } : {}),
		}),
	};
};

test("a row the model already shows is landed without a fetch or a mount", async () => {
	const fake = pager({ tail: 500, windowAt: 500 });
	const walk = loader.createBackwardLoader(fake.walkFor(10));
	const outcome = await walk.loadThrough({ maxPages: 4 });
	assert.equal(outcome, "landed");
	assert.equal(fake.calls.loads, 0);
	assert.deepEqual(fake.calls.mounts, []);
});

test("the walk loads until the row is held, then mounts it and lands", async () => {
	const fake = pager({ perPage: 100, tail: 0 });
	const walk = loader.createBackwardLoader(fake.walkFor(350));
	const outcome = await walk.loadThrough({ maxPages: 8 });
	assert.equal(outcome, "landed");
	assert.equal(fake.calls.loads, 4, "four pages bring 350 within held rows");
	assert.deepEqual(
		fake.calls.mounts,
		[350],
		"the mount is the distance it sits",
	);
});

test("history that ends before the row is an exhausted walk, not a spin", async () => {
	const fake = pager({ perPage: 100, historyEnd: 200 });
	const walk = loader.createBackwardLoader(fake.walkFor(350));
	const outcome = await walk.loadThrough({ maxPages: 8 });
	assert.equal(outcome, "exhausted");
	assert.equal(
		fake.calls.loads,
		3,
		"two applied pages, then the false one stops it",
	);
	assert.deepEqual(
		fake.calls.mounts,
		[],
		"nothing to mount for a row the store lacks",
	);
});

test("a held row beyond the row budget is refused as over-budget", async () => {
	const fake = pager({ perPage: 2000 });
	const walk = loader.createBackwardLoader(fake.walkFor(1500));
	const outcome = await walk.loadThrough({ maxPages: 4, maxRows: 1200 });
	assert.equal(outcome, "over-budget");
	assert.deepEqual(fake.calls.mounts, [], "a refused row is never mounted");
});

test("pages are spent at most once past the budget", async () => {
	const fake = pager({ perPage: 10 });
	const walk = loader.createBackwardLoader(fake.walkFor(10000));
	const outcome = await walk.loadThrough({ maxPages: 3 });
	assert.equal(outcome, "exhausted");
	assert.equal(fake.calls.loads, 3, "exactly the budget, never one more");
});

test("a held row without headroom fetches the margin before mounting (QA Q-2)", async () => {
	const fake = pager({ perPage: 100, tail: 40, headroom: false });
	const walk = loader.createBackwardLoader(fake.walkFor(40));
	const outcome = await walk.loadThrough({ maxPages: 4 });
	assert.equal(outcome, "landed");
	assert.equal(fake.calls.loads, 1, "the margin page");
	assert.deepEqual(fake.calls.mounts, [40]);
});

test("a margin history cannot supply mounts clamped rather than spinning (R-MINOR-2)", async () => {
	/*
	 * The margin ask's refusal fall-through: history ends AT the row, so the
	 * extra page applies nothing. The walk must take the clamped mount (the
	 * Q-2 landing) rather than treating the failed page as an exhausted walk -
	 * the row IS held, and the refusal here is about the margin, not the row.
	 */
	const fake = pager({
		perPage: 100,
		tail: 40,
		headroom: false,
		historyEnd: 40,
	});
	const walk = loader.createBackwardLoader(fake.walkFor(40));
	const outcome = await walk.loadThrough({ maxPages: 4 });
	assert.equal(outcome, "landed");
	assert.equal(fake.calls.loads, 1, "the single margin ask");
	assert.deepEqual(
		fake.calls.mounts,
		[40],
		"the fall-through is the mount, clamped at content top",
	);
});

test("one in-flight fetch serves concurrent callers", async () => {
	const fake = pager({ perPage: 100 });
	const walk = loader.createBackwardLoader(fake.walkFor(500));
	const [a, b] = await Promise.all([walk.loadOne(), walk.loadOne()]);
	assert.equal(a, true);
	assert.equal(b, true);
	assert.equal(
		fake.calls.loads,
		1,
		"the second caller awaited the first's fetch",
	);
});

test("a shared fetch makes a collision a wait, not a false", async () => {
	/*
	 * The shape the walk-side consumers rely on: the pager refuses a
	 * concurrent ask with `false`, and a walk would read that as history's
	 * end. Sharing the promise turns the collision into a wait.
	 */
	let calls = 0;
	let release;
	const load = () => {
		calls += 1;
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	const shared = loader.shareInFlight(load);
	const first = shared();
	const second = shared();
	assert.equal(calls, 1, "one fetch for both askers");
	release(true);
	assert.equal(await first, true);
	assert.equal(await second, true);
	const third = shared();
	assert.equal(calls, 2, "the next ask after settle is a new fetch");
	release(false);
	assert.equal(await third, false);
});

test("the outline keeps a turn's id when its head arrives (collapse lane repro)", async () => {
	/*
	 * The newer half of a page split: a turn whose opening user row has not
	 * arrived. The outline must key it by the closing answer's id, and that id
	 * must be what the same turn reports once the head lands.
	 */
	const newerHalf = [answer("a1")];
	const first = loader.turnsOutline(newerHalf);
	assert.equal(first.length, 1);
	assert.equal(first[0].id, "a1", "identity is the closing answer's id");
	assert.equal(first[0].openingRecordId, null);
	assert.equal(
		first[0].userText,
		null,
		"no invented copy for an unloaded head",
	);
	assert.equal(first[0].answerText, "done");

	const withHead = [user("u1", "what changed?"), answer("a1")];
	const after = loader.turnsOutline(withHead);
	assert.equal(after.length, 1);
	assert.equal(
		after[0].id,
		"a1",
		"the head's arrival does not change the identity",
	);
	assert.equal(after[0].openingRecordId, "u1");
	assert.equal(after[0].userText, "what changed?");
	assert.equal(after[0].closingAnswerId, "a1");
});

test("an open turn falls back to its opening record's id", async () => {
	const outline = loader.turnsOutline([user("u1", "still working")]);
	assert.equal(outline.length, 1);
	assert.equal(
		outline[0].id,
		"u1",
		"no closing answer yet, so the head names it",
	);
	assert.equal(outline[0].closingAnswerId, null);
	assert.equal(outline[0].opensWithUserRow, true);
});
