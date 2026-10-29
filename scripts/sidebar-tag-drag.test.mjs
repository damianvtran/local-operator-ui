import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { IntlMessageFormat } from "intl-messageformat";

// Execute the same pure decisions as the sidebar, not a second gesture model.
const bundle = await build({
	stdin: {
		contents: `
export * from "./src/renderer/src/features/chat/chat-tag-drag";
export * from "./src/renderer/src/features/chat/chat-tag-groups";
export * from "./src/renderer/src/features/chat/chat-pin-order";
export {CHAT_ROW_MENU_SCROLL_CLASS} from "./src/renderer/src/features/chat/chat-row-menu";
export {tagDropTargetAt, tagHeaderAt} from "./src/renderer/src/features/chat/use-chat-tag-drag";
`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	TAG_DROP_PREVIEW_CLASSES,
	CHAT_ROW_MENU_SCROLL_CLASS,
	tagDragPhase,
	chatTagBucket,
	movedTagAssignment,
	groupChatsByTag,
	tagBucketRowIds,
	movePinnedOrderTo,
	pinDragSlot,
	tagDropTargetAt,
	tagHeaderAt,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const categories = [
	{ id: "a", name: "Review", order: 0, conversations: 2 },
	{ id: "b", name: "Project", order: 1, conversations: 2 },
	{ id: "empty", name: "Empty", order: 2, conversations: 0 },
];
const row = (session_id, primary, tags = primary ? [primary] : []) => ({
	session_id,
	primary,
	tags: tags.map((id) => ({ id, name: id })),
});

test("hold boundary is 180 ms with inclusive 5px slop; scroll never arms", () => {
	assert.equal(tagDragPhase(0, 0), "pending");
	assert.equal(tagDragPhase(179, 5), "pending");
	assert.equal(tagDragPhase(180, 5), "armed");
	assert.equal(tagDragPhase(179, 5.001), "cancelled");
	assert.equal(tagDragPhase(180, 5.001), "cancelled");
});
test("bucket membership is exactly primary + registry + assignment, never a secondary", () => {
	for (const item of [
		row("1", "a"),
		row("2", null, ["a"]),
		row("3", "deleted"),
		row("4", "a", ["b"]),
	]) {
		const groups = groupChatsByTag(
			[row("control", "b"), item],
			categories,
			true,
		);
		const group = groups.find((bucket) => bucket.rows.includes(item));
		assert.equal(chatTagBucket(item, categories), group.id);
	}
	assert.equal(chatTagBucket(row("x", null), categories), "untagged");
});
test("move promotes without removing others, repeated primary is no-op, Untagged clears once", () => {
	assert.deepEqual(movedTagAssignment(row("x", "a", ["a", "b"]), "b"), {
		ids: ["a", "b"],
		primary: "b",
	});
	assert.deepEqual(movedTagAssignment(row("x", "a"), "b"), {
		ids: ["a", "b"],
		primary: "b",
	});
	assert.equal(movedTagAssignment(row("x", "a"), "a"), null);
	assert.deepEqual(movedTagAssignment(row("x", "a", ["a", "b"]), "untagged"), {
		ids: [],
		primary: null,
	});
	assert.equal(movedTagAssignment(row("x", null), "untagged"), null);
});
test("two occupied buckets: visual no-op writes nothing; both directions preserve other bucket positions", () => {
	const rows = [row("a1", "a"), row("b1", "b"), row("a2", "a"), row("b2", "b")];
	const catalogue = rows.map((item) => item.session_id);
	for (const [id, own] of [
		["a1", ["a1", "a2"]],
		["a2", ["a1", "a2"]],
		["b1", ["b1", "b2"]],
		["b2", ["b1", "b2"]],
	]) {
		const shown = tagBucketRowIds(rows, categories, true, id);
		assert.deepEqual(shown, own);
		const start = shown.indexOf(id);
		assert.equal(movePinnedOrderTo(catalogue, [], shown, id, start), null);
		const next = movePinnedOrderTo(
			catalogue,
			[],
			shown,
			id,
			start === 0 ? 1 : 0,
		);
		assert.deepEqual(
			next,
			own[0].startsWith("a")
				? ["a2", "b1", "a1", "b2"]
				: ["a1", "b2", "a2", "b1"],
		);
	}
	assert.deepEqual(tagBucketRowIds(rows, categories, false, "a1"), catalogue);
	assert.deepEqual(
		tagBucketRowIds([row("u1", null), row("u2", null)], categories, true, "u1"),
		["u1", "u2"],
	);
});
test("cross-bucket header creates an assignment, while cross-bucket row is not a reorder target", () => {
	const rows = [row("a1", "a"), row("b1", "b")];
	assert.equal(
		tagBucketRowIds(rows, categories, true, "a1").includes("b1"),
		false,
	);
	assert.deepEqual(movedTagAssignment(rows[0], "b"), {
		ids: ["a", "b"],
		primary: "b",
	});
	assert.deepEqual(
		rows.map((item) => item.session_id),
		["a1", "b1"],
	);
});
test("header hit testing clips targets to owning list and ignores empty/offscreen headers", () => {
	const section = {};
	const header = {
		closest: () => section,
		dataset: { tagDropTarget: "a" },
		getBoundingClientRect: () => ({
			left: 0,
			right: 200,
			top: 40,
			bottom: 68,
			height: 28,
		}),
	};
	const hidden = {
		closest: () => section,
		dataset: { tagDropTarget: "empty" },
		getBoundingClientRect: () => ({
			left: 0,
			right: 200,
			top: 90,
			bottom: 90,
			height: 0,
		}),
	};
	const owner = {
		getBoundingClientRect: () => ({
			left: 0,
			right: 200,
			top: 50,
			bottom: 100,
		}),
		querySelectorAll: () => [header, hidden],
	};
	assert.equal(tagDropTargetAt(owner, 100, 55, section), header);
	assert.equal(
		tagDropTargetAt(owner, 100, 55, {}),
		null,
		"occupied header in another section is ineligible",
	);
	assert.equal(tagDropTargetAt(owner, 100, 45, section), null);
	assert.equal(tagDropTargetAt(owner, 201, 55, section), null);
	assert.equal(tagDropTargetAt(owner, 100, 90, section), null);
});
test("an unused tag's footer slot is a drop target from every section, never for pinned reorder (v3 D3)", () => {
	const section = {};
	const footer = {}; // the tag footer lives outside every [data-chat-section]
	const slot = {
		closest: () => footer,
		dataset: { tagDropTarget: "unused", tagUnusedSlot: "" },
		getBoundingClientRect: () => ({
			left: 0,
			right: 200,
			top: 200,
			bottom: 228,
			height: 28,
		}),
	};
	const owner = {
		getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 400 }),
		querySelectorAll: (selector) =>
			selector.includes(":not([data-tag-drop-body])") ? [slot] : [slot],
	};
	assert.equal(tagDropTargetAt(owner, 100, 210, section, "a"), slot);
	assert.equal(tagDropTargetAt(owner, 100, 210, section, "untagged"), slot);
	assert.equal(
		tagHeaderAt(owner, 100, 210, section),
		null,
		"pinned reorder keeps its section-local header-only test",
	);
});
test("group body accepts Untagged across sections but keeps tagged sources section-local", () => {
	const source = {};
	const other = {};
	const body = {
		closest: () => other,
		dataset: { tagDropTarget: "work" },
		getBoundingClientRect: () => ({
			left: 0,
			right: 200,
			top: 30,
			bottom: 100,
			height: 70,
		}),
	};
	const owner = {
		getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 200 }),
		querySelectorAll: () => [body],
	};
	assert.equal(tagDropTargetAt(owner, 100, 80, source, "untagged"), body);
	assert.equal(tagDropTargetAt(owner, 100, 80, source, "personal"), null);
	assert.equal(tagDropTargetAt(owner, 100, 80, other, "personal"), body);
	assert.equal(tagDropTargetAt(owner, 100, 150, source, "untagged"), null);
	body.dataset.tagDropBody = "";
	assert.equal(
		tagDropTargetAt(owner, 100, 80, other, "work"),
		null,
		"own-bucket body remains reorder space",
	);
	body.dataset.tagDropTarget = "untagged";
	assert.equal(
		tagDropTargetAt(owner, 100, 80, source, "untagged"),
		null,
		"own Untagged body is not an assignment",
	);
	const sidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	assert.ok(sidebar.includes("cursor-grab"));
	assert.ok(sidebar.includes("cursor-grabbing"));
	let selector;
	owner.querySelectorAll = (value) => {
		selector = value;
		return [];
	};
	assert.equal(tagHeaderAt(owner, 100, 80, other), null);
	assert.equal(
		selector,
		"[data-tag-drop-target]:not([data-tag-drop-body])",
		"pinned reorder stays header-only",
	);
});
test("copy has singular/plural count, named move/cancel/undo/conflict announcements", () => {
	const en = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.tags.json", "utf8"),
	);
	// A drop ADDS the tag and makes it primary; "Moved to" read as a replace (v3 UX audit).
	assert.equal(
		en["ui.chat.tags.dropped_on"],
		"Added “{name}” and grouped under it",
	);
	assert.equal(en["ui.chat.tags.moved_to"], undefined);
	assert.equal(en["ui.chat.tags.removed_all"], "Removed all tags");
	assert.equal(en["ui.chat.tags.changed_elsewhere"], "Tags changed elsewhere");
	assert.equal(
		en["ui.chat.tags.remove_all"],
		"{count, plural, one {Remove tag (#)} other {Remove all tags (#)}}",
	);
	assert.equal(
		en["ui.chat.tags.move_failed"],
		"Tags were not moved. Try again.",
	);
	for (const key of ["move_armed", "move_cancelled", "move_undone", "undo"])
		assert.ok(en[`ui.chat.tags.${key}`]);
});

test("reproduces the old grouped-DOM/flat-order visual no-op defect", () => {
	const rows = [row("a1", "a"), row("b1", "b"), row("a2", "a"), row("b2", "b")];
	const catalogue = rows.map((item) => item.session_id);
	const boxes = ["a1", "a2", "b1", "b2"].map((id, index) => ({
		id,
		top: index * 32,
		bottom: (index + 1) * 32,
	}));
	const oldSlot = pinDragSlot(boxes, "b1", 80);
	assert.equal(oldSlot, 2);
	assert.deepEqual(
		movePinnedOrderTo(catalogue, [], catalogue, "b1", oldSlot),
		["a1", "a2", "b1", "b2"],
		"old visual no-op rewrote the stored order",
	);
	const shown = tagBucketRowIds(rows, categories, true, "b1");
	const fixedSlot = pinDragSlot(
		boxes.filter((box) => shown.includes(box.id)),
		"b1",
		80,
	);
	assert.equal(
		movePinnedOrderTo(catalogue, [], shown, "b1", fixedSlot),
		null,
		"same visual no-op now writes nothing",
	);
});

test("remove action formatting is exact singular only at one, including Russian 21/101", () => {
	const ru = JSON.parse(
		readFileSync("src/i18n/catalogues/ru/ui.chat.tags.json", "utf8"),
	);
	const format = new IntlMessageFormat(ru["ui.chat.tags.remove_all"], "ru");
	assert.equal(format.format({ count: 1 }), "Удалить тег (1)");
	for (const count of [2, 21, 101])
		assert.equal(format.format({ count }), `Удалить все теги (${count})`);
	for (const locale of ["en", "es", "fr", "ru"]) {
		const catalogue = JSON.parse(
			readFileSync(`src/i18n/catalogues/${locale}/ui.chat.tags.json`, "utf8"),
		);
		assert.equal(Object.keys(catalogue).length, 67);
		const message = new IntlMessageFormat(
			catalogue["ui.chat.tags.remove_all"],
			locale,
		);
		for (const count of [1, 2, 21, 101])
			assert.ok(String(message.format({ count })).includes(`(${count})`));
	}
});

test("drop preview uses the contracted row ground, while only the detached menu scrolls", () => {
	assert.deepEqual(TAG_DROP_PREVIEW_CLASSES, [
		"bg-row-selected",
		"text-ink!",
		"outline",
		"outline-1",
		"outline-accent",
	]);
	assert.ok(CHAT_ROW_MENU_SCROLL_CLASS.includes("overflow-y-auto"));
	assert.ok(CHAT_ROW_MENU_SCROLL_CLASS.includes("50dvh"));
	assert.ok(CHAT_ROW_MENU_SCROLL_CLASS.includes("min-h-8"));
});

test("shipping Chinese tag namespace preserves exact-one removal semantics", () => {
	const zh = JSON.parse(
		readFileSync("src/i18n/catalogues/zh-CN/ui.chat.tags.json", "utf8"),
	);
	assert.equal(Object.keys(zh).length, 67);
	const message = new IntlMessageFormat(zh["ui.chat.tags.remove_all"], "zh-CN");
	assert.equal(message.format({ count: 1 }), "移除标签（1）");
	for (const count of [2, 21, 101])
		assert.equal(message.format({ count }), `移除所有标签（${count}）`);
});
