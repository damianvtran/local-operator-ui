import assert from "node:assert/strict";
import { mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// Real picker DOM/event handlers with the shipped Input/Button. This is NOT
// native text editing, layout, IME, OS focus or a screen-reader assertion.
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const name of [
	"window",
	"document",
	"localStorage",
	"Node",
	"Element",
	"HTMLElement",
	"SVGElement",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"InputEvent",
	"FocusEvent",
	"MutationObserver",
])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const dir = resolve("node_modules/.cache/tag-picker-tests");
await mkdir(dir, { recursive: true });
const bundlePath = `${dir}/picker-${process.pid}.mjs`;
await build({
	stdin: {
		contents: `export * from './src/renderer/src/features/chat/chat-tag-picker'; export {TagPickerCombobox} from './src/renderer/src/features/chat/components/tag-picker-combobox';`,
		resolveDir: process.cwd(),
	},
	alias: {
		"@features": resolve("src/renderer/src/features"),
		"@shared": resolve("src/renderer/src/shared"),
	},
	bundle: true,
	jsx: "automatic",
	packages: "external",
	platform: "node",
	format: "esm",
	outfile: bundlePath,
	logLevel: "silent",
});
const {
	TagPickerCombobox,
	tagNameIssue,
	togglePickerTag,
	matchingTags,
	pickerActiveIndex,
} = await import(pathToFileURL(bundlePath));
const root = createRoot(document.getElementById("root"));
after(async () => {
	await act(() => root.unmount());
	await unlink(bundlePath);
	dom.window.close();
});
const categories = Array.from({ length: 12 }, (_, index) => ({
	id: String(index),
	name: `Tag ${index}`,
	order: index,
	conversations: 0,
}));
let creates = 0;
let toggles = [];
function Harness({ initial = [], unready = false }) {
	const [selected, setSelected] = React.useState(initial);
	const [query, setQuery] = React.useState("");
	const [listOpen, setListOpen] = React.useState(true);
	const input = React.useRef(null);
	return React.createElement(TagPickerCombobox, {
		categories,
		selected,
		primary: selected[0] ?? null,
		query,
		setQuery,
		listOpen,
		setListOpen,
		disabled: false,
		unready,
		input,
		createIssue: selected.length >= 8 ? "Choose up to 8 tags" : null,
		toggle: (id) => {
			toggles.push(id);
			setSelected((held) => togglePickerTag(held, id));
		},
		create: () => {
			creates++;
		},
	});
}
let instance = 0;
async function mount(initial = [], unready = false) {
	creates = 0;
	toggles = [];
	await act(() =>
		root.render(
			React.createElement(Harness, { key: ++instance, initial, unready }),
		),
	);
	return document.querySelector('[role="combobox"]');
}
async function key(node, value, options = {}) {
	const event = new window.KeyboardEvent("keydown", {
		key: value,
		bubbles: true,
		cancelable: true,
		...options,
	});
	await act(() => node.dispatchEvent(event));
	return event;
}
async function query(input, value) {
	await act(() => {
		Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		).set.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}
const options = () => [...document.querySelectorAll('[role="option"]')];

test("name rules count code points, preserve Unicode and reserve Untagged", () => {
	assert.equal(tagNameIssue("  "), "blank");
	assert.equal(tagNameIssue(" UnTaGgEd "), "reserved");
	assert.equal(tagNameIssue("界".repeat(24)), null);
	assert.equal(tagNameIssue("界".repeat(25)), "long");
	assert.equal(tagNameIssue(String.fromCodePoint(0x1f600).repeat(24)), null);
	assert.equal(tagNameIssue("e\u0301".repeat(13)), "long");
	assert.equal(tagNameIssue("مشروع 東京"), null);
});
test("selection preserves assignment order, blocks ninth, permits removal", () => {
	const ids = Array.from({ length: 8 }, (_, index) => String(index));
	assert.deepEqual(togglePickerTag(ids, "8"), ids);
	assert.deepEqual(togglePickerTag(ids, "2"), [
		"0",
		"1",
		"3",
		"4",
		"5",
		"6",
		"7",
	]);
	assert.deepEqual(togglePickerTag(["b", "a"], "c"), ["b", "a", "c"]);
	assert.equal(pickerActiveIndex(0, -1, 32), 0);
	assert.equal(pickerActiveIndex(31, 1, 32), 31);
	assert.equal(pickerActiveIndex(0, 1, 0), -1);
	assert.deepEqual(matchingTags([{ name: "Release 東京" }], "release 東"), [
		{ name: "Release 東京" },
	]);
});
test("input editing keys stay native; empty and unmatched Enter do not mutate", async () => {
	const input = await mount();
	await act(() => input.focus());
	for (const value of [" ", "Home", "End"])
		assert.equal((await key(input, value)).defaultPrevented, false);
	await key(input, "Enter");
	assert.deepEqual(toggles, []);
	assert.equal(creates, 0);
	await query(input, "No match");
	assert.equal(options().length, 0);
	assert.equal(input.hasAttribute("aria-activedescendant"), false);
	await key(input, "Enter");
	assert.equal(creates, 0);
	assert.deepEqual(toggles, []);
	const create = [...document.querySelectorAll("button")].find((button) =>
		button.textContent.includes("Create"),
	);
	assert.ok(create);
	assert.equal(create.closest('[role="option"]'), null);
	await act(() => create.click());
	assert.equal(creates, 1);
});
test("active descendant exists, arrows clamp, Enter toggles once and resets", async () => {
	const input = await mount();
	await act(() => input.focus());
	await key(input, "ArrowDown");
	assert.equal(
		document.getElementById(input.getAttribute("aria-activedescendant")),
		options()[0],
	);
	await key(input, "ArrowUp");
	assert.equal(
		document.getElementById(input.getAttribute("aria-activedescendant")),
		options()[0],
	);
	await key(input, "Enter");
	assert.deepEqual(toggles, ["0"]);
	assert.equal(input.value, "");
	assert.equal(input.hasAttribute("aria-activedescendant"), false);
	assert.equal(options().filter((option) => option.tabIndex === 0).length, 1);
	assert.equal(options()[0].getAttribute("aria-selected"), "true");
});
test("one roving option stop, option Home/End and Space, input mode cleared", async () => {
	const input = await mount();
	await act(() => options()[0].focus());
	assert.equal(input.hasAttribute("aria-activedescendant"), false);
	await key(options()[0], "End");
	assert.equal(document.activeElement, options().at(-1));
	await key(document.activeElement, "Home");
	assert.equal(document.activeElement, options()[0]);
	await key(document.activeElement, " ");
	assert.deepEqual(toggles, ["0"]);
	assert.equal(document.activeElement, input);
});
test("eight cap preserves removable options; IME Backspace does not remove", async () => {
	const input = await mount(["0", "1", "2", "3", "4", "5", "6", "7"]);
	await act(() => options()[8].click());
	assert.deepEqual(toggles, []);
	await key(input, "Backspace", { isComposing: true });
	assert.deepEqual(toggles, []);
	await key(input, "Backspace");
	assert.deepEqual(toggles, ["7"]);
	assert.equal(options()[7].getAttribute("aria-selected"), "false");
	await act(() => options()[8].click());
	assert.deepEqual(toggles, ["7", "8"]);
});
test("unready registry has no active/selectable options and cannot create", async () => {
	const input = await mount([], true);
	await query(input, "Future");
	await key(input, "ArrowDown");
	await key(input, "Enter");
	assert.equal(options().length, 0);
	assert.equal(input.hasAttribute("aria-activedescendant"), false);
	assert.equal(creates, 0);
	assert.deepEqual(toggles, []);
});
