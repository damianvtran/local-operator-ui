import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
async function load(path) {
	const out = await build({
		entryPoints: [path],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
}
const { ChromeTabOrder } = await load("src/main/browser/chrome-tab-order.ts");
const { pooledTabs, chordTarget, closeToTheRightIntent, mergeChromeTabOrder } =
	await load("src/renderer/src/features/browser/model/tab-index-model.ts");
test("human order replaces only scoped slots, prunes closes and appends new records", () => {
	const model = new ChromeTabOrder();
	const records = [1, 2, 3, 4].map((tabId) => ({ tabId }));
	assert.deepEqual(model.project(records), records);
	assert.equal(model.reorder(records, [3, 1]), true);
	assert.deepEqual(
		model.project(records).map((r) => r.tabId),
		[3, 2, 1, 4],
	);
	assert.equal(
		model.project(records)[0],
		records[2],
		"record/capability identity is unchanged",
	);
	assert.deepEqual(
		model.project([...records.slice(1), { tabId: 5 }]).map((r) => r.tabId),
		[3, 2, 4, 5],
	);
});
test("invalid, duplicated or stale order cannot mutate the current projection", () => {
	const model = new ChromeTabOrder();
	const records = [1, 2].map((tabId) => ({ tabId }));
	for (const ids of [[1, 1], [7], [undefined], new Array(1)])
		assert.equal(model.reorder(records, ids), false);
	assert.deepEqual(
		model.project(records).map((r) => r.tabId),
		[1, 2],
	);
});
test("rendered order, ordinal chords and close-to-right consume the SAME order", () => {
	const tabs = [
		{ tabId: 1, sessionId: "a", displayOrder: 2 },
		{ tabId: 2, sessionId: "b", displayOrder: 0 },
		{ tabId: 3, sessionId: "a", displayOrder: 1 },
	];
	assert.deepEqual(
		pooledTabs(tabs).map((t) => t.tabId),
		[2, 3, 1],
	);
	assert.equal(chordTarget(tabs, 2, "tab-1"), 2);
	assert.equal(chordTarget(tabs, 2, "next-tab"), 3);
	assert.equal(chordTarget(tabs, 2, "prev-tab"), 1);
	const intent = closeToTheRightIntent(pooledTabs(tabs), 3);
	assert.deepEqual(intent.tabIds, [1]);
});

test("close-to-right selects the physical set at first, middle and last tabs", () => {
	const ordered = pooledTabs([
		{ tabId: 1, sessionId: "a", displayOrder: 2 },
		{ tabId: 2, sessionId: "b", displayOrder: 0 },
		{ tabId: 3, sessionId: "a", displayOrder: 1 },
	]);
	assert.deepEqual(
		ordered.map((tab) => tab.tabId),
		[2, 3, 1],
	);
	for (const [direction, expectations] of [
		["ltr", [[3, 1], [1], null]],
		["rtl", [null, [2], [2, 3]]],
	]) {
		ordered.forEach((anchor, index) => {
			const intent = closeToTheRightIntent(ordered, anchor.tabId, direction);
			assert.deepEqual(
				intent?.tabIds ?? null,
				expectations[index],
				`${direction} anchor index=${index}`,
			);
		});
	}
});

test("first scoped reorder preserves the old grouped default and unrelated slots", () => {
	const tabs = [
		{ tabId: 1, sessionId: "a" },
		{ tabId: 2, sessionId: null },
		{ tabId: 3, sessionId: "b" },
		{ tabId: 4, sessionId: "a" },
	];
	assert.deepEqual(
		pooledTabs(tabs).map((t) => t.tabId),
		[1, 4, 3, 2],
	);
	const permutation = mergeChromeTabOrder(tabs, [4, 1]);
	assert.deepEqual(permutation, [4, 1, 3, 2]);
	const order = new ChromeTabOrder();
	assert.equal(order.hasCustomOrder, false);
	order.reorder(tabs, permutation);
	assert.equal(order.hasCustomOrder, true);
	assert.deepEqual(
		order.project(tabs).map((t) => t.tabId),
		permutation,
	);
	assert.deepEqual(
		mergeChromeTabOrder(tabs, [1, 1]),
		[1, 1],
		"bad input reaches main's refusal, never a silently repaired preference",
	);
});
