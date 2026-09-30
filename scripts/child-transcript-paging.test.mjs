import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The child reader's older-page ask, through the SHIPPED `useChildTranscript`.
 *
 * Loader-continuity round 1 (R1-2, R1-3, R1-5, R1-6b). The parent's ask is
 * covered through its hook in `reconnect-page-gap.test.mjs`; the child has its
 * own loader with its own copy of the same rules, and nothing exercised it:
 *   - a page that REJECTS must reach `olderFailed` (the only thing that lets
 *     `CanonicalTranscript` paint the failed row for a child), and a lost race
 *     must not;
 *   - `pagedBefore` is asserted only while the cursor is still where the ask
 *     started, so a tail read that lands while the page is out cannot have the
 *     cursor dragged;
 *   - a page still out for child A when the reader goes A -> B -> A is dropped;
 *   - `newRecords` / `exhausted` describe the page that was applied.
 *
 * Only the network and React's cell store are substituted (the same stand-in
 * `reconnect-page-gap.test.mjs` uses); the reducer and the hook are the shipped
 * modules.
 */

const reactStandIn = `const R = () => globalThis.__reactRuntime;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export default { useState, useEffect, useRef, useCallback };`;

const bundle = await build({
	stdin: {
		contents: `
			export { useChildTranscript } from "./src/renderer/src/features/chat/components/run-details/use-child-transcript";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "child-paging-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "child-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "child-fixture" }, () => ({
					contents:
						"export const desktopResult = (request) => globalThis.__childRequest(request);",
					loader: "js",
				}));
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "child-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "child-react" }, () => ({
					contents: reactStandIn,
					loader: "js",
				}));
			},
		},
	],
});
const { useChildTranscript } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** One cell per hook call, a setter that re-renders, dep-gated effects. */
function makeRuntime() {
	const cells = [];
	let cursor = 0;
	let effects = [];
	const runtime = { render: () => null };
	const rerender = () => {
		cursor = 0;
		effects = [];
		const out = runtime.render();
		const flushed = effects;
		effects = [];
		for (const fn of flushed) fn?.();
		return out;
	};
	runtime.rerender = rerender;
	const slot = () => {
		const index = cursor++;
		if (!cells[index]) cells[index] = {};
		return cells[index];
	};
	const unchanged = (was, next) =>
		was !== undefined &&
		next !== undefined &&
		was.length === next.length &&
		was.every((value, index) => Object.is(value, next[index]));
	globalThis.__reactRuntime = {
		useState: (init) => {
			const cell = slot();
			if (!("state" in cell))
				cell.state = typeof init === "function" ? init() : init;
			return [
				cell.state,
				(value) => {
					const next = typeof value === "function" ? value(cell.state) : value;
					if (Object.is(next, cell.state)) return;
					cell.state = next;
					rerender();
				},
			];
		},
		useRef: (init) => {
			const cell = slot();
			if (!("ref" in cell)) cell.ref = { current: init };
			return cell.ref;
		},
		useCallback: (fn, deps) => {
			const cell = slot();
			if (!cell.fn || !unchanged(cell.deps, deps)) {
				cell.fn = fn;
				cell.deps = deps;
			}
			return cell.fn;
		},
		useEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
	};
	return runtime;
}

const SESSION = "aaaaaaaaaaaa";
const TOTAL = 350;
const PAGE = 100;

const entry = (index) => ({
	id: `e${String(index).padStart(4, "0")}`,
	ts: 1_790_000_000 + index,
	type: "message",
	payload: {
		kind: "message",
		role: index % 2 ? "assistant" : "user",
		content: [{ text: `Row ${index}` }],
		...(index % 2 ? { stop_reason: "stop" } : {}),
	},
});
const rows = Array.from({ length: TOTAL }, (_, i) => entry(i + 1));

/** The route's own paging: `before_id` exclusive, tail when absent. */
function journalPage(beforeId, limit) {
	const end = beforeId
		? rows.findIndex((row) => row.id === beforeId)
		: rows.length;
	const start = Math.max(0, end - limit);
	return {
		entries: rows.slice(start, end),
		has_more: start > 0,
		cursor_missing: false,
		state: "ready",
	};
}

/** Mount the hook; `olderRead` scripts the `before_id` reads of the case. */
async function mount({ olderRead }) {
	const requests = [];
	globalThis.__childRequest = async (request) => {
		requests.push(request);
		if (request.beforeId === undefined) return journalPage(null, request.limit);
		return olderRead(request);
	};
	// `window` is only touched by the live poll, which `live: false` never arms.
	globalThis.window = { setInterval, clearInterval };
	const runtime = makeRuntime();
	let childId = "child-a";
	let handle;
	runtime.render = () => {
		handle = useChildTranscript({
			sessionId: SESSION,
			childId,
			pulse: 0,
			live: false,
		});
		return handle;
	};
	runtime.rerender();
	await settle();
	return {
		requests,
		handle: () => handle,
		switchTo: async (next) => {
			childId = next;
			runtime.rerender();
			await settle();
		},
	};
}

const settle = async () => {
	for (let i = 0; i < 4; i++)
		await new Promise((resolve) => setImmediate(resolve));
};

test("a child page that rejects sets olderFailed, and an applied page clears it", async () => {
	let fail = true;
	const child = await mount({
		olderRead: (request) => {
			if (fail) throw new Error("transcript unavailable");
			return journalPage(request.beforeId, request.limit);
		},
	});
	assert.equal(child.handle().olderFailed, false);
	const held = child.handle().transcript.oldestId;
	assert.ok(held, "the tail read gave the reader a cursor");

	const failed = await child.handle().loadOlderDetailed();
	await settle();
	assert.deepEqual(failed, { kind: "failed", reason: "request" });
	assert.equal(
		child.handle().olderFailed,
		true,
		"the failed row has something to paint",
	);
	assert.equal(
		child.handle().transcript.oldestId,
		held,
		"a failure moves nothing",
	);

	fail = false;
	const applied = await child.handle().loadOlderDetailed();
	await settle();
	assert.equal(applied.kind, "applied");
	assert.equal(
		applied.newRecords > 0,
		true,
		"newRecords describes the page that landed, not the pre-update zero",
	);
	assert.equal(applied.exhausted, false);
	assert.equal(child.handle().olderFailed, false, "an applied page clears it");
});

test("a lost race never sets olderFailed, however the abandoned request ends", async () => {
	let reject;
	const gate = new Promise((_, fail) => {
		reject = fail;
	});
	const child = await mount({
		olderRead: async () => {
			await gate;
		},
	});
	const pending = child.handle().loadOlderDetailed();
	await settle();
	await child.switchTo("child-b");
	reject(new Error("transcript unavailable"));
	const outcome = await pending;
	await settle();
	assert.equal(outcome.kind, "stale", "the reader has left that child");
	assert.equal(child.handle().olderFailed, false);
	assert.equal(
		child.handle().loadingOlder,
		false,
		"and the new child is not left loading",
	);
});

test("a page that lands late cannot drag a cursor that already moved past it (pagedBefore guard)", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const child = await mount({
		olderRead: async (request) => {
			calls += 1;
			// Only the FIRST ask is held; the two after it land in order.
			if (calls === 1) await gate;
			return journalPage(request.beforeId, request.limit);
		},
	});
	const first = child.handle().loadOlderDetailed();
	await settle();
	assert.equal((await child.handle().loadOlderDetailed()).kind, "applied");
	await settle();
	assert.equal((await child.handle().loadOlderDetailed()).kind, "applied");
	await settle();
	const deepest = child.handle().transcript.oldestId;
	assert.equal(deepest, "e0051", "two pages walked the cursor back");

	release();
	assert.equal((await first).kind, "applied");
	await settle();
	// The late page is a page the reader already holds: applied as an ordinary
	// read it can only move the cursor further back, never forward to its own
	// first entry (`e0151`), which would re-ask two pages the reader holds.
	assert.equal(
		child.handle().transcript.oldestId,
		deepest,
		"the cursor was not dragged back to where the late page started",
	);
});

test("a page still out for child A when the reader goes A -> B -> A is dropped", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const child = await mount({
		olderRead: async (request) => {
			await gate;
			return journalPage(request.beforeId, request.limit);
		},
	});
	const pending = child.handle().loadOlderDetailed();
	await settle();
	await child.switchTo("child-b");
	await child.switchTo("child-a");
	release();
	const outcome = await pending;
	await settle();
	assert.equal(
		outcome.kind,
		"stale",
		"the page belongs to the previous visit, whatever the child id says",
	);
	assert.equal(
		child.handle().transcript.oldestId,
		`e${String(TOTAL - PAGE + 1).padStart(4, "0")}`,
		"the returning view's cursor comes from its own tail read, not the stale page",
	);
});

test("the last page reports exhausted and ends the pager", async () => {
	const child = await mount({
		olderRead: (request) => journalPage(request.beforeId, request.limit),
	});
	let last;
	for (let i = 0; i < 6 && child.handle().transcript.hasMore; i++) {
		last = await child.handle().loadOlderDetailed();
		await settle();
	}
	assert.equal(last.kind, "applied");
	assert.equal(last.exhausted, true);
	assert.deepEqual(await child.handle().loadOlderDetailed(), {
		kind: "nothing-to-load",
	});
});
