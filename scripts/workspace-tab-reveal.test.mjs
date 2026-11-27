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
// The reveal reads a snapshot; the title also subscribes to the media query.
// jsdom lacks matchMedia, so supply its EventTarget surface as well as matches.
window.matchMedia = () =>
	Object.assign(new window.EventTarget(), { matches: reducedMotion });
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
	const viewport = { pinned: 0, regular: 0 };
	// A keyed ancestor must recreate the actual DOM lanes, like SessionPanel.
	const render = (activeKey, { mountKey, ...options } = {}) =>
		act(() =>
			root.render(
				createElement(
					"section",
					{ key: mountKey },
					createElement(WorkspaceTabs, {
						viewport,
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
	{
		width = 100,
		rtl = false,
		defer = false,
		closeOverflow = () => 0,
		snap = (value) => value,
	} = {},
) {
	const lane = host.querySelector(`[data-workspace-${name}]`);
	const moves = [];
	let current;
	const end = async () => {
		if (current) lane.scrollLeft = current.left;
		current?.resolve();
		current = undefined;
		lane.dispatchEvent(new window.Event("scrollend"));
	};
	const superseded = [];
	const settleSuperseded = async () => {
		for (const resolve of superseded.splice(0)) resolve();
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
	let offset = lane.scrollLeft;
	Object.defineProperties(lane, {
		// Blink doesn't expose a live scroll offset for a disconnected lane.
		scrollLeft: {
			get: () => (lane.isConnected ? offset : 0),
			set: (value) => {
				offset = value;
			},
		},
		clientWidth: { get: () => width },
		scrollWidth: { get: () => width + Math.max(0, farEdge()) },
	});
	lane.style.direction = rtl ? "rtl" : "ltr";
	lane.getBoundingClientRect = () => box(10, 10 + width);
	lane.scrollTo = ({ left, behavior }) => {
		moves.push({ left, behavior });
		if (current) superseded.push(current.resolve);
		current = undefined;
		const actual = snap(clamp(left));
		// Chromium promises settle even if quantization makes this a no-op
		// with no scrollend event. Only a real deferred move needs `end()`.
		if (behavior === "smooth" && defer && actual !== lane.scrollLeft) {
			return new Promise((resolve) => {
				current = { resolve, left: actual };
			});
		}
		lane.scrollLeft = actual;
		return Promise.resolve();
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
	return { lane, rows: rows(), syncRows: rows, moves, end, settleSuperseded };
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

test("keyed conversation and draft switches keep both lane offsets before revealing", (t) => {
	const tabs = [tab("first"), tab("second"), tab("last"), tab("pin", true)];
	const { host, render } = fixture(t, tabs);
	const regularBounds = [
		[24, 95],
		[105, 159],
		[174, 248],
	];
	const pinnedBounds = [[0, 160]];
	render("first", { mountKey: "session:first" });
	const prevRegular = laneLayout(host, "regular", regularBounds);
	const prevPinned = laneLayout(host, "pinned", pinnedBounds);
	frame();
	prevRegular.lane.scrollLeft = 102;
	prevPinned.lane.scrollLeft = 30;
	expectVisible(prevRegular.lane, prevRegular.rows[1]);

	render("second", { mountKey: "session:second" });
	const regular = laneLayout(host, "regular", regularBounds);
	const pinned = laneLayout(host, "pinned", pinnedBounds);
	assert.notEqual(regular.lane, prevRegular.lane);
	assert.notEqual(pinned.lane, prevPinned.lane);
	assert.deepEqual(
		[regular.lane.scrollLeft, pinned.lane.scrollLeft],
		[102, 30],
	);
	frame();
	expectVisible(regular.lane, regular.rows[1]);
	assert.deepEqual([regular.moves, pinned.moves], [[], []]);

	const draft = {
		...tab("draft"),
		target: { kind: "draft", id: "draft:fixture" },
	};
	render("draft", { mountKey: "draft:fixture", tabs: [...tabs, draft] });
	const nextRegular = laneLayout(host, "regular", [
		...regularBounds,
		[252, 315],
	]);
	const nextPinned = laneLayout(host, "pinned", pinnedBounds);
	assert.deepEqual(
		[nextRegular.lane.scrollLeft, nextPinned.lane.scrollLeft],
		[102, 30],
	);
	frame();
	expectVisible(nextRegular.lane, nextRegular.rows[3]);
	// Wholly past the edge and a 113 px trip in a 100 px lane: a jump (D1/U1).
	assert.deepEqual(nextRegular.moves, [{ left: 215, behavior: "instant" }]);
	assert.equal(nextPinned.lane.scrollLeft, 30);
	assert.deepEqual(nextPinned.moves, []);
});

for (const scenario of ["inserted after mount", "removed and recreated"]) {
	test(`keyed switch preserves a pinned lane ${scenario} without a reveal`, (t) => {
		const regularTabs = [tab("first"), tab("second"), tab("last")];
		const pins = [tab("pin-a", true), tab("pin-b", true), tab("pin-c", true)];
		const withPins = [...regularTabs, ...pins];
		const withoutPins = [...regularTabs, ...pins.map(({ key }) => tab(key))];
		const { host, render } = fixture(t, withoutPins);
		const regularBounds = [
			[0, 60],
			[64, 122],
			[126, 200],
		];
		const pinnedBounds = [
			[0, 76],
			[90, 145],
			[149, 218],
		];
		const outgoing = "session:first";
		let removedLane;
		if (scenario === "removed and recreated") {
			render("first", { mountKey: outgoing, tabs: withPins });
			removedLane = laneLayout(host, "pinned", pinnedBounds).lane;
			removedLane.scrollLeft = 87;
		}
		render("first", { mountKey: outgoing, tabs: withoutPins });
		assert.equal(host.querySelector("[data-workspace-pinned]"), null);
		if (removedLane) assert.equal(removedLane.isConnected, false);
		const oldRegular = host.querySelector("[data-workspace-regular]");

		// Pinning is an in-place update, not a conversation switch. The lane
		// that appears here owns the scroll offset carried by the next switch.
		render("first", { mountKey: outgoing, tabs: withPins });
		const prevPinned = laneLayout(host, "pinned", pinnedBounds);
		const prevRegular = laneLayout(host, "regular", regularBounds);
		assert.notEqual(prevPinned.lane, removedLane);
		assert.equal(prevRegular.lane, oldRegular);
		frame();
		prevPinned.lane.scrollLeft = 54;
		prevRegular.lane.scrollLeft = 32;
		expectVisible(prevPinned.lane, prevPinned.rows[1]);

		render("pin-b", { mountKey: "session:pin-b", tabs: withPins });
		const pinned = laneLayout(host, "pinned", pinnedBounds);
		const regular = laneLayout(host, "regular", regularBounds);
		assert.notEqual(pinned.lane, prevPinned.lane);
		assert.notEqual(regular.lane, prevRegular.lane);
		const beforeFrame = [pinned.lane.scrollLeft, regular.lane.scrollLeft];
		frame();
		assert.deepEqual(
			{
				beforeFrame,
				afterFrame: [pinned.lane.scrollLeft, regular.lane.scrollLeft],
				moves: [pinned.moves, regular.moves],
			},
			{ beforeFrame: [54, 32], afterFrame: [54, 32], moves: [[], []] },
		);
		expectVisible(pinned.lane, pinned.rows[1]);
	});
}

test("active title growth and preceding shifts coalesce without restarting native motion", async (t) => {
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
	await end();
	frame();
	assert.deepEqual(moves[1], { left: 56, behavior: "smooth" });
	await end();
	resize(rows[0], rows[1], lane);
	frame();
	expectVisible(lane, rows[1]);
	assert.equal(moves.length, 2);
});

test("draft insertion and promotion use the current row, not a queued inactive one", async (t) => {
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
	// The appended draft starts beyond the lane and is >= one lane width away.
	assert.deepEqual(moves, [{ left: 104, behavior: "instant" }]);
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
	await end();
	expectVisible(lane, rows[2]);
	assert.deepEqual(moves[1], { left: 115, behavior: "smooth" });
});

// D1/U1: a smooth pan only helps when the destination is in or near view.
// New chat appends a tab wholly past the lane; panning ~758 px across
// unrelated tabs left them moving under the pointer for over 425 ms.
const farTabs = [tab("a"), tab("b"), tab("c")];
const farDraft = { ...tab("far"), target: { kind: "draft", id: "draft:far" } };
const farBounds = () => [
	[0, 60],
	[64, 122],
	[126, 190],
	[194, 258],
];

test("a new draft wholly past the lane and >= one lane width away jumps once", (t) => {
	const { host, render } = fixture(t, farTabs);
	const bounds = farBounds();
	const { lane, moves, syncRows } = laneLayout(host, "regular", bounds, {
		defer: true,
	});
	render("a");
	frame();
	assert.deepEqual(moves, []);
	render("far", { tabs: [...farTabs, farDraft] });
	const rows = syncRows();
	frame();
	assert.deepEqual(moves, [{ left: 158, behavior: "instant" }]);
	expectVisible(lane, rows[3]);
	resize(rows[3], lane);
	frame();
	assert.equal(moves.length, 1);
});

test("an instant jump leaves no motion lock: title growth still follows smoothly", async (t) => {
	const { host, render } = fixture(t, farTabs);
	const bounds = farBounds();
	const { lane, moves, syncRows, end } = laneLayout(host, "regular", bounds, {
		defer: true,
	});
	render("a");
	render("far", { tabs: [...farTabs, farDraft] });
	const rows = syncRows();
	frame();
	assert.deepEqual(moves, [{ left: 158, behavior: "instant" }]);
	// Rename growth of the now-visible row: partly visible, so smooth, and
	// requested without any settlement of the jump (it never took the lock).
	bounds[3][1] = 270;
	resize(rows[3]);
	frame();
	assert.deepEqual(moves[1], { left: 170, behavior: "smooth" });
	// Growth during that pan coalesces until it settles, then follows once.
	bounds[3][1] = 280;
	resize(rows[3]);
	frame();
	assert.equal(moves.length, 2);
	await end();
	frame();
	assert.deepEqual(moves[2], { left: 180, behavior: "smooth" });
	await end();
	expectVisible(lane, rows[3]);
});

test("a hidden row less than one lane width away still pans smoothly", (t) => {
	const { host, render } = fixture(t, [tab("a"), tab("near")]);
	const { lane, rows, moves } = laneLayout(host, "regular", [
		[0, 60],
		[104, 160],
	]);
	render("near");
	frame();
	assert.deepEqual(moves, [{ left: 60, behavior: "smooth" }]);
	expectVisible(lane, rows[1]);
});

test("a partly visible row pans smoothly even when the move exceeds a lane width", (t) => {
	// Oversized row: its controls end lies 160 px away, but its start is in view.
	const { host, render } = fixture(t, [tab("a"), tab("wide")]);
	const { moves } = laneLayout(host, "regular", [
		[0, 40],
		[50, 260],
	]);
	render("wide");
	frame();
	assert.deepEqual(moves, [{ left: 160, behavior: "smooth" }]);
});

test("RTL: a new draft wholly past the logical end jumps with a negative offset", (t) => {
	const { host, render } = fixture(t, farTabs);
	const bounds = farBounds().map(([start, end]) => [-end, -start]);
	const { lane, moves, syncRows } = laneLayout(host, "regular", bounds, {
		rtl: true,
		defer: true,
	});
	render("a");
	frame();
	assert.deepEqual(moves, []);
	render("far", { tabs: [...farTabs, farDraft] });
	const rows = syncRows();
	frame();
	assert.deepEqual(moves, [{ left: -158, behavior: "instant" }]);
	expectVisible(lane, rows[3]);
});

test("RTL: a hidden row less than one lane width away still pans smoothly", (t) => {
	const { host, render } = fixture(t, [tab("a"), tab("near")]);
	const { moves } = laneLayout(
		host,
		"regular",
		[
			[-60, 0],
			[-160, -104],
		],
		{ rtl: true },
	);
	render("near");
	frame();
	assert.deepEqual(moves, [{ left: -60, behavior: "smooth" }]);
});

test("reduced motion stays instant for near and far reveals alike", (t) => {
	reducedMotion = true;
	const { host, render } = fixture(t, [tab("a"), tab("near"), tab("far")]);
	const { moves } = laneLayout(host, "regular", [
		[0, 60],
		[104, 160],
		[194, 258],
	]);
	render("near");
	frame();
	render("far");
	frame();
	assert.deepEqual(moves, [
		{ left: 60, behavior: "instant" },
		{ left: 158, behavior: "instant" },
	]);
});

const pointer = (node, type) => {
	const event = new window.MouseEvent(type, { bubbles: true });
	Object.defineProperty(event, "pointerId", { value: 1 });
	act(() => node.dispatchEvent(event));
};

test("canceled pointer press defers one reveal of the latest title until release", (t) => {
	const { host, render } = fixture(t, [tab("first"), tab("active")]);
	const bounds = [
		[0, 52],
		[56, 96],
	];
	const { lane, rows, moves } = laneLayout(host, "regular", bounds);
	render("active");
	frame();
	pointer(rows[0].querySelector("button"), "pointerdown");
	bounds[1][1] = 132;
	resize(rows[1]);
	frame();
	bounds[1][1] = 138;
	resize(rows[1]);
	frame();
	assert.deepEqual(moves, []);
	assert.equal(rows[1].getBoundingClientRect().right, 148);
	pointer(window, "pointercancel");
	frame();
	expectVisible(lane, rows[1]);
	assert.deepEqual(moves, [{ left: 38, behavior: "smooth" }]);
});

test("a deferred rename cannot undo keyboard focus scrolling to another tab", (t) => {
	const { host, render } = fixture(t, [
		tab("first"),
		tab("active"),
		tab("next"),
	]);
	const bounds = [
		[0, 52],
		[56, 96],
		[156, 211],
	];
	const { lane, rows, moves } = laneLayout(host, "regular", bounds);
	render("active");
	frame();
	pointer(rows[0].querySelector("button"), "pointerdown");
	bounds[1][1] = 138;
	resize(rows[1]);
	frame();
	pointer(window, "pointerup");
	const focused = rows[2].querySelector("button");
	focused.focus();
	assert.equal(focused.matches(":focus-visible"), true);
	lane.scrollLeft = 120; // Native Tab-focus scrolling, not implemented by jsdom.
	frame();
	expectVisible(lane, rows[2]);
	assert.equal(lane.scrollLeft, 120);
	assert.deepEqual(moves, []);
});

test("an 80%-zoom snapped no-op does not block later rename reveal", async (t) => {
	const { host, render } = fixture(t, [
		tab("first"),
		tab("active"),
		tab("after"),
	]);
	const bounds = [
		[0, 64],
		[90, 130.546875],
		[180, 250],
	];
	const { lane, rows, moves, end } = laneLayout(host, "regular", bounds, {
		defer: true,
		// Model integer internal offsets without manufacturing a scrollend.
		snap: (left) => Math.round(left * 0.8) / 0.8,
	});
	lane.scrollLeft = 30;
	render("active");
	frame();
	assert.equal(lane.scrollLeft, 30);
	assert.deepEqual(moves, [{ left: 30.546875, behavior: "smooth" }]);
	await Promise.resolve();
	bounds[1][1] = 170;
	resize(rows[1]);
	frame();
	assert.deepEqual(moves[1], { left: 70, behavior: "smooth" });
	await end();
	expectVisible(lane, rows[1]);
});

test("a superseded promise or same-lane scrollend cannot settle a later request", async (t) => {
	const { host, render } = fixture(t, [
		tab("first"),
		tab("second"),
		tab("third"),
	]);
	const bounds = [
		[0, 55],
		[60, 132],
		[136, 196],
	];
	const { lane, rows, moves, end, settleSuperseded } = laneLayout(
		host,
		"regular",
		bounds,
		{ defer: true },
	);
	render("third");
	frame();
	render("second");
	frame();
	assert.deepEqual(moves, [
		{ left: 96, behavior: "smooth" },
		{ left: 0, behavior: "instant" },
		{ left: 32, behavior: "smooth" },
	]);
	bounds[1][1] = 145;
	resize(rows[1]);
	frame();
	await settleSuperseded();
	lane.dispatchEvent(new window.Event("scrollend"));
	frame();
	assert.equal(moves.length, 3);
	await end();
	frame();
	assert.deepEqual(moves[3], { left: 45, behavior: "smooth" });
});

test("pointer hold cancels stale motion; the ensuing click reveals only the new selection", async (t) => {
	const { host, render } = fixture(t, [
		tab("first"),
		tab("second"),
		tab("third"),
	]);
	// The third row starts partly visible so its reveal is a smooth pan that
	// the pointer hold can interrupt (a far, hidden row would jump instead).
	const bounds = [
		[0, 52],
		[56, 125],
		[99, 178],
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
	bounds[2][1] = 198;
	resize(rows[2]);
	frame();
	expectVisible(lane, rows[1]);
	assert.deepEqual(moves, [
		{ left: 78, behavior: "smooth" },
		{ left: 25, behavior: "instant" },
	]);
	pointer(window, "pointerup");
	act(() => button.click());
	frame();
	await end();
	expectVisible(lane, rows[1]);
	assert.equal(
		moves.length,
		2,
		"already-visible selection must not move the lane",
	);
	assert.equal(document.activeElement, button);
});

test("context menu and drag take priority until they release the pending layout change", async (t) => {
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
	assert.deepEqual(moves, [{ left: 16, behavior: "smooth" }]);
	await Promise.resolve();

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
	assert.equal(moves.length, 1);

	act(() =>
		menu.dispatchEvent(
			new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
		),
	);
	assert.ok(!document.querySelector("[data-workspace-tab-context-menu]"));
	frame();
	assert.deepEqual(moves, [
		{ left: 16, behavior: "smooth" },
		{ left: 36, behavior: "smooth" },
	]);
});

test("manual horizontal scrolling supersedes deferred geometry until explicit selection", async (t) => {
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
	await regular.end();
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
	await regular.end();

	pointer(regular.rows[0].querySelector("button"), "pointerdown");
	bounds[1][1] = 157;
	resize(regular.rows[1]);
	frame();
	assert.equal(regular.moves.length, 2);
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
	pointer(window, "pointerup");
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
