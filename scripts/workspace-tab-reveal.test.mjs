import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Mount the shipped component. Only stub catalogue/preferences and the layout
// and frame outputs jsdom cannot provide; this is not Chromium coverage.
const dom = new JSDOM("<main><div id='root'></div></main>", {
	url: "http://localhost/chat",
});
const { window } = dom;
for (const key of [
	"window",
	"document",
	"AbortController",
	"Event",
	"Node",
	"HTMLElement",
	"Element",
	"DocumentFragment",
	"DOMRect",
	"MutationObserver",
	"NodeFilter",
	"CustomEvent",
	"MouseEvent",
	"getComputedStyle",
]) {
	globalThis[key] = window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const { act, createElement } = require("react");
const { createRoot } = require("react-dom/client");
const FIXTURE_STORES =
	/^@shared\/store\/(canonical-sessions|ui-preferences)-store$/;
const ANY_FIXTURE_PATH = /.*/;
const { outputFiles } = await build({
	entryPoints: [
		fileURLToPath(
			new URL(
				"../src/renderer/src/features/chat/components/workspace-tabs.tsx",
				import.meta.url,
			),
		),
	],
	tsconfig: fileURLToPath(new URL("../tsconfig.app.json", import.meta.url)),
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	define: { "import.meta.env": "{}" },
	write: false,
	plugins: [
		{
			name: "workspace-tab-test-state",
			setup(build) {
				build.onResolve({ filter: FIXTURE_STORES }, ({ path }) => ({
					path,
					namespace: "workspace-test-state",
				}));
				build.onLoad(
					{ filter: ANY_FIXTURE_PATH, namespace: "workspace-test-state" },
					() => ({
						contents: `
						export const useCanonicalSessionsStore = select => select({sessions: [], head: {at: 1}, error: null});
						export const useUiPreferencesStore = select => select({workspaceTabs: []});
					`,
					}),
				);
			},
		},
	],
});
const component = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(
	require,
	component,
	component.exports,
);
const { WorkspaceTabs } = component.exports;

const frames = new Map();
const observers = new Set();
let frameId = 0;
let reducedMotion = false;
const requestFrame = (run) => {
	frames.set(++frameId, run);
	return frameId;
};
const cancelFrame = (id) => frames.delete(id);
window.requestAnimationFrame = globalThis.requestAnimationFrame = requestFrame;
window.cancelAnimationFrame = globalThis.cancelAnimationFrame = cancelFrame;
window.matchMedia = () => ({ matches: reducedMotion });
window.ResizeObserver = globalThis.ResizeObserver = class {
	constructor(run) {
		this.run = run;
		this.targets = new Set();
		observers.add(this);
	}
	observe(target) {
		this.targets.add(target);
	}
	disconnect() {
		observers.delete(this);
	}
};

const resize = (...changed) =>
	act(() => {
		for (const observer of observers) {
			const targets = changed.filter((node) => observer.targets.has(node));
			if (targets.length) observer.run(targets.map((target) => ({ target })));
		}
	});
const frame = () =>
	act(() => {
		for (const [id, run] of [...frames]) {
			if (frames.delete(id)) run(0);
		}
	});
const tab = (key, pinned = false) => ({
	key,
	pinned,
	target: { kind: "session", id: key },
});
const box = (left, right) => new window.DOMRect(left, 0, right - left, 32);
const noop = () => {};

function fixture(t, tabs) {
	const host = document.querySelector("#root");
	const root = createRoot(host);
	const render = (activeKey, options = {}) =>
		act(() =>
			root.render(
				createElement(WorkspaceTabs, {
					activeKey,
					activeTitle: null,
					tabs,
					autoClose: false,
					titles: Object.fromEntries(tabs.map(({ key }) => [key, key])),
					onAutoCloseChange: noop,
					onTitleSeen: noop,
					onFocusHandled: noop,
					onOpen: noop,
					onClose: noop,
					onCloseMany: noop,
					onPin: noop,
					onMove: noop,
					...options,
				}),
			),
		);
	t.after(() => {
		act(() => root.unmount());
		frames.clear();
		reducedMotion = false;
	});
	render();
	return { host, render };
}

function laneLayout(
	host,
	name,
	bounds,
	{ width = 100, rtl = false, defer = false, closeOverflow = () => 0 } = {},
) {
	const lane = host.querySelector(`[data-workspace-${name}]`);
	const moves = [];
	let destination;
	const end = () => {
		if (destination !== undefined) lane.scrollLeft = clamp(destination);
		destination = undefined;
		lane.dispatchEvent(new window.Event("scrollend"));
	};
	const farEdge = () =>
		Math.max(
			0,
			...bounds.map(
				([start, end], i) => (rtl ? -start : end) + closeOverflow(i),
			),
		) - width;
	const clamp = (value) =>
		rtl
			? Math.max(-farEdge(), Math.min(0, value))
			: Math.min(farEdge(), Math.max(0, value));
	Object.defineProperties(lane, {
		clientWidth: { get: () => width },
		scrollWidth: { get: () => width + Math.max(0, farEdge()) },
	});
	lane.style.direction = rtl ? "rtl" : "ltr";
	lane.getBoundingClientRect = () => box(10, 10 + width);
	lane.scrollTo = ({ left, behavior }) => {
		moves.push({ left, behavior });
		if (behavior === "smooth" && defer) destination = left;
		else {
			destination = undefined;
			lane.scrollLeft = clamp(left);
		}
	};
	const rows = () =>
		[...lane.children].map((row, index) => {
			row.getBoundingClientRect = () => {
				const [start, end] = bounds[index];
				const origin = 10 + (rtl ? width : 0) - lane.scrollLeft;
				return box(origin + start, origin + end);
			};
			row.lastElementChild.getBoundingClientRect = () => {
				const { left, right } = row.getBoundingClientRect();
				const edge = closeOverflow(index);
				return rtl
					? box(left - edge, left - edge + 24)
					: box(right + edge - 24, right + edge);
			};
			const button = row.querySelector("button");
			button.getBoundingClientRect = () => {
				const { left, right } = row.getBoundingClientRect();
				return rtl ? box(left + 48, right) : box(left, right - 48);
			};
			// Baseline's Chromium call uses nearest on the primary button only.
			button.scrollIntoView = () => {
				const rect = button.getBoundingClientRect();
				if (rect.right > 10 + width)
					lane.scrollLeft = clamp(lane.scrollLeft + rect.right - 10 - width);
				else if (rect.left < 10)
					lane.scrollLeft = clamp(lane.scrollLeft + rect.left - 10);
			};
			return row;
		});
	return { lane, rows: rows(), syncRows: rows, moves, end };
}

function expectVisible(lane, row) {
	const viewport = lane.getBoundingClientRect();
	const target = row.getBoundingClientRect();
	assert.ok(
		target.left >= viewport.left && target.right <= viewport.right,
		`tab spans ${target.left}..${target.right}, but lane only shows ${viewport.left}..${viewport.right}`,
	);
}

test("route selection reveals the whole active row, not just the visible title", (t) => {
	const { host, render } = fixture(t, [tab("previous"), tab("active")]);
	const { lane, rows, moves } = laneLayout(host, "regular", [
		[0, 60],
		[64, 138],
	]);
	const outside = document.createElement("button");
	host.before(outside);
	t.after(() => outside.remove());
	outside.focus();
	host.parentElement.scrollTop = 45;
	try {
		render("active");
		frame();
		expectVisible(lane, rows[1]);
		assert.deepEqual(moves, [{ left: 38, behavior: "smooth" }]);
		assert.equal(document.activeElement, outside);
		assert.equal(host.parentElement.scrollTop, 45);

		let focusHandled = 0;
		render("active", {
			focusRequested: true,
			onFocusHandled: () => focusHandled++,
		});
		frame();
		assert.equal(document.activeElement, rows[1].querySelector("button"));
		assert.equal(focusHandled, 1);
		assert.equal(moves.length, 1);
	} finally {
		host.parentElement.scrollTop = 0;
	}
});

test("active title growth and preceding shifts coalesce without restarting native motion", (t) => {
	const { host, render } = fixture(t, [tab("previous"), tab("active")]);
	const bounds = [
		[0, 60],
		[64, 96],
	];
	const { lane, rows, moves, end } = laneLayout(host, "regular", bounds, {
		defer: true,
	});
	render("active");
	frame();
	assert.deepEqual(moves, []);

	bounds[1][1] = 138;
	render("active", { activeTitle: "A growing conversation title" });
	resize(rows[1]);
	frame();
	assert.deepEqual(moves, [{ left: 38, behavior: "smooth" }]);

	bounds[1][1] = 149;
	resize(rows[1]);
	frame();
	bounds[0][1] = 67;
	bounds[1] = [71, 156];
	resize(rows[0]);
	frame();
	assert.equal(moves.length, 1);
	end();
	frame();
	assert.deepEqual(moves[1], { left: 56, behavior: "smooth" });
	end();
	resize(rows[0], rows[1], lane);
	frame();
	expectVisible(lane, rows[1]);
	assert.equal(moves.length, 2);
});

test("draft insertion and promotion use the current row, not a queued inactive one", (t) => {
	const first = tab("first");
	const last = tab("last");
	const draft = {
		...tab("draft"),
		target: { kind: "draft", id: "draft:fixture" },
	};
	const { host, render } = fixture(t, [first, last]);
	const bounds = [
		[0, 65],
		[69, 135],
		[139, 204],
	];
	const { lane, moves, syncRows, end } = laneLayout(host, "regular", bounds, {
		defer: true,
	});
	render("last");
	const tabs = [first, last, draft];
	render("draft", { tabs });
	const rows = syncRows();
	frame();
	assert.deepEqual(moves, [{ left: 104, behavior: "smooth" }]);
	end();
	expectVisible(lane, rows[2]);

	const promoted = { ...draft, target: { kind: "session", id: "admitted" } };
	render("draft", {
		tabs: [first, last, promoted],
		activeTitle: "Promoted title",
	});
	assert.equal(syncRows()[2], rows[2]);
	bounds[2][1] = 215;
	resize(rows[2]);
	frame();
	end();
	expectVisible(lane, rows[2]);
	assert.deepEqual(moves[1], { left: 115, behavior: "smooth" });
});

const pointer = (node, type) => {
	const event = new window.MouseEvent(type, { bubbles: true });
	Object.defineProperty(event, "pointerId", { value: 1 });
	act(() => node.dispatchEvent(event));
};

test("pointer hold cancels stale motion; the ensuing click reveals only the new selection", (t) => {
	const { host, render } = fixture(t, [
		tab("first"),
		tab("second"),
		tab("third"),
	]);
	const bounds = [
		[0, 52],
		[56, 125],
		[129, 208],
	];
	const { lane, rows, moves, end } = laneLayout(host, "regular", bounds, {
		defer: true,
	});
	const onOpen = (item) => render(item.key);
	render("third", { onOpen });
	frame();
	lane.scrollLeft = 25; // A frame of native smooth motion, before pointerdown.
	const button = rows[1].querySelector("button");
	rows[2].querySelector("button").focus();
	pointer(button, "pointerdown");
	button.focus(); // Element blur after pointerdown is not a window blur.
	bounds[2][1] = 228;
	resize(rows[2]);
	frame();
	expectVisible(lane, rows[1]);
	assert.deepEqual(moves, [
		{ left: 108, behavior: "smooth" },
		{ left: 25, behavior: "instant" },
	]);
	pointer(window, "pointerup");
	act(() => button.click());
	frame();
	end();
	expectVisible(lane, rows[1]);
	assert.equal(
		moves.length,
		2,
		"already-visible selection must not move the lane",
	);
	assert.equal(document.activeElement, button);
});

test("context menu and drag take priority over late layout changes", (t) => {
	const { host, render } = fixture(t, [tab("first"), tab("active")]);
	const bounds = [
		[0, 52],
		[56, 96],
	];
	const { rows, moves } = laneLayout(host, "regular", bounds);
	render("active");
	frame();
	const button = rows[1].querySelector("button");
	const dragStart = new window.Event("dragstart", { bubbles: true });
	Object.defineProperty(dragStart, "dataTransfer", {
		value: { setData: noop },
	});
	act(() => button.dispatchEvent(dragStart));
	bounds[1][1] = 116;
	resize(rows[1]);
	frame();
	assert.deepEqual(moves, []);
	act(() =>
		button.dispatchEvent(new window.Event("dragend", { bubbles: true })),
	);
	frame();
	assert.deepEqual(moves, []);

	act(() =>
		rows[1].dispatchEvent(
			new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
		),
	);
	const menu = document.querySelector("[data-workspace-tab-context-menu]");
	assert.ok(menu);
	bounds[1][1] = 136;
	resize(rows[1]);
	frame();
	assert.deepEqual(moves, []);

	act(() =>
		menu.dispatchEvent(
			new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
		),
	);
	assert.ok(!document.querySelector("[data-workspace-tab-context-menu]"));
	frame();
	assert.deepEqual(moves, []);
	bounds[1][1] = 145;
	resize(rows[1]);
	frame();
	assert.deepEqual(moves, [{ left: 45, behavior: "smooth" }]);
});

test("manual horizontal scrolling owns its lane until explicit selection", (t) => {
	const { host, render } = fixture(t, [
		tab("first"),
		tab("active"),
		tab("pin", true),
	]);
	const bounds = [
		[0, 60],
		[64, 137],
	];
	const regular = laneLayout(host, "regular", bounds);
	const pinned = laneLayout(host, "pinned", [[0, 120]]);
	render("active");
	frame();
	regular.end();
	pinned.lane.scrollLeft = 12;
	act(() =>
		pinned.lane.dispatchEvent(
			new window.WheelEvent("wheel", { bubbles: true, deltaX: 5 }),
		),
	);
	bounds[1][1] = 149;
	resize(regular.rows[1]);
	frame();
	assert.deepEqual(regular.moves[1], { left: 49, behavior: "smooth" });
	assert.deepEqual(pinned.moves, []);
	regular.end();

	act(() =>
		regular.lane.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				shiftKey: true,
				deltaY: -10,
			}),
		),
	);
	regular.lane.scrollLeft = 0;
	bounds[1][1] = 160;
	resize(regular.rows[1]);
	frame();
	assert.equal(regular.lane.scrollLeft, 0);
	assert.equal(regular.moves.length, 2);
	act(() => regular.rows[1].querySelector("button").click());
	frame();
	expectVisible(regular.lane, regular.rows[1]);
	assert.deepEqual(regular.moves[2], { left: 60, behavior: "smooth" });
	assert.equal(pinned.lane.scrollLeft, 12);
});

test("RTL and reduced motion reveal only the pinned lane and clamp an oversized row at its controls end", (t) => {
	reducedMotion = true;
	const { host, render } = fixture(t, [
		tab("regular"),
		tab("pin-a", true),
		tab("pin-b", true),
	]);
	const regular = laneLayout(host, "regular", [[0, 120]]);
	const bounds = [
		[-28, 0],
		[-100, -32],
	];
	let overflow = 0;
	const pinned = laneLayout(host, "pinned", bounds, {
		width: 70,
		rtl: true,
		closeOverflow: (index) => (index === 1 ? overflow : 0),
	});
	render("pin-b");
	frame();
	expectVisible(pinned.lane, pinned.rows[1]);
	assert.deepEqual(pinned.moves, [{ left: -30, behavior: "instant" }]);
	// The wrapper caps at lane width, but the fixed-width controls can overflow.
	bounds[1][0] = -102;
	overflow = 14;
	resize(pinned.rows[1]);
	frame();
	assert.equal(pinned.lane.scrollLeft, -46);
	assert.equal(
		pinned.rows[1].lastElementChild.getBoundingClientRect().left,
		10,
	);
	resize(pinned.lane, pinned.rows[1]);
	frame();
	assert.equal(pinned.moves.length, 2);
	assert.deepEqual(regular.moves, []);
});
